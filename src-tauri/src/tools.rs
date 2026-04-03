use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::process::Command;
use walkdir::WalkDir;

use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// A tool definition suitable for sending to the xAI API as an OpenAI-compatible
/// function definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

/// The result returned after executing a tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub tool_name: String,
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Tool trait — extensible tool registration for future tools
// ---------------------------------------------------------------------------

/// Shared resources available to all tools during execution.
#[derive(Debug, Clone)]
pub struct ToolContext {
    pub workspace_roots: Vec<String>,
    pub db: Option<crate::db::Database>,
    pub sub_agent_ctx: Option<crate::sub_agent::SubAgentContext>,
    pub parent_model: Option<String>,
    pub cancel: Option<CancellationToken>,
}

/// Trait for implementing custom tools.  New tools can implement this trait
/// and be registered with `ToolRegistry::register_dynamic`.
///
/// Existing built-in tools use the dispatch-based pattern in `ToolRegistry`
/// for backwards compatibility.  Both approaches coexist.
#[async_trait::async_trait]
pub trait Tool: Send + Sync {
    fn definition(&self) -> ToolDefinition;
    async fn execute(&self, args: &Value, ctx: &ToolContext) -> ToolResult;
}

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

/// Central registry that holds workspace roots and exposes every available tool.
/// Supports both built-in dispatch tools and dynamic trait-based tools.
#[derive(Clone)]
pub struct ToolRegistry {
    workspace_roots: Vec<String>,
    db: Option<crate::db::Database>,
    sub_agent_ctx: Option<crate::sub_agent::SubAgentContext>,
    parent_model: Option<String>,
    cancel: Option<CancellationToken>,
    /// Dynamically registered tools (trait-based).
    dynamic_tools: Vec<std::sync::Arc<dyn Tool>>,
}

impl std::fmt::Debug for ToolRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolRegistry")
            .field("workspace_roots", &self.workspace_roots)
            .field("dynamic_tools_count", &self.dynamic_tools.len())
            .finish()
    }
}

impl ToolRegistry {
    pub fn new(workspace_roots: Vec<String>) -> Self {
        Self {
            workspace_roots,
            db: None,
            sub_agent_ctx: None,
            parent_model: None,
            cancel: None,
            dynamic_tools: Vec::new(),
        }
    }

    /// Register a dynamic trait-based tool.
    pub fn register_dynamic(&mut self, tool: impl Tool + 'static) {
        self.dynamic_tools.push(std::sync::Arc::new(tool));
    }

    pub fn with_db(mut self, db: crate::db::Database) -> Self {
        self.db = Some(db);
        self
    }

    pub fn with_sub_agent_ctx(mut self, ctx: crate::sub_agent::SubAgentContext, parent_model: String, cancel: CancellationToken) -> Self {
        self.sub_agent_ctx = Some(ctx);
        self.parent_model = Some(parent_model);
        self.cancel = Some(cancel);
        self
    }

    /// Build a `ToolContext` from the registry's shared resources.
    pub fn context(&self) -> ToolContext {
        ToolContext {
            workspace_roots: self.workspace_roots.clone(),
            db: self.db.clone(),
            sub_agent_ctx: self.sub_agent_ctx.clone(),
            parent_model: self.parent_model.clone(),
            cancel: self.cancel.clone(),
        }
    }

    /// Returns all tool definitions for the xAI / OpenAI function-calling API.
    pub fn definitions(&self) -> Vec<ToolDefinition> {
        let mut defs = vec![
            def_read_file(),
            def_write_file(),
            def_edit_file(),
            def_list_directory(),
            def_search_files(),
            def_grep(),
            def_bash(),
            def_git_status(),
            def_git_diff(),
            def_git_log(),
            def_git_commit(),
            def_git_add(),
            def_git_checkout(),
            def_mkdir(),
            def_touch(),
            def_tree(),
            def_find_definition(),
            def_web_fetch(),
            def_spawn_agent(),
            def_spawn_agents_parallel(),
            def_memory_save(),
            def_memory_recall(),
        ];
        // Append dynamic tool definitions.
        for tool in &self.dynamic_tools {
            defs.push(tool.definition());
        }
        defs
    }

    /// Execute a tool by name, dispatching to the appropriate handler.
    pub async fn execute(&self, tool_name: &str, arguments: &Value) -> ToolResult {
        let result = match tool_name {
            "read_file" => self.exec_read_file(arguments).await,
            "write_file" => self.exec_write_file(arguments).await,
            "edit_file" => self.exec_edit_file(arguments).await,
            "list_directory" => self.exec_list_directory(arguments).await,
            "search_files" => self.exec_search_files(arguments).await,
            "grep" => self.exec_grep(arguments).await,
            "bash" => self.exec_bash(arguments).await,
            "git_status" => self.exec_git_status(arguments).await,
            "git_diff" => self.exec_git_diff(arguments).await,
            "git_log" => self.exec_git_log(arguments).await,
            "git_commit" => self.exec_git_commit(arguments).await,
            "mkdir" => self.exec_mkdir(arguments).await,
            "touch" => self.exec_touch(arguments).await,
            "tree" => self.exec_tree(arguments).await,
            "find_definition" => self.exec_find_definition(arguments).await,
            "web_fetch" => self.exec_web_fetch(arguments).await,
            "git_add" => self.exec_git_add(arguments).await,
            "git_checkout" => self.exec_git_checkout(arguments).await,
            "spawn_agent" => self.exec_spawn_agent(arguments).await,
            "spawn_agents_parallel" => self.exec_spawn_agents_parallel(arguments).await,
            "memory_save" => self.exec_memory_save(arguments).await,
            "memory_recall" => self.exec_memory_recall(arguments).await,
            _ => {
                // Check dynamic tools before giving up.
                for tool in &self.dynamic_tools {
                    if tool.definition().name == tool_name {
                        return tool.execute(arguments, &self.context()).await;
                    }
                }
                Err(AppError::message(format!("unknown tool: {tool_name}")))
            }
        };

        match result {
            Ok(output) => ToolResult {
                tool_name: tool_name.to_string(),
                success: true,
                output,
                error: None,
            },
            Err(err) => ToolResult {
                tool_name: tool_name.to_string(),
                success: false,
                output: String::new(),
                error: Some(err.to_string()),
            },
        }
    }

    // -----------------------------------------------------------------------
    // Filesystem tools
    // -----------------------------------------------------------------------

