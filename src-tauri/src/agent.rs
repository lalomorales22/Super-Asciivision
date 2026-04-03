use std::collections::HashMap;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, warn};

use crate::error::{AppError, AppResult};
use crate::types::TokenUsage;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Controls the behaviour of a single agent run.
#[derive(Debug, Clone)]
pub struct AgentConfig {
    pub model_id: String,
    pub system_prompt: String,
    /// Hard ceiling on the number of LLM round-trips (tool-call iterations).
    pub max_iterations: usize,
    /// Workspace root directories available to tools.
    #[allow(dead_code)]
    pub workspace_roots: Vec<String>,
    /// Override the chat endpoint (defaults to xAI).
    pub endpoint_url: Option<String>,
    /// Tool permission configuration.
    pub permissions: crate::permissions::PermissionConfig,
    /// If set, only these tools are available to the agent.
    /// `None` means all tools are available.
    pub allowed_tools: Option<Vec<String>>,
    /// Maximum output tokens per LLM call.
    pub max_output_tokens: Option<u32>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            model_id: "grok-4-1-fast-reasoning".into(),
            system_prompt: String::new(),
            max_iterations: 25,
            workspace_roots: Vec::new(),
            endpoint_url: None,
            permissions: crate::permissions::PermissionConfig::defaults(),
            allowed_tools: None,
            max_output_tokens: Some(16384),
        }
    }
}

// ---------------------------------------------------------------------------
// Events streamed to the frontend
// ---------------------------------------------------------------------------

/// Events emitted during an agent run so the UI can show progress.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "kind")]
pub enum AgentEvent {
    #[serde(rename = "thinking")]
    Thinking {
        message: String,
        /// Optional phase hint for the UI: "llm_call", "tool_exec", "compaction", "planning"
        #[serde(skip_serializing_if = "Option::is_none")]
        phase: Option<String>,
    },
    #[serde(rename = "tool_call")]
    ToolCall {
        tool_name: String,
        tool_input: String,
        call_id: String,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        call_id: String,
        tool_name: String,
        success: bool,
        output: String,
    },
    #[serde(rename = "permission_request")]
    PermissionRequest {
        call_id: String,
        tool_name: String,
        tool_input: String,
        reason: String,
    },
    #[serde(rename = "sub_agent_started")]
    SubAgentStarted { agent_id: String, label: String },
    #[serde(rename = "sub_agent_complete")]
    SubAgentComplete {
        agent_id: String,
        label: String,
        success: bool,
        summary: String,
    },
    /// Streamed reasoning/thinking content from xAI reasoning models.
    #[serde(rename = "reasoning_delta")]
    ReasoningDelta { text: String },
    #[serde(rename = "text_delta")]
    TextDelta { text: String },
    #[serde(rename = "complete")]
    Complete { text: String, iterations: usize },
    #[serde(rename = "error")]
    Error { message: String },
}

// ---------------------------------------------------------------------------
// Tool-call parsing (OpenAI-compatible format from xAI)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: Option<String>,
    pub function: ToolCallFunction,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolCallFunction {
    pub name: String,
    /// Raw JSON string containing the arguments object.
    pub arguments: String,
}

// ---------------------------------------------------------------------------
// Agent loop result
// ---------------------------------------------------------------------------

/// The full result returned when the agent loop finishes.
#[derive(Debug, Clone)]
pub struct AgentLoopResult {
    pub final_text: String,
    #[allow(dead_code)]
    pub iterations: usize,
    pub tool_calls_made: Vec<ToolCallRecord>,
    pub usage: TokenUsage,
}

/// Record of a single tool invocation that occurred during the agent run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRecord {
    pub call_id: String,
    pub tool_name: String,
    pub arguments: String,
    pub result: String,
    pub success: bool,
}

// ---------------------------------------------------------------------------
// Internal: streamed delta accumulator for tool calls
// ---------------------------------------------------------------------------

/// Accumulates incremental tool-call deltas from SSE chunks into complete
/// `ToolCall` objects.  xAI/OpenAI streams tool calls as:
///   - First chunk for index N: `{ index: N, id: "...", function: { name: "...", arguments: "" } }`
///   - Subsequent chunks:       `{ index: N, function: { arguments: "<next chunk>" } }`
#[derive(Debug, Default)]
struct ToolCallAccumulator {
    /// Keyed by tool-call index within the current response.
    calls: HashMap<u64, (String, String, String)>, // (id, name, arguments_buffer)
}

