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
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            model_id: "grok-code-fast-1".into(),
            system_prompt: String::new(),
            max_iterations: 25,
            workspace_roots: Vec::new(),
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
    Thinking { message: String },
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
// Internal response structures (xAI / OpenAI-compatible)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
    usage: Option<ChatUsage>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    #[allow(dead_code)]
    role: Option<String>,
    content: Option<String>,
    tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Debug, Deserialize)]
struct ChatUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ChatErrorResponse {
    error: Option<ChatErrorDetail>,
}

#[derive(Debug, Deserialize)]
struct ChatErrorDetail {
    message: Option<String>,
}

// ---------------------------------------------------------------------------
// The agent execution loop
// ---------------------------------------------------------------------------

const XAI_CHAT_ENDPOINT: &str = "https://api.x.ai/v1/chat/completions";

/// Runs the agentic loop: sends chat requests with tool definitions to xAI,
/// executes any tool calls the model returns, feeds results back, and repeats
/// until the model produces a final text response (or the iteration limit /
/// cancellation token fires).
pub async fn run_agent(
    client: &reqwest::Client,
    api_key: &str,
    config: &AgentConfig,
    history: Vec<Value>,
    tools: &crate::tools::ToolRegistry,
    cancel: CancellationToken,
    on_event: impl Fn(AgentEvent) -> AppResult<()>,
) -> AppResult<AgentLoopResult> {
    // -- Build the tools array in OpenAI function-calling format ------------
    let tool_definitions: Vec<Value> = tools
        .definitions()
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
            message: format!("Iteration {}", iterations),
        });

        // -- Build the request body -----------------------------------------
        let mut request_body = serde_json::json!({
            "model": config.model_id,
            "messages": messages,
        });

        if !tool_definitions.is_empty() {
            request_body["tools"] = Value::Array(tool_definitions.clone());
            request_body["tool_choice"] = Value::String("auto".into());
        }

        // -- Send request to xAI --------------------------------------------
        debug!("agent: sending request (iteration {})", iterations);

        let response = client
            .post(XAI_CHAT_ENDPOINT)
            .bearer_auth(api_key)
            .json(&request_body)
            .send()
            .await?;

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

        let raw_body = response.text().await?;
        let chat_response: ChatResponse = serde_json::from_str(&raw_body).map_err(|err| {
            error!("agent: failed to parse xAI response: {err}");
            AppError::message(format!("Failed to parse xAI response: {err}"))
        })?;

        // -- Accumulate usage -----------------------------------------------
        if let Some(ref u) = chat_response.usage {
            total_usage.input_tokens = Some(
                total_usage.input_tokens.unwrap_or(0) + u.prompt_tokens.unwrap_or(0),
            );
            total_usage.output_tokens = Some(
                total_usage.output_tokens.unwrap_or(0) + u.completion_tokens.unwrap_or(0),
            );
        }

        // -- Extract the first choice (xAI always returns one) --------------
        let choice = chat_response
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| AppError::message("xAI returned no choices"))?;

        let _finish_reason = choice.finish_reason.as_deref().unwrap_or("stop");
        let assistant_content = choice.message.content.clone();
        let assistant_tool_calls = choice.message.tool_calls.clone();

        // -- Case 1: model wants to call tools -----------------------------
        if let Some(ref calls) = assistant_tool_calls {
            if !calls.is_empty() {
                // Append the full assistant message (with tool_calls) to the
                // conversation so the model can see what it asked for.
                let assistant_msg = build_assistant_message_with_tool_calls(
                    assistant_content.as_deref(),
                    calls,
                );
                messages.push(assistant_msg);

                // Execute each tool call sequentially.
                for call in calls {
                    // Check cancellation between tool executions.
                    if cancel.is_cancelled() {
                        return Err(AppError::message("cancelled"));
                    }

                    let _ = on_event(AgentEvent::ToolCall {
                        tool_name: call.function.name.clone(),
                        tool_input: call.function.arguments.clone(),
                        call_id: call.id.clone(),
                    });

                    // Parse arguments from JSON string to Value.
                    let args: Value =
                        serde_json::from_str(&call.function.arguments).unwrap_or(Value::Object(
                            serde_json::Map::new(),
                        ));

                    let tool_result = tools.execute(&call.function.name, &args).await;

                    let success = tool_result.success;
                    let output = if success {
                        tool_result.output.clone()
                    } else {
                        format!("Tool error: {}", tool_result.error.as_deref().unwrap_or("unknown"))
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

                    // Append the tool result message for the model.
                    messages.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": output,
                    }));
                }

                // Continue the loop -- the model will see the tool results.
                continue;
            }
        }

        // -- Case 2: model produced a final text response -------------------
        let final_text = assistant_content.unwrap_or_default();

        if !final_text.is_empty() {
            let _ = on_event(AgentEvent::TextDelta {
                text: final_text.clone(),
            });
        }

        let _ = on_event(AgentEvent::Complete {
            text: final_text.clone(),
            iterations,
        });

        return Ok(AgentLoopResult {
            final_text,
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
fn build_assistant_message_with_tool_calls(
    content: Option<&str>,
    calls: &[ToolCall],
) -> Value {
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