    async fn exec_read_file(&self, args: &Value) -> AppResult<String> {
        let path = require_str(args, "path")?;
        let resolved = validate_workspace_path(&path, &self.workspace_roots)?;
        let offset = args.get("offset").and_then(|v| v.as_u64()).map(|v| v as usize);
        let limit = args.get("limit").and_then(|v| v.as_u64()).map(|v| v as usize);
        read_file(&resolved, offset, limit).await
    }

    async fn exec_write_file(&self, args: &Value) -> AppResult<String> {
        let path = require_str(args, "path")?;
        let content = require_str(args, "content")?;
        let resolved = validate_workspace_path(&path, &self.workspace_roots)?;
        write_file(&resolved, &content).await
    }

    async fn exec_edit_file(&self, args: &Value) -> AppResult<String> {
        let path = require_str(args, "path")?;
        let old_text = require_str(args, "old_text")?;
        let new_text = require_str(args, "new_text")?;
        let replace_all = args.get("replace_all").and_then(|v| v.as_bool()).unwrap_or(false);
        let resolved = validate_workspace_path(&path, &self.workspace_roots)?;
        edit_file(&resolved, &old_text, &new_text, replace_all).await
    }

    async fn exec_list_directory(&self, args: &Value) -> AppResult<String> {
        let path = require_str(args, "path")?;
        let resolved = validate_workspace_path(&path, &self.workspace_roots)?;
        list_directory(&resolved).await
    }

    async fn exec_search_files(&self, args: &Value) -> AppResult<String> {
        let pattern = require_str(args, "pattern")?;
        let path = optional_str(args, "path");
        let search_root = match &path {
            Some(p) => validate_workspace_path(p, &self.workspace_roots)?,
            None => PathBuf::from(self.default_root()),
        };
        search_files(&pattern, &search_root).await
    }

    async fn exec_grep(&self, args: &Value) -> AppResult<String> {
        let pattern = require_str(args, "pattern")?;
        let path = optional_str(args, "path");
        let include = optional_str(args, "include");
        let search_root = match &path {
            Some(p) => validate_workspace_path(p, &self.workspace_roots)?,
            None => PathBuf::from(self.default_root()),
        };
        grep(&pattern, &search_root, include.as_deref()).await
    }

    // -----------------------------------------------------------------------
    // Shell execution
    // -----------------------------------------------------------------------

    async fn exec_bash(&self, args: &Value) -> AppResult<String> {
        let command = require_str(args, "command")?;
        let cwd = optional_str(args, "cwd");
        let timeout_ms = args
            .get("timeout_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(120_000);

        let working_dir = match &cwd {
            Some(dir) => validate_workspace_path(dir, &self.workspace_roots)?,
            None => PathBuf::from(self.default_root()),
        };

        bash(&command, &working_dir, timeout_ms).await
    }

    // -----------------------------------------------------------------------
    // Git tools
    // -----------------------------------------------------------------------

    async fn exec_git_status(&self, args: &Value) -> AppResult<String> {
        let cwd = optional_str(args, "cwd");
        let working_dir = match &cwd {
            Some(dir) => validate_workspace_path(dir, &self.workspace_roots)?,
            None => PathBuf::from(self.default_root()),
        };
        git_status(&working_dir).await
    }

    async fn exec_git_diff(&self, args: &Value) -> AppResult<String> {
        let cwd = optional_str(args, "cwd");
        let working_dir = match &cwd {
            Some(dir) => validate_workspace_path(dir, &self.workspace_roots)?,
            None => PathBuf::from(self.default_root()),
        };
        git_diff(&working_dir).await
    }

    async fn exec_git_log(&self, args: &Value) -> AppResult<String> {
        let cwd = optional_str(args, "cwd");
        let count = args.get("count").and_then(|v| v.as_u64()).unwrap_or(20);
        let working_dir = match &cwd {
            Some(dir) => validate_workspace_path(dir, &self.workspace_roots)?,
            None => PathBuf::from(self.default_root()),
        };
        git_log(&working_dir, count).await
    }

    async fn exec_git_commit(&self, args: &Value) -> AppResult<String> {
        let message = require_str(args, "message")?;
        let cwd = optional_str(args, "cwd");
        let working_dir = match &cwd {
            Some(dir) => validate_workspace_path(dir, &self.workspace_roots)?,
            None => PathBuf::from(self.default_root()),
        };
        git_commit(&working_dir, &message).await
    }

    // -----------------------------------------------------------------------
    // Utility tools
    // -----------------------------------------------------------------------

    async fn exec_mkdir(&self, args: &Value) -> AppResult<String> {
        let path = require_str(args, "path")?;
        let resolved = validate_workspace_path_allow_new(&path, &self.workspace_roots)?;
        mkdir(&resolved).await
    }

    async fn exec_touch(&self, args: &Value) -> AppResult<String> {
        let path = require_str(args, "path")?;
        let resolved = validate_workspace_path_allow_new(&path, &self.workspace_roots)?;
        touch(&resolved).await
    }

    // -----------------------------------------------------------------------
    // New tools: tree, find_definition, web_fetch, git_add, git_checkout
    // -----------------------------------------------------------------------

    async fn exec_tree(&self, args: &Value) -> AppResult<String> {
        let path = optional_str(args, "path");
        let depth = args.get("depth").and_then(|v| v.as_u64()).unwrap_or(4) as usize;
        let root = match &path {
            Some(p) => validate_workspace_path(p, &self.workspace_roots)?,
            None => PathBuf::from(self.default_root()),
        };
        tree(&root, depth).await
    }

    async fn exec_find_definition(&self, args: &Value) -> AppResult<String> {
        let symbol = require_str(args, "symbol")?;
        let path = optional_str(args, "path");
        let language = optional_str(args, "language");
        let root = match &path {
            Some(p) => validate_workspace_path(p, &self.workspace_roots)?,
            None => PathBuf::from(self.default_root()),
        };
        find_definition(&symbol, &root, language.as_deref()).await
    }

    async fn exec_web_fetch(&self, args: &Value) -> AppResult<String> {
        let url = require_str(args, "url")?;
        let max_bytes = args.get("max_bytes").and_then(|v| v.as_u64()).unwrap_or(100_000) as usize;
        web_fetch(&url, max_bytes).await
    }

    async fn exec_git_add(&self, args: &Value) -> AppResult<String> {
        let paths_val = args.get("paths").ok_or_else(|| {
            AppError::message("missing required parameter: paths")
        })?;
        let paths: Vec<String> = if let Some(arr) = paths_val.as_array() {
            arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()
        } else if let Some(s) = paths_val.as_str() {
            vec![s.to_string()]
        } else {
            return Err(AppError::message("paths must be a string or array of strings"));
        };
        let cwd = optional_str(args, "cwd");
        let working_dir = match &cwd {
            Some(dir) => validate_workspace_path(dir, &self.workspace_roots)?,
            None => PathBuf::from(self.default_root()),
        };
        git_add(&working_dir, &paths).await
    }

    async fn exec_git_checkout(&self, args: &Value) -> AppResult<String> {
        let branch = require_str(args, "branch")?;
        let create = args.get("create").and_then(|v| v.as_bool()).unwrap_or(false);
        let cwd = optional_str(args, "cwd");
        let working_dir = match &cwd {
            Some(dir) => validate_workspace_path(dir, &self.workspace_roots)?,
            None => PathBuf::from(self.default_root()),
        };
        git_checkout(&working_dir, &branch, create).await
    }

    // -----------------------------------------------------------------------
    // Sub-agent tools
    // -----------------------------------------------------------------------

    async fn exec_spawn_agent(&self, args: &Value) -> AppResult<String> {
        let ctx = self.sub_agent_ctx.as_ref().ok_or_else(|| {
            AppError::message("spawn_agent requires a sub-agent context")
        })?;
        let cancel = self.cancel.as_ref().cloned().unwrap_or_default();
        let parent_model = self.parent_model.as_deref().unwrap_or("grok-4-1-fast-reasoning");
        let is_ollama = ctx.endpoint_url.is_some();

        let label = require_str(args, "label")?;
        let task = require_str(args, "task")?;
        let model_str = optional_str(args, "model").unwrap_or_else(|| "default".to_string());
        let model_id = crate::sub_agent::resolve_model(&model_str, parent_model, is_ollama);

        let tools: Option<Vec<String>> = args
            .get("tools")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());

        let config = crate::sub_agent::SubAgentConfig {
            agent_id: uuid::Uuid::new_v4().to_string(),
            label: label.clone(),
            model_id,
            system_prompt: format!(
                "You are a focused sub-agent. Your task: {task}\n\n\
                 Be concise and thorough. Return your findings as structured text."
            ),
            max_iterations: 15,
            allowed_tools: tools,
            task,
        };

        // Spawn in a separate task to break async recursion
        // (spawn_agent → run_agent → execute → spawn_agent).
        let ctx = ctx.clone();
        let label2 = label.clone();
        let handle = tokio::spawn(async move {
            crate::sub_agent::run_sub_agent(&ctx, config, cancel, |_| Ok(())).await
        });

        let result = handle.await.map_err(|e| AppError::message(format!("sub-agent task failed: {e}")))?;

        if result.success {
            Ok(format!(
                "[Sub-agent '{}' completed]\n\n{}",
                label2, result.final_text
            ))
        } else {
            Ok(format!(
                "[Sub-agent '{}' failed: {}]",
                label2,
                result.error.unwrap_or_else(|| "unknown error".to_string())
            ))
        }
    }