impl ToolCallAccumulator {
    fn push_delta(&mut self, delta: &Value) {
        let index = delta.get("index").and_then(Value::as_u64).unwrap_or(0);
        let entry = self.calls.entry(index).or_insert_with(|| {
            let id = delta.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let name = delta
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            (id, name, String::new())
        });
        // Always append argument fragments.
        if let Some(arg_chunk) = delta
            .get("function")
            .and_then(|f| f.get("arguments"))
            .and_then(Value::as_str)
        {
            entry.2.push_str(arg_chunk);
        }
        // Update id/name if provided (first chunk).
        if let Some(id) = delta.get("id").and_then(Value::as_str) {
            if !id.is_empty() {
                entry.0 = id.to_string();
            }
        }
        if let Some(name) = delta
            .get("function")
            .and_then(|f| f.get("name"))
            .and_then(Value::as_str)
        {
            if !name.is_empty() {
                entry.1 = name.to_string();
            }
        }
    }

    fn finish(self) -> Vec<ToolCall> {
        let mut indices: Vec<u64> = self.calls.keys().copied().collect();
        indices.sort_unstable();
        indices
            .into_iter()
            .filter_map(|idx| {
                let (id, name, args) = self.calls.get(&idx)?;
                if name.is_empty() {
                    return None;
                }
                Some(ToolCall {
                    id: id.clone(),
                    call_type: Some("function".into()),
                    function: ToolCallFunction {
                        name: name.clone(),
                        arguments: args.clone(),
                    },
                })
            })
            .collect()
    }

