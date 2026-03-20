use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::process::Command;
use walkdir::WalkDir;

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
// ToolRegistry
// ---------------------------------------------------------------------------

/// Central registry that holds workspace roots and exposes every available tool.
#[derive(Debug, Clone)]
pub struct ToolRegistry {
    workspace_roots: Vec<String>,
}

impl ToolRegistry {
    pub fn new(workspace_roots: Vec<String>) -> Self {
        Self { workspace_roots }
    }

    /// Returns all tool definitions for the xAI / OpenAI function-calling API.
    pub fn definitions(&self) -> Vec<ToolDefinition> {
        vec![
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
            def_mkdir(),
            def_touch(),
        ]
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
            _ => Err(AppError::message(format!("unknown tool: {tool_name}"))),
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
        read_file(&resolved).await
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
        let resolved = validate_workspace_path(&path, &self.workspace_roots)?;
        edit_file(&resolved, &old_text, &new_text).await
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
    let canonical = candidate.canonicalize().map_err(|e| {
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
    let candidate = PathBuf::from(path);

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

async fn read_file(path: &PathBuf) -> AppResult<String> {
    let content = tokio::fs::read_to_string(path).await?;
    Ok(content)
}

async fn write_file(path: &PathBuf, content: &str) -> AppResult<String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(path, content).await?;
    Ok(format!("wrote {} bytes to {}", content.len(), path.display()))
}

async fn edit_file(path: &PathBuf, old_text: &str, new_text: &str) -> AppResult<String> {
    let content = tokio::fs::read_to_string(path).await?;
    let count = content.matches(old_text).count();
    if count == 0 {
        return Err(AppError::message(
            "old_text not found in file — no replacements made",
        ));
    }
    let updated = content.replacen(old_text, new_text, 1);
    tokio::fs::write(path, &updated).await?;
    Ok(format!(
        "replaced 1 occurrence in {} ({count} total matches found)",
        path.display()
    ))
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

    // Truncate very large output.
    let truncated = if stdout.len() > 100_000 {
        let cut = &stdout[..100_000];
        format!("{cut}\n... output truncated (exceeded 100 KB)")
    } else {
        stdout
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
        description: "Read the contents of a file at the given path within the workspace.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute or workspace-relative file path to read"
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
        description: "Find and replace text in a file. Performs an exact string match of old_text and replaces the first occurrence with new_text.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path within the workspace"
                },
                "old_text": {
                    "type": "string",
                    "description": "The exact text to find in the file"
                },
                "new_text": {
                    "type": "string",
                    "description": "The replacement text"
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