    async fn exec_spawn_agents_parallel(&self, args: &Value) -> AppResult<String> {
        let ctx = self.sub_agent_ctx.as_ref().ok_or_else(|| {
            AppError::message("spawn_agents_parallel requires a sub-agent context")
        })?;
        let cancel = self.cancel.as_ref().cloned().unwrap_or_default();
        let parent_model = self.parent_model.as_deref().unwrap_or("grok-4-1-fast-reasoning");
        let is_ollama = ctx.endpoint_url.is_some();

        let agents_arr = args
            .get("agents")
            .and_then(|v| v.as_array())
            .ok_or_else(|| AppError::message("missing required parameter: agents"))?;

        let mut configs = Vec::new();
        for agent_val in agents_arr {
            let label = agent_val.get("label").and_then(|v| v.as_str()).unwrap_or("agent").to_string();
            let task = agent_val.get("task").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let model_str = agent_val.get("model").and_then(|v| v.as_str()).unwrap_or("default");
            let model_id = crate::sub_agent::resolve_model(model_str, parent_model, is_ollama);
            let tools: Option<Vec<String>> = agent_val
                .get("tools")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());

            configs.push(crate::sub_agent::SubAgentConfig {
                agent_id: uuid::Uuid::new_v4().to_string(),
                label: label.clone(),
                model_id,
                system_prompt: format!(
                    "You are a focused sub-agent. Your task: {task}\n\n\
                     Be concise and thorough. Return your findings as structured text."
                ),
                max_iterations: 15,
                allowed_tools: tools,
                task,
            });
        }

        let ctx = ctx.clone();
        let handle = tokio::spawn(async move {
            crate::sub_agent::run_sub_agents_parallel(&ctx, configs, cancel).await
        });
        let results = handle.await.map_err(|e| AppError::message(format!("parallel sub-agents failed: {e}")))?;

