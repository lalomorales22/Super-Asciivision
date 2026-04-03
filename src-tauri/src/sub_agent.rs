//! Sub-agent orchestration — spawn focused child agents that run independently
//! with their own tool scope, model, and system prompt.

use serde::Serialize;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error};

use crate::agent::{self, AgentConfig, AgentEvent, AgentLoopResult, ToolCallRecord};
use crate::error::{AppError, AppResult};
use crate::permissions::PermissionConfig;
use crate::types::TokenUsage;

// ---------------------------------------------------------------------------
// Configuration & result types
// ---------------------------------------------------------------------------

/// Configuration for a single sub-agent.
#[derive(Debug, Clone)]
pub struct SubAgentConfig {
    /// Unique ID for tracking this sub-agent.
    pub agent_id: String,
    /// Human-readable label (e.g. "code-explorer", "reviewer").
    pub label: String,
    /// Model ID — can differ from the parent agent.
    pub model_id: String,
    /// System prompt for this sub-agent.
    pub system_prompt: String,
    /// Maximum iterations for this sub-agent.
    pub max_iterations: usize,
    /// Tool names this sub-agent is allowed to use.
    pub allowed_tools: Option<Vec<String>>,
    /// The task prompt — what the sub-agent should do.
    pub task: String,
}

/// Result from a sub-agent run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentResult {
    pub agent_id: String,
    pub label: String,
    pub final_text: String,
    pub tool_calls_made: Vec<ToolCallRecord>,
    pub usage: TokenUsage,
    pub success: bool,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Sub-agent runner context
// ---------------------------------------------------------------------------

/// Shared resources needed by sub-agents.  Cloned from the parent agent's
/// context so each sub-agent can run independently.
#[derive(Debug, Clone)]
pub struct SubAgentContext {
    pub client: reqwest::Client,
    pub api_key: String,
    pub endpoint_url: Option<String>,
    pub workspace_roots: Vec<String>,
    pub db: Option<crate::db::Database>,
    pub permissions: PermissionConfig,
}

// ---------------------------------------------------------------------------
// Run a single sub-agent
// ---------------------------------------------------------------------------

pub fn run_sub_agent(
    ctx: &SubAgentContext,
    config: SubAgentConfig,
    cancel: CancellationToken,
    on_event: impl Fn(AgentEvent) -> AppResult<()> + Send + 'static,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = SubAgentResult> + Send + '_>> {
    Box::pin(run_sub_agent_inner(ctx, config, cancel, on_event))
}

async fn run_sub_agent_inner(
    ctx: &SubAgentContext,
    config: SubAgentConfig,
    cancel: CancellationToken,
    on_event: impl Fn(AgentEvent) -> AppResult<()> + Send,
) -> SubAgentResult {
    debug!(
        agent_id = %config.agent_id,
        label = %config.label,
        model = %config.model_id,
        "sub-agent starting"
    );

    let agent_config = AgentConfig {
        model_id: config.model_id.clone(),
        system_prompt: config.system_prompt.clone(),
        max_iterations: config.max_iterations,
        workspace_roots: ctx.workspace_roots.clone(),
        endpoint_url: ctx.endpoint_url.clone(),
        permissions: ctx.permissions.clone(),
        allowed_tools: config.allowed_tools.clone(),
        max_output_tokens: Some(8192),
    };

    let mut tool_registry = crate::tools::ToolRegistry::new(ctx.workspace_roots.clone());
    if let Some(ref db) = ctx.db {
        tool_registry = tool_registry.with_db(db.clone());
    }

    // Sub-agent starts with a single user message — the task prompt.
    let history = vec![serde_json::json!({
        "role": "user",
        "content": config.task,
    })];

    let result = agent::run_agent(
        &ctx.client,
        &ctx.api_key,
        &agent_config,
        history,
        &tool_registry,
        cancel,
        on_event,
        None, // sub-agents auto-approve (no interactive approval)
    )
    .await;

    match result {
        Ok(agent_result) => {
            debug!(
                agent_id = %config.agent_id,
                iterations = agent_result.iterations,
                "sub-agent completed successfully"
            );
            SubAgentResult {
                agent_id: config.agent_id,
                label: config.label,
                final_text: agent_result.final_text,
                tool_calls_made: agent_result.tool_calls_made,
                usage: agent_result.usage,
                success: true,
                error: None,
            }
        }
        Err(e) => {
            error!(
                agent_id = %config.agent_id,
                error = %e,
                "sub-agent failed"
            );
            SubAgentResult {
                agent_id: config.agent_id,
                label: config.label,
                final_text: String::new(),
                tool_calls_made: Vec::new(),
                usage: TokenUsage {
                    input_tokens: None,
                    output_tokens: None,
                },
                success: false,
                error: Some(e.to_string()),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Run multiple sub-agents in parallel
// ---------------------------------------------------------------------------

pub async fn run_sub_agents_parallel(
    ctx: &SubAgentContext,
    configs: Vec<SubAgentConfig>,
    cancel: CancellationToken,
) -> Vec<SubAgentResult> {
    let mut handles = Vec::with_capacity(configs.len());

    for config in configs {
        let ctx = ctx.clone();
        let cancel = cancel.clone();

        let handle = tokio::spawn(async move {
            // Sub-agents running in parallel don't emit events to the frontend
            // (their results are aggregated by the parent).  We swallow events.
            run_sub_agent(&ctx, config, cancel, |_event| Ok(())).await
        });

        handles.push(handle);
    }

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        match handle.await {
            Ok(result) => results.push(result),
            Err(e) => {
                error!("sub-agent task panicked: {e}");
                results.push(SubAgentResult {
                    agent_id: String::new(),
                    label: "unknown".into(),
                    final_text: String::new(),
                    tool_calls_made: Vec::new(),
                    usage: TokenUsage {
                        input_tokens: None,
                        output_tokens: None,
                    },
                    success: false,
                    error: Some(format!("sub-agent panicked: {e}")),
                });
            }
        }
    }

    results
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

/// Resolve a logical model name to an actual model ID.
///
/// Logical names:
/// - `"fast"` → fast reasoning model
/// - `"best"` → most capable model
/// - `"default"` → whatever the parent is using
/// - anything else → pass through as-is
pub fn resolve_model(logical: &str, parent_model: &str, is_ollama: bool) -> String {
    match logical {
        "fast" => {
            if is_ollama {
                // Use the parent model for Ollama (user controls what's available)
                parent_model.to_string()
            } else {
                "grok-3-mini-fast".to_string()
            }
        }
        "best" => {
            if is_ollama {
                parent_model.to_string()
            } else {
                "grok-4-1".to_string()
            }
        }
        "default" | "" => parent_model.to_string(),
        other => other.to_string(),
    }
}