    fn is_empty(&self) -> bool {
        self.calls.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Internal response structures (for non-streaming fallback / error parsing)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ChatErrorResponse {
    error: Option<ChatErrorDetail>,
}

#[derive(Debug, Deserialize)]
struct ChatErrorDetail {
    message: Option<String>,
}

// ---------------------------------------------------------------------------
// The agent execution loop (streaming)
// ---------------------------------------------------------------------------

const XAI_CHAT_ENDPOINT: &str = "https://api.x.ai/v1/chat/completions";

/// Runs the agentic loop with **streaming** responses.  Sends chat requests
/// with tool definitions to an OpenAI-compatible endpoint, streams the
/// response, executes any tool calls the model returns, feeds results back,
/// and repeats until the model produces a final text response (or the
/// iteration limit / cancellation token fires).
/// Channel for receiving tool-call approval decisions from the frontend.
/// `None` means auto-approve everything (no interactive permission checks).
pub type ApprovalReceiver = tokio::sync::mpsc::Receiver<ToolApproval>;

/// A decision from the user about whether to allow a tool call.
#[derive(Debug, Clone)]
pub struct ToolApproval {
    pub call_id: String,
    pub approved: bool,
}

pub async fn run_agent(
    client: &reqwest::Client,
    api_key: &str,
    config: &AgentConfig,
    history: Vec<Value>,
    tools: &crate::tools::ToolRegistry,
    cancel: CancellationToken,
    on_event: impl Fn(AgentEvent) -> AppResult<()>,
    mut approval_rx: Option<&mut ApprovalReceiver>,
) -> AppResult<AgentLoopResult> {
    // -- Build the tools array in OpenAI function-calling format ------------
    let all_defs = tools.definitions();
    let filtered_defs: Vec<_> = match &config.allowed_tools {
        Some(allowed) => all_defs
            .into_iter()
            .filter(|def| allowed.iter().any(|a| a == &def.name))
            .collect(),
        None => all_defs,
    };
    let tool_definitions: Vec<Value> = filtered_defs
        .iter()
        .map(|def| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": def.name,
                    "description": def.description,
                    "parameters": def.parameters,
                }
            })
        })
        .collect();

    // -- Seed the messages list with an optional system prompt + history -----
    let mut messages: Vec<Value> = Vec::new();

    if !config.system_prompt.is_empty() {
        messages.push(serde_json::json!({
            "role": "system",
            "content": config.system_prompt,
        }));
    }

    messages.extend(history);

    // -- Accumulators -------------------------------------------------------
    let mut total_usage = TokenUsage {
        input_tokens: None,
        output_tokens: None,
    };
    let mut tool_call_records: Vec<ToolCallRecord> = Vec::new();
    let mut iterations: usize = 0;

    // -- Main loop ----------------------------------------------------------
    loop {
        // Check cancellation before each round-trip.
        if cancel.is_cancelled() {
            return Err(AppError::message("cancelled"));
        }

        if iterations >= config.max_iterations {
            warn!(
                "agent hit max iterations ({}), returning what we have",
                config.max_iterations
            );
            let _ = on_event(AgentEvent::Error {
                message: format!(
                    "Reached maximum iteration limit ({})",
                    config.max_iterations
                ),
            });
            return Ok(AgentLoopResult {
                final_text: String::new(),
                iterations,
                tool_calls_made: tool_call_records,
                usage: total_usage,
            });
        }

        iterations += 1;

        let _ = on_event(AgentEvent::Thinking {
            message: format!(
                "Analyzing and planning (iteration {}/{})",
                iterations, config.max_iterations
            ),
            phase: Some("llm_call".into()),
        });

        // -- Build the request body -----------------------------------------
        let mut request_body = serde_json::json!({
            "model": config.model_id,
            "messages": messages,
            "stream": true,
            "stream_options": { "include_usage": true },
        });

        // Set token limit — critical for reasoning models which will think
        // indefinitely without a cap.
        if let Some(max_tokens) = config.max_output_tokens {
            request_body["max_tokens"] = serde_json::json!(max_tokens);
        }

        if !tool_definitions.is_empty() {
            request_body["tools"] = Value::Array(tool_definitions.clone());
            request_body["tool_choice"] = Value::String("auto".into());
        }

        // -- Send request to LLM endpoint ------------------------------------
        debug!("agent: sending streaming request (iteration {})", iterations);

        let endpoint = config
            .endpoint_url
            .as_deref()
            .unwrap_or(XAI_CHAT_ENDPOINT);

        let mut req = client.post(endpoint).json(&request_body);
        if !api_key.is_empty() {
            req = req.bearer_auth(api_key);
        }
        let response = req.send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let detail = extract_api_error(&body).unwrap_or_else(|| body.clone());
            let msg = format!("{status}: {detail}");
            let _ = on_event(AgentEvent::Error {
                message: msg.clone(),
            });
            return Err(AppError::message(msg));
        }

        // -- Stream the response and accumulate content / tool calls --------
        let mut content_buffer = String::new();
        let mut tool_acc = ToolCallAccumulator::default();
        let mut finish_reason = String::from("stop");
        let mut stream = response.bytes_stream();
        let mut sse_buffer = String::new();
        let chunk_timeout = Duration::from_secs(300);

        loop {
            if cancel.is_cancelled() {
                return Err(AppError::message("cancelled"));
            }

            let maybe_chunk = tokio::time::timeout(chunk_timeout, stream.next()).await;
            let chunk = match maybe_chunk {
                Ok(Some(chunk)) => chunk?,
                Ok(None) => break,
                Err(_) => {
                    error!("agent: stream timed out after 300s");
                    return Err(AppError::message(
                        "Stream timed out — the model may need more time.",
                    ));
                }
            };

            sse_buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(event) = take_sse_event(&mut sse_buffer) {
                let data = event
                    .lines()
                    .filter_map(|line| line.strip_prefix("data:"))
                    .map(str::trim)
                    .collect::<Vec<_>>()
                    .join("");

                if data.is_empty() || data == "[DONE]" {
                    continue;
                }

                let json: Value = match serde_json::from_str(&data) {
                    Ok(v) => v,
                    Err(err) => {
                        error!("agent: failed to parse SSE data: {err}");
                        continue;
                    }
                };

                // Extract finish_reason
                if let Some(reason) = json
                    .get("choices")
                    .and_then(Value::as_array)
                    .and_then(|c| c.first())
                    .and_then(|c| c.get("finish_reason"))
                    .and_then(Value::as_str)
                {
                    finish_reason = reason.to_string();
                }

                // Extract reasoning/thinking content (xAI reasoning models)
                if let Some(reasoning) = json
                    .get("choices")
                    .and_then(Value::as_array)
                    .and_then(|c| c.first())
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("reasoning_content"))
                    .and_then(Value::as_str)
                {
                    if !reasoning.is_empty() {
                        let _ = on_event(AgentEvent::ReasoningDelta {
                            text: reasoning.to_string(),
                        });
                    }
                }

                // Extract text content delta
                if let Some(delta_text) = json
                    .get("choices")
                    .and_then(Value::as_array)
                    .and_then(|c| c.first())
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("content"))
                    .and_then(Value::as_str)
                {
                    if !delta_text.is_empty() {
                        content_buffer.push_str(delta_text);
                        let _ = on_event(AgentEvent::TextDelta {
                            text: delta_text.to_string(),
                        });
                    }
                }

                // Accumulate tool call deltas
                if let Some(tool_calls_arr) = json
                    .get("choices")
                    .and_then(Value::as_array)
                    .and_then(|c| c.first())
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("tool_calls"))
                    .and_then(Value::as_array)
                {
                    for tc_delta in tool_calls_arr {
                        tool_acc.push_delta(tc_delta);
                    }
                }

                // Extract usage from the final chunk
                if let Some(usage_val) = json.get("usage") {
                    if let Some(pt) = usage_val
                        .get("prompt_tokens")
                        .and_then(Value::as_u64)
                        .or_else(|| usage_val.get("input_tokens").and_then(Value::as_u64))
                    {
                        total_usage.input_tokens =
                            Some(total_usage.input_tokens.unwrap_or(0) + pt);
                    }
                    if let Some(ct) = usage_val
                        .get("completion_tokens")
                        .and_then(Value::as_u64)
                        .or_else(|| usage_val.get("output_tokens").and_then(Value::as_u64))
                    {
                        total_usage.output_tokens =
                            Some(total_usage.output_tokens.unwrap_or(0) + ct);
                    }
                }

                // Check for inline errors
                if let Some(err_msg) = json
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                {
                    error!("agent: API returned error in stream: {err_msg}");
                    return Err(AppError::message(err_msg));
                }
            }
        }

        // -- Process streamed response --------------------------------------
        let tool_calls = tool_acc.finish();

        debug!(
            "agent: iteration {} complete — content_len={}, tool_calls={}, finish={}",
            iterations,
            content_buffer.len(),
            tool_calls.len(),
            finish_reason,
        );

        // Case 1: model wants to call tools
        if !tool_calls.is_empty() {
            // Append the assistant message with tool_calls to history.
            let assistant_msg = build_assistant_message_with_tool_calls(
                if content_buffer.is_empty() {
                    None
                } else {
                    Some(&content_buffer)
                },
                &tool_calls,
            );
            messages.push(assistant_msg);

            // Execute each tool call sequentially.
            for call in &tool_calls {
                if cancel.is_cancelled() {
                    return Err(AppError::message("cancelled"));
                }

                // -- Permission check ---------------------------------------
                let perm = config.permissions.get(&call.function.name);

                if perm == crate::permissions::ToolPermission::Deny {
                    // Tool is blocked — tell the model.
                    let denial = format!(
                        "Tool '{}' is denied by the current permission policy.",
                        call.function.name
                    );
                    let _ = on_event(AgentEvent::ToolResult {
                        call_id: call.id.clone(),
                        tool_name: call.function.name.clone(),
                        success: false,
                        output: denial.clone(),
                    });
                    messages.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": denial,
                    }));
                    continue;
                }

                if perm == crate::permissions::ToolPermission::Ask {
                    // Emit a permission request and wait for approval.
                    let _ = on_event(AgentEvent::PermissionRequest {
                        call_id: call.id.clone(),
                        tool_name: call.function.name.clone(),
                        tool_input: call.function.arguments.clone(),
                        reason: format!(
                            "'{}' requires approval before execution.",
                            call.function.name
                        ),
                    });

                    let approved = if let Some(ref mut rx) = approval_rx {
                        // Wait for the frontend to send a decision (or cancel).
                        tokio::select! {
                            decision = rx.recv() => {
                                decision
                                    .map(|d| d.approved)
                                    .unwrap_or(false)
                            }
                            _ = cancel.cancelled() => {
                                return Err(AppError::message("cancelled"));
                            }
                        }
                    } else {
                        // No approval channel — auto-approve.
                        true
                    };

                    if !approved {
                        let denial = format!(
                            "User denied execution of '{}'.",
                            call.function.name
                        );
                        let _ = on_event(AgentEvent::ToolResult {
                            call_id: call.id.clone(),
                            tool_name: call.function.name.clone(),
                            success: false,
                            output: denial.clone(),
                        });
                        messages.push(serde_json::json!({
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": denial,
                        }));
                        continue;
                    }
                }

                // -- Execute the tool ---------------------------------------
                let _ = on_event(AgentEvent::Thinking {
                    message: format!("Running {}...", call.function.name),
                    phase: Some("tool_exec".into()),
                });

                let _ = on_event(AgentEvent::ToolCall {
                    tool_name: call.function.name.clone(),
                    tool_input: call.function.arguments.clone(),
                    call_id: call.id.clone(),
                });

                let args: Value =
                    serde_json::from_str(&call.function.arguments).unwrap_or(Value::Object(
                        serde_json::Map::new(),
                    ));

                let tool_result = tools.execute(&call.function.name, &args).await;

                let success = tool_result.success;
                let output = if success {
                    tool_result.output.clone()
                } else {
                    format!(
                        "Tool error: {}",
                        tool_result.error.as_deref().unwrap_or("unknown")
                    )
                };

                let _ = on_event(AgentEvent::ToolResult {
                    call_id: call.id.clone(),
                    tool_name: call.function.name.clone(),
                    success,
                    output: truncate_for_event(&output, 2000),
                });

                tool_call_records.push(ToolCallRecord {
                    call_id: call.id.clone(),
                    tool_name: call.function.name.clone(),
                    arguments: call.function.arguments.clone(),
                    result: output.clone(),
                    success,
                });

                // Append the tool result message for the model (truncated to
                // avoid blowing up the context window).
                messages.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": truncate_for_context(&output),
                }));
            }

            // Continue the loop — the model will see the tool results.
            continue;
        }

        // Case 2: model produced a final text response (already streamed
        // via TextDelta events above).
        let _ = on_event(AgentEvent::Complete {
            text: content_buffer.clone(),
            iterations,
        });

        return Ok(AgentLoopResult {
            final_text: content_buffer,
            iterations,
            tool_calls_made: tool_call_records,
            usage: total_usage,
        });
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Builds an assistant message JSON value that includes tool_calls, matching
/// the OpenAI chat format expected by the API on subsequent turns.
fn build_assistant_message_with_tool_calls(content: Option<&str>, calls: &[ToolCall]) -> Value {
    let tool_calls_json: Vec<Value> = calls
        .iter()
        .map(|c| {
            serde_json::json!({
                "id": c.id,
                "type": c.call_type.as_deref().unwrap_or("function"),
                "function": {
                    "name": c.function.name,
                    "arguments": c.function.arguments,
                }
            })
        })
        .collect();

    let mut msg = serde_json::json!({
        "role": "assistant",
        "tool_calls": tool_calls_json,
    });

    if let Some(text) = content {
        msg["content"] = Value::String(text.to_string());
    }

    msg
}