        let mut output = String::new();
        for result in &results {
            output.push_str(&format!("## Sub-agent: {}\n", result.label));
            if result.success {
                output.push_str(&result.final_text);
            } else {
                output.push_str(&format!(
                    "**Failed:** {}\n",
                    result.error.as_deref().unwrap_or("unknown error")
                ));
            }
            output.push_str("\n\n---\n\n");
        }
        Ok(output)
    }

    // -----------------------------------------------------------------------
    // Memory tools
    // -----------------------------------------------------------------------

    async fn exec_memory_save(&self, args: &Value) -> AppResult<String> {
        let key = require_str(args, "key")?;
        let value = require_str(args, "value")?;
        let db = self.db.as_ref().ok_or_else(|| {
            AppError::message("memory tools require a database connection")
        })?;
        db.upsert_agent_memory(&key, &value)?;
        Ok(format!("saved memory: {key}"))
    }

    async fn exec_memory_recall(&self, args: &Value) -> AppResult<String> {
        let db = self.db.as_ref().ok_or_else(|| {
            AppError::message("memory tools require a database connection")
        })?;
        let query = optional_str(args, "query");
        let memories = match &query {
            Some(q) if !q.is_empty() => db.search_agent_memories(q)?,
            _ => db.list_agent_memories()?,
        };
        if memories.is_empty() {
            return Ok("no memories found".to_string());
        }
        let lines: Vec<String> = memories
            .iter()
            .map(|m| format!("- **{}**: {}", m.key, m.value))
            .collect();
        Ok(lines.join("\n"))
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn default_root(&self) -> &str {
        self.workspace_roots
            .first()
            .map(|s| s.as_str())
            .unwrap_or(".")
    }
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/// Canonicalize `path` and verify it lives under one of `roots`.
pub fn validate_workspace_path(path: &str, roots: &[String]) -> AppResult<PathBuf> {
    let candidate = PathBuf::from(path);

    // If the path is relative (e.g. ".", "src/main.rs"), resolve it against
    // the first workspace root instead of the process cwd.
    let resolved = if candidate.is_relative() {
        if let Some(root) = roots.first() {
            PathBuf::from(root).join(&candidate)
        } else {
            candidate
        }
    } else {
        candidate
    };

    let canonical = resolved.canonicalize().map_err(|e| {
        AppError::message(format!("cannot resolve path \"{path}\": {e}"))
    })?;

    for root in roots {
        if let Ok(root_canonical) = PathBuf::from(root).canonicalize() {
            if canonical.starts_with(&root_canonical) {
                return Ok(canonical);
            }
        }
    }

    Err(AppError::message(format!(
        "path \"{}\" is outside of the workspace",
        canonical.display()
    )))
}

/// Like `validate_workspace_path` but allows paths that do not yet exist by
/// checking the nearest existing ancestor instead.  Used for `mkdir` / `touch`.
fn validate_workspace_path_allow_new(path: &str, roots: &[String]) -> AppResult<PathBuf> {
    let raw = PathBuf::from(path);
    let candidate = if raw.is_relative() {
        if let Some(root) = roots.first() {
            PathBuf::from(root).join(&raw)
        } else {
            raw
        }
    } else {
        raw
    };

    // Walk up to find the first existing ancestor so we can canonicalize it.
    let mut ancestor = candidate.clone();
    loop {
        if ancestor.exists() {
            break;
        }
        if !ancestor.pop() {
            return Err(AppError::message(format!(
                "cannot resolve any ancestor of \"{path}\""
            )));
        }
    }

    let canonical_ancestor = ancestor.canonicalize().map_err(|e| {
        AppError::message(format!("cannot resolve path \"{path}\": {e}"))
    })?;

    // Reconstruct the full target under the canonical ancestor.
    let suffix = candidate
        .strip_prefix(&ancestor)
        .unwrap_or(&candidate);
    let canonical_target = canonical_ancestor.join(suffix);

    for root in roots {
        if let Ok(root_canonical) = PathBuf::from(root).canonicalize() {
            if canonical_target.starts_with(&root_canonical) {
                return Ok(canonical_target);
            }
        }
    }

    Err(AppError::message(format!(
        "path \"{}\" is outside of the workspace",
        canonical_target.display()
    )))
}

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

fn require_str(args: &Value, key: &str) -> AppResult<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::message(format!("missing required parameter: {key}")))
}

fn optional_str(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

// ---------------------------------------------------------------------------
// Tool implementations — filesystem
// ---------------------------------------------------------------------------

async fn read_file(path: &PathBuf, offset: Option<usize>, limit: Option<usize>) -> AppResult<String> {
    let content = tokio::fs::read_to_string(path).await?;
    let lines: Vec<&str> = content.lines().collect();
    let total_lines = lines.len();

    let start = offset.unwrap_or(0);
    if start >= total_lines {
        return Ok(format!("[file has {total_lines} lines, offset {start} is past end]"));
    }

    let end = match limit {
        Some(n) => (start + n).min(total_lines),
        None => total_lines,
    };

    let selected: Vec<String> = lines[start..end]
        .iter()
        .enumerate()
        .map(|(i, line)| format!("{}\t{}", start + i + 1, line))
        .collect();

    let mut result = selected.join("\n");

    // Add metadata when reading a partial range
    if offset.is_some() || limit.is_some() {
        result = format!(
            "[showing lines {}-{} of {total_lines}]\n{result}",
            start + 1,
            end
        );
    }

    Ok(result)
}

async fn write_file(path: &PathBuf, content: &str) -> AppResult<String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(path, content).await?;
    Ok(format!("wrote {} bytes to {}", content.len(), path.display()))
}

async fn edit_file(path: &PathBuf, old_text: &str, new_text: &str, replace_all: bool) -> AppResult<String> {
    let content = tokio::fs::read_to_string(path).await?;
    let count = content.matches(old_text).count();

    if count == 0 {
        // Build a helpful error with a fuzzy hint.
        let hint = find_similar_snippet(&content, old_text);
        let mut msg = String::from("old_text not found in file — no replacements made.");
        if let Some(snippet) = hint {
            msg.push_str(&format!(
                "\n\nDid you mean this nearby text?\n---\n{snippet}\n---"
            ));
        }
        return Err(AppError::message(msg));
    }

    let updated = if replace_all {
        content.replace(old_text, new_text)
    } else {
        content.replacen(old_text, new_text, 1)
    };

    tokio::fs::write(path, &updated).await?;

    // Build a simple unified diff for the output.
    let diff = make_simple_diff(old_text, new_text);
    let replaced = if replace_all { count } else { 1 };
    Ok(format!(
        "replaced {replaced} occurrence(s) in {} ({count} total matches)\n\n{diff}",
        path.display()
    ))
}

/// Find a snippet in `content` that is similar to `needle` (shares a long
/// common substring).  Returns the best candidate or None.
fn find_similar_snippet(content: &str, needle: &str) -> Option<String> {
    if needle.is_empty() || content.is_empty() {
        return None;
    }
    // Trim leading/trailing whitespace from needle lines and search for a
    // partial match on the first meaningful line.
    let first_line = needle.lines().find(|l| !l.trim().is_empty())?;
    let trimmed = first_line.trim();
    if trimmed.len() < 4 {
        return None;
    }
    // Search for the trimmed first line — if found, extract surrounding context.
    let idx = content.find(trimmed)?;
    let start = content[..idx].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let remaining = &content[idx..];
    let end_offset = remaining
        .char_indices()
        .filter(|(_, c)| *c == '\n')
        .nth(4) // show ~5 lines of context
        .map(|(i, _)| idx + i)
        .unwrap_or_else(|| content.len().min(idx + 300));
    Some(content[start..end_offset].to_string())
}

/// Build a minimal unified-diff style representation of the change.
fn make_simple_diff(old: &str, new: &str) -> String {
    let mut diff = String::new();
    for line in old.lines() {
        diff.push_str(&format!("- {line}\n"));
    }
    for line in new.lines() {
        diff.push_str(&format!("+ {line}\n"));
    }
    diff
}

async fn list_directory(path: &PathBuf) -> AppResult<String> {
    let mut entries = tokio::fs::read_dir(path).await?;
    let mut lines = Vec::new();

    while let Some(entry) = entries.next_entry().await? {
        let metadata = entry.metadata().await?;
        let kind = if metadata.is_dir() {
            "dir"
        } else if metadata.is_symlink() {
            "symlink"
        } else {
            "file"
        };
        let size = metadata.len();
        let name = entry.file_name().to_string_lossy().to_string();
        lines.push(format!("{kind}\t{size}\t{name}"));
    }

    lines.sort();
    Ok(lines.join("\n"))
}

async fn search_files(pattern: &str, root: &PathBuf) -> AppResult<String> {
    let pattern = pattern.to_string();
    let root = root.clone();

    let result = tokio::task::spawn_blocking(move || {
        let mut matches = Vec::new();
        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !is_ignored_dir(e.path()))
        {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            // Match against the file name or the relative path.
            let rel = path
                .strip_prefix(&root)
                .unwrap_or(path)
                .to_string_lossy();
            if glob_match(&pattern, name) || glob_match(&pattern, &rel) {
                matches.push(path.to_string_lossy().to_string());
            }
            if matches.len() >= 500 {
                break;
            }
        }

        Ok::<String, AppError>(matches.join("\n"))
    })
    .await
    .map_err(|e| AppError::message(format!("search task failed: {e}")))?;

    result
}

async fn grep(pattern: &str, root: &PathBuf, include: Option<&str>) -> AppResult<String> {
    let mut cmd_args = vec![
        "-rn".to_string(),
        "--color=never".to_string(),
        "-m".to_string(),
        "200".to_string(), // limit to 200 matches per file
    ];

    if let Some(glob) = include {
        cmd_args.push(format!("--include={glob}"));
    }

    cmd_args.push("--".to_string());
    cmd_args.push(pattern.to_string());
    cmd_args.push(root.to_string_lossy().to_string());

    let output = Command::new("grep")
        .args(&cmd_args)
        .output()
        .await?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() && stdout.is_empty() {
        if !stderr.is_empty() {
            return Err(AppError::message(format!("grep error: {stderr}")));
        }
        return Ok("no matches found".to_string());
    }

    // Limit to first 500 lines, then truncate by size.
    let lines: Vec<&str> = stdout.lines().collect();
    let limited = if lines.len() > 500 {
        let kept = lines[..500].join("\n");
        format!("{kept}\n... [{} total matches, showing first 500]", lines.len())
    } else {
        stdout
    };

    let truncated = if limited.len() > 100_000 {
        let cut = &limited[..100_000];
        format!("{cut}\n... output truncated (exceeded 100 KB)")
    } else {
        limited
    };

    Ok(truncated)
}

// ---------------------------------------------------------------------------
// Tool implementations — shell
// ---------------------------------------------------------------------------

#[allow(dead_code)]
const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const MAX_TIMEOUT_MS: u64 = 600_000;

async fn bash(command: &str, cwd: &PathBuf, timeout_ms: u64) -> AppResult<String> {
    let effective_timeout = timeout_ms.min(MAX_TIMEOUT_MS).max(1_000);

    let child = Command::new("bash")
        .arg("-c")
        .arg(command)
        .current_dir(cwd)
        .output();

    let output = tokio::time::timeout(Duration::from_millis(effective_timeout), child)
        .await
        .map_err(|_| {
            AppError::message(format!(
                "command timed out after {effective_timeout}ms"
            ))
        })??;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    let mut result = String::new();
    if !stdout.is_empty() {
        result.push_str(&stdout);
    }
    if !stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str("[stderr]\n");
        result.push_str(&stderr);
    }
    if exit_code != 0 {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(&format!("[exit code: {exit_code}]"));
    }

    // Truncate very large output.
    if result.len() > 200_000 {
        result.truncate(200_000);
        result.push_str("\n... output truncated (exceeded 200 KB)");
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// Tool implementations — git
// ---------------------------------------------------------------------------

async fn git_status(cwd: &PathBuf) -> AppResult<String> {
    run_git(cwd, &["status"]).await
}

async fn git_diff(cwd: &PathBuf) -> AppResult<String> {
    run_git(cwd, &["diff"]).await
}

async fn git_log(cwd: &PathBuf, count: u64) -> AppResult<String> {
    let n_flag = format!("-{count}");
    run_git(cwd, &["log", "--oneline", &n_flag]).await
}

async fn git_commit(cwd: &PathBuf, message: &str) -> AppResult<String> {
    // Stage all changes first.
    let add_output = run_git(cwd, &["add", "-A"]).await?;

    // Then commit.
    let commit_output = run_git(cwd, &["commit", "-m", message]).await?;

    let mut result = String::new();
    if !add_output.trim().is_empty() {
        result.push_str(&add_output);
        result.push('\n');
    }
    result.push_str(&commit_output);
    Ok(result)
}

async fn run_git(cwd: &PathBuf, args: &[&str]) -> AppResult<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let combined = if stderr.is_empty() {
            stdout
        } else {
            format!("{stdout}\n{stderr}")
        };
        return Err(AppError::message(format!(
            "git {} failed: {}",
            args.first().unwrap_or(&""),
            combined.trim()
        )));
    }

    Ok(if stdout.is_empty() { stderr } else { stdout })
}

// ---------------------------------------------------------------------------
// Tool implementations — tree, find_definition, web_fetch
// ---------------------------------------------------------------------------

async fn tree(root: &PathBuf, max_depth: usize) -> AppResult<String> {
    let root = root.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut lines = Vec::new();
        for entry in WalkDir::new(&root)
            .max_depth(max_depth)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !is_ignored_dir(e.path()))
        {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let depth = entry.depth();
            let indent = "  ".repeat(depth);
            let name = entry
                .path()
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(".");
            let suffix = if entry.file_type().is_dir() { "/" } else { "" };
            lines.push(format!("{indent}{name}{suffix}"));
            if lines.len() >= 2000 {
                lines.push("... [truncated at 2000 entries]".to_string());
                break;
            }
        }
        Ok::<String, AppError>(lines.join("\n"))
    })
    .await
    .map_err(|e| AppError::message(format!("tree task failed: {e}")))?;
    result
}