/// Attempt to pull a human-readable error message from a JSON error body.
fn extract_api_error(body: &str) -> Option<String> {
    let parsed: ChatErrorResponse = serde_json::from_str(body).ok()?;
    parsed.error?.message
}

/// Extract a single SSE event from the buffer, consuming it.
fn take_sse_event(buffer: &mut String) -> Option<String> {
    let normalized = buffer.replace("\r\n", "\n");
    *buffer = normalized;
    if let Some(index) = buffer.find("\n\n") {
        let event = buffer[..index].to_string();
        *buffer = buffer[index + 2..].to_string();
        return Some(event);
    }
    None
}

/// Truncate a string for display in events (the full result is still stored in
/// the `ToolCallRecord`).
fn truncate_for_event(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        let mut truncated = s[..max_len].to_string();
        truncated.push_str("...[truncated]");
        truncated
    }
}

/// Truncate tool output for inclusion in the LLM message history.
/// Keeps the first and last portions so the model can still reason about the
/// output without blowing up the context window.
const MAX_TOOL_OUTPUT_FOR_CONTEXT: usize = 30_000; // ~7.5K tokens

fn truncate_for_context(s: &str) -> String {
    if s.len() <= MAX_TOOL_OUTPUT_FOR_CONTEXT {
        return s.to_string();
    }
    let keep = MAX_TOOL_OUTPUT_FOR_CONTEXT / 2;
    let total_bytes = s.len();
    let head = &s[..keep];
    let tail = &s[total_bytes - keep..];
    format!(
        "{head}\n\n... [truncated {total_bytes} bytes → showing first and last {keep} bytes] ...\n\n{tail}"
    )
}