async fn find_definition(symbol: &str, root: &PathBuf, language: Option<&str>) -> AppResult<String> {
    // Build a pattern that matches common definition forms across languages.
    let patterns: Vec<String> = match language {
        Some("rust" | "rs") => vec![
            format!(r"(fn|struct|enum|trait|type|const|static|mod|impl)\s+{symbol}\b"),
        ],
        Some("python" | "py") => vec![
            format!(r"(def|class)\s+{symbol}\b"),
        ],
        Some("javascript" | "typescript" | "js" | "ts" | "tsx" | "jsx") => vec![
            format!(r"(function|class|const|let|var|interface|type|enum)\s+{symbol}\b"),
            format!(r"(export\s+(default\s+)?(function|class|const|let|var|interface|type))\s+{symbol}\b"),
        ],
        Some("go") => vec![
            format!(r"(func|type|var|const)\s+{symbol}\b"),
        ],
        Some("java" | "kotlin") => vec![
            format!(r"(class|interface|enum|record)\s+{symbol}\b"),
            format!(r"(public|private|protected|static).*\s+{symbol}\s*\("),
        ],
        _ => vec![
            // Universal: catch most languages
            format!(r"(fn|function|def|class|struct|enum|trait|type|interface|const|let|var|func|impl|mod)\s+{symbol}\b"),
        ],
    };

    let combined = patterns.join("|");
    let mut cmd_args = vec![
        "-rnE".to_string(),
        "--color=never".to_string(),
        "-m".to_string(),
        "50".to_string(),
    ];
    cmd_args.push("--".to_string());
    cmd_args.push(combined);
    cmd_args.push(root.to_string_lossy().to_string());

    let output = Command::new("grep")
        .args(&cmd_args)
        .output()
        .await?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.is_empty() {
        return Ok(format!("no definition found for '{symbol}'"));
    }
    Ok(stdout)
}

async fn web_fetch(url: &str, max_bytes: usize) -> AppResult<String> {
    // Basic URL validation
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::message("URL must start with http:// or https://"));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::message(format!("failed to create HTTP client: {e}")))?;

    let response = client.get(url).send().await.map_err(|e| {
        AppError::message(format!("fetch failed: {e}"))
    })?;

    let status = response.status();
    if !status.is_success() {
        return Err(AppError::message(format!("HTTP {status}")));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let bytes = response.bytes().await.map_err(|e| {
        AppError::message(format!("failed to read response: {e}"))
    })?;

    let body = if bytes.len() > max_bytes {
        let truncated = String::from_utf8_lossy(&bytes[..max_bytes]).to_string();
        format!("{truncated}\n... [truncated at {max_bytes} bytes]")
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };

    // Strip HTML tags if content-type is HTML (simple regex-free approach).
    let text = if content_type.contains("text/html") {
        strip_html_tags(&body)
    } else {
        body
    };

    Ok(text)
}

/// Very simple HTML tag stripper — not a full parser, but good enough for
/// extracting readable text from fetched web pages.
fn strip_html_tags(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut in_script = false;
    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
            // Peek for script/style start (crude but functional).
            let lower = html[result.len()..].to_lowercase();
            if lower.starts_with("<script") || lower.starts_with("<style") {
                in_script = true;
            }
            if lower.starts_with("</script") || lower.starts_with("</style") {
                in_script = false;
            }
            continue;
        }
        if ch == '>' {
            in_tag = false;
            continue;
        }
        if !in_tag && !in_script {
            result.push(ch);
        }
    }
    // Collapse excessive whitespace.
    let mut collapsed = String::new();
    let mut last_was_newline = false;
    for line in result.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !last_was_newline {
                collapsed.push('\n');
                last_was_newline = true;
            }
        } else {
            collapsed.push_str(trimmed);
            collapsed.push('\n');
            last_was_newline = false;
        }
    }
    collapsed
}

async fn git_add(cwd: &PathBuf, paths: &[String]) -> AppResult<String> {
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths.iter().cloned());
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_git(cwd, &arg_refs).await
}

async fn git_checkout(cwd: &PathBuf, branch: &str, create: bool) -> AppResult<String> {
    if create {
        run_git(cwd, &["checkout", "-b", branch]).await
    } else {
        run_git(cwd, &["checkout", branch]).await
    }
}

// ---------------------------------------------------------------------------
// Tool implementations — utilities
// ---------------------------------------------------------------------------

async fn mkdir(path: &PathBuf) -> AppResult<String> {
    tokio::fs::create_dir_all(path).await?;
    Ok(format!("created directory {}", path.display()))
}

async fn touch(path: &PathBuf) -> AppResult<String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    if !path.exists() {
        tokio::fs::write(path, "").await?;
        Ok(format!("created file {}", path.display()))
    } else {
        // Update mtime by opening for append.
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(path)
            .await?;
        Ok(format!("touched {}", path.display()))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Simple glob matching supporting `*` (any chars except `/`), `**` (any chars
/// including `/`), and `?` (single char).  Good enough for file-search patterns
/// without pulling in an extra crate.
fn glob_match(pattern: &str, text: &str) -> bool {
    glob_match_inner(pattern.as_bytes(), text.as_bytes())
}

fn glob_match_inner(pattern: &[u8], text: &[u8]) -> bool {
    let (mut px, mut tx) = (0usize, 0usize);
    let (mut star_px, mut star_tx) = (usize::MAX, 0usize);
    let (mut dstar_px, mut dstar_tx) = (usize::MAX, 0usize);

    while tx < text.len() {
        if px < pattern.len()
            && px + 1 < pattern.len()
            && pattern[px] == b'*'
            && pattern[px + 1] == b'*'
        {
            // `**` — matches everything including `/`.
            dstar_px = px;
            dstar_tx = tx;
            px += 2;
            // Skip trailing `/` after `**`.
            if px < pattern.len() && pattern[px] == b'/' {
                px += 1;
            }
        } else if px < pattern.len() && pattern[px] == b'*' {
            star_px = px;
            star_tx = tx;
            px += 1;
        } else if px < pattern.len()
            && (pattern[px] == b'?' || pattern[px] == text[tx])
        {
            px += 1;
            tx += 1;
        } else if star_px != usize::MAX && text[star_tx] != b'/' {
            star_tx += 1;
            tx = star_tx;
            px = star_px + 1;
        } else if dstar_px != usize::MAX {
            dstar_tx += 1;
            tx = dstar_tx;
            px = dstar_px + 2;
            if px < pattern.len() && pattern[px] == b'/' {
                px += 1;
            }
            star_px = usize::MAX; // reset single-star
        } else {
            return false;
        }
    }

    // Consume trailing `*` or `**`.
    while px < pattern.len() && pattern[px] == b'*' {
        px += 1;
    }

    px == pattern.len()
}

fn is_ignored_dir(path: &std::path::Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|name| matches!(name, ".git" | "node_modules" | "target" | ".next" | "dist" | "__pycache__"))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Tool definitions — JSON schemas for the xAI / OpenAI function-calling API
// ---------------------------------------------------------------------------

fn def_read_file() -> ToolDefinition {
    ToolDefinition {
        name: "read_file".into(),
        description: "Read the contents of a file at the given path within the workspace. Use offset and limit to read specific line ranges of large files.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute or workspace-relative file path to read"
                },
                "offset": {
                    "type": "integer",
                    "description": "Line number to start reading from (0-based). Omit to start from the beginning."
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of lines to read. Omit to read the entire file."
                }
            },
            "required": ["path"]
        }),
    }
}

fn def_write_file() -> ToolDefinition {
    ToolDefinition {
        name: "write_file".into(),
        description: "Write content to a file, creating it (and parent directories) if it does not exist, or overwriting if it does.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path within the workspace"
                },
                "content": {
                    "type": "string",
                    "description": "Content to write to the file"
                }
            },
            "required": ["path", "content"]
        }),
    }
}

fn def_edit_file() -> ToolDefinition {
    ToolDefinition {
        name: "edit_file".into(),
        description: "Find and replace exact text in a file. Replaces the first occurrence by default. Returns a diff of the change.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path within the workspace"
                },
                "old_text": {
                    "type": "string",
                    "description": "The exact text to find in the file (must match including whitespace/indentation)"
                },
                "new_text": {
                    "type": "string",
                    "description": "The replacement text"
                },
                "replace_all": {
                    "type": "boolean",
                    "description": "If true, replace ALL occurrences instead of just the first. Default false."
                }
            },
            "required": ["path", "old_text", "new_text"]
        }),
    }
}

fn def_list_directory() -> ToolDefinition {
    ToolDefinition {
        name: "list_directory".into(),
        description: "List directory contents with file types (file/dir/symlink) and sizes.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory path within the workspace"
                }
            },
            "required": ["path"]
        }),
    }
}

fn def_search_files() -> ToolDefinition {
    ToolDefinition {
        name: "search_files".into(),
        description: "Search for files matching a glob pattern within the workspace. Returns up to 500 matching file paths.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Glob pattern to match file names (e.g. \"*.rs\", \"**/*.json\")"
                },
                "path": {
                    "type": "string",
                    "description": "Directory to search in. Defaults to the first workspace root."
                }
            },
            "required": ["pattern"]
        }),
    }
}

fn def_grep() -> ToolDefinition {
    ToolDefinition {
        name: "grep".into(),
        description: "Search file contents for a pattern using grep. Returns matching lines with file paths and line numbers.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Search pattern (regular expression or literal string)"
                },
                "path": {
                    "type": "string",
                    "description": "Directory to search in. Defaults to the first workspace root."
                },
                "include": {
                    "type": "string",
                    "description": "Optional file glob filter (e.g. \"*.rs\", \"*.{ts,tsx}\")"
                }
            },
            "required": ["pattern"]
        }),
    }
}

fn def_bash() -> ToolDefinition {
    ToolDefinition {
        name: "bash".into(),
        description: "Execute a shell command via bash. Returns stdout, stderr, and exit code.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute"
                },
                "cwd": {
                    "type": "string",
                    "description": "Working directory. Must be within the workspace. Defaults to the first workspace root."
                },
                "timeout_ms": {
                    "type": "integer",
                    "description": "Timeout in milliseconds (default 120000, max 600000)"
                }
            },
            "required": ["command"]
        }),
    }
}

fn def_git_status() -> ToolDefinition {
    ToolDefinition {
        name: "git_status".into(),
        description: "Run `git status` in the workspace and return the output.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "cwd": {
                    "type": "string",
                    "description": "Working directory for git. Defaults to the first workspace root."
                }
            },
            "required": []
        }),
    }
}

fn def_git_diff() -> ToolDefinition {
    ToolDefinition {
        name: "git_diff".into(),
        description: "Run `git diff` in the workspace and return the output.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "cwd": {
                    "type": "string",
                    "description": "Working directory for git. Defaults to the first workspace root."
                }
            },
            "required": []
        }),
    }
}

fn def_git_log() -> ToolDefinition {
    ToolDefinition {
        name: "git_log".into(),
        description: "Run `git log --oneline` and return recent commits.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "cwd": {
                    "type": "string",
                    "description": "Working directory for git. Defaults to the first workspace root."
                },
                "count": {
                    "type": "integer",
                    "description": "Number of commits to show (default 20)"
                }
            },
            "required": []
        }),
    }
}

fn def_git_commit() -> ToolDefinition {
    ToolDefinition {
        name: "git_commit".into(),
        description: "Stage all changes with `git add -A` and commit with the given message.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "cwd": {
                    "type": "string",
                    "description": "Working directory for git. Defaults to the first workspace root."
                },
                "message": {
                    "type": "string",
                    "description": "The commit message"
                }
            },
            "required": ["message"]
        }),
    }
}

fn def_mkdir() -> ToolDefinition {
    ToolDefinition {
        name: "mkdir".into(),
        description: "Create a directory and any necessary parent directories within the workspace.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory path to create within the workspace"
                }
            },
            "required": ["path"]
        }),
    }
}

fn def_touch() -> ToolDefinition {
    ToolDefinition {
        name: "touch".into(),
        description: "Create an empty file (or update its modification time if it already exists) within the workspace.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path to create or touch within the workspace"
                }
            },
            "required": ["path"]
        }),
    }
}

fn def_tree() -> ToolDefinition {
    ToolDefinition {
        name: "tree".into(),
        description: "Show a recursive directory tree (respects .gitignore-style ignores). Better than list_directory for understanding project structure.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Root directory. Defaults to the first workspace root."
                },
                "depth": {
                    "type": "integer",
                    "description": "Maximum depth to recurse (default 4)"
                }
            },
            "required": []
        }),
    }
}

fn def_find_definition() -> ToolDefinition {
    ToolDefinition {
        name: "find_definition".into(),
        description: "Find function, class, struct, or type definitions by symbol name. Faster than grep for locating definitions.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "The symbol name to search for (function, class, struct, etc.)"
                },
                "path": {
                    "type": "string",
                    "description": "Directory to search in. Defaults to the first workspace root."
                },
                "language": {
                    "type": "string",
                    "description": "Programming language hint: rust, python, javascript, typescript, go, java. Improves accuracy."
                }
            },
            "required": ["symbol"]
        }),
    }
}

fn def_web_fetch() -> ToolDefinition {
    ToolDefinition {
        name: "web_fetch".into(),
        description: "Fetch a URL and return its text content. HTML pages are stripped to plain text. Respects a 30-second timeout.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to fetch (must start with http:// or https://)"
                },
                "max_bytes": {
                    "type": "integer",
                    "description": "Maximum response size in bytes (default 100000)"
                }
            },
            "required": ["url"]
        }),
    }
}

fn def_git_add() -> ToolDefinition {
    ToolDefinition {
        name: "git_add".into(),
        description: "Stage specific files for the next commit. Safer than git_commit which stages everything.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "paths": {
                    "description": "File path(s) to stage. Can be a single string or an array of strings.",
                    "oneOf": [
                        { "type": "string" },
                        { "type": "array", "items": { "type": "string" } }
                    ]
                },
                "cwd": {
                    "type": "string",
                    "description": "Working directory for git. Defaults to the first workspace root."
                }
            },
            "required": ["paths"]
        }),
    }
}

fn def_git_checkout() -> ToolDefinition {
    ToolDefinition {
        name: "git_checkout".into(),
        description: "Switch to a different git branch, optionally creating it.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "branch": {
                    "type": "string",
                    "description": "Branch name to switch to"
                },
                "create": {
                    "type": "boolean",
                    "description": "If true, create the branch (git checkout -b). Default false."
                },
                "cwd": {
                    "type": "string",
                    "description": "Working directory for git. Defaults to the first workspace root."
                }
            },
            "required": ["branch"]
        }),
    }
}

fn def_spawn_agent() -> ToolDefinition {
    ToolDefinition {
        name: "spawn_agent".into(),
        description: "Launch a focused sub-agent for a specific task. The sub-agent runs independently with its own context and returns a result. Use for tasks that can be delegated.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "label": {
                    "type": "string",
                    "description": "Short label for the sub-agent task (e.g. 'code-explorer', 'reviewer')"
                },
                "task": {
                    "type": "string",
                    "description": "Detailed instruction for the sub-agent — what it should do and return"
                },
                "tools": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Tool names to make available (optional, defaults to read-only set: read_file, list_directory, search_files, grep, tree, find_definition, git_status, git_diff, git_log)"
                },
                "model": {
                    "type": "string",
                    "description": "Model override: 'fast' for quick lookups, 'best' for complex reasoning, 'default' for current model, or a specific model ID"
                }
            },
            "required": ["label", "task"]
        }),
    }
}

fn def_spawn_agents_parallel() -> ToolDefinition {
    ToolDefinition {
        name: "spawn_agents_parallel".into(),
        description: "Launch multiple sub-agents in parallel. Each runs independently and returns results. Use when tasks are independent of each other.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "agents": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": { "type": "string", "description": "Short label for this sub-agent" },
                            "task": { "type": "string", "description": "Task instruction" },
                            "tools": { "type": "array", "items": { "type": "string" }, "description": "Available tool names (optional)" },
                            "model": { "type": "string", "description": "Model: 'fast', 'best', 'default', or specific ID" }
                        },
                        "required": ["label", "task"]
                    },
                    "description": "Array of sub-agent configurations to run in parallel"
                }
            },
            "required": ["agents"]
        }),
    }
}

fn def_memory_save() -> ToolDefinition {
    ToolDefinition {
        name: "memory_save".into(),
        description: "Save a fact to persistent memory for use in future conversations. Use descriptive keys.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": "A short, descriptive key for the memory (e.g. \"user_prefers_rust\", \"project_uses_tauri\")"
                },
                "value": {
                    "type": "string",
                    "description": "The fact or information to remember"
                }
            },
            "required": ["key", "value"]
        }),
    }
}

fn def_memory_recall() -> ToolDefinition {
    ToolDefinition {
        name: "memory_recall".into(),
        description: "Search saved memories by keyword, or list all memories if no query is given.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Optional keyword to search for in memory keys and values. Omit to list all memories."
                }
            },
            "required": []
        }),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn validate_path_inside_workspace() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let file = dir.path().join("test.txt");
        std::fs::write(&file, "hello").unwrap();

        let result = validate_workspace_path(
            file.to_str().unwrap(),
            &[root],
        );
        assert!(result.is_ok());
    }

    #[test]
    fn validate_path_outside_workspace_fails() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        let result = validate_workspace_path("/etc/passwd", &[root]);
        assert!(result.is_err());
    }

    #[test]
    fn registry_definitions_not_empty() {
        let registry = ToolRegistry::new(vec!["/tmp".into()]);
        let defs = registry.definitions();
        assert!(!defs.is_empty());
        assert!(defs.iter().any(|d| d.name == "read_file"));
        assert!(defs.iter().any(|d| d.name == "bash"));
        assert!(defs.iter().any(|d| d.name == "git_status"));
    }

    #[tokio::test]
    async fn execute_unknown_tool_returns_error() {
        let registry = ToolRegistry::new(vec!["/tmp".into()]);
        let result = registry.execute("nonexistent", &json!({})).await;
        assert!(!result.success);
        assert!(result.error.is_some());
    }

    #[tokio::test]
    async fn read_file_works() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let file = dir.path().join("hello.txt");
        std::fs::write(&file, "world").unwrap();

        let registry = ToolRegistry::new(vec![root]);
        let result = registry
            .execute(
                "read_file",
                &json!({ "path": file.to_str().unwrap() }),
            )
            .await;
        assert!(result.success);
        assert_eq!(result.output, "world");
    }

    #[tokio::test]
    async fn bash_respects_timeout() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        let registry = ToolRegistry::new(vec![root]);
        let result = registry
            .execute(
                "bash",
                &json!({
                    "command": "sleep 30",
                    "timeout_ms": 1000
                }),
            )
            .await;
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap_or("").contains("timed out"));
    }
}
