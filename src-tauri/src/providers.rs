use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use tracing::{info, error};
use crate::error::{AppError, AppResult};
use crate::keychain::SecretStore;
use crate::types::Message;
use crate::types::{
    GenerateImageRequest, GenerateVideoRequest, MediaAsset, ModelDescriptor, ProviderId,
    RealtimeSession, RealtimeSessionRequest, TextToSpeechRequest, TokenUsage,
};

const XAI_CHAT_ENDPOINT: &str = "https://api.x.ai/v1/chat/completions";
const XAI_IMAGE_ENDPOINT: &str = "https://api.x.ai/v1/images/generations";
const XAI_VIDEO_ENDPOINT: &str = "https://api.x.ai/v1/videos/generations";
const XAI_VIDEO_STATUS_ENDPOINT: &str = "https://api.x.ai/v1/videos";
const XAI_REALTIME_SECRET_ENDPOINT: &str = "https://api.x.ai/v1/realtime/client_secrets";
const XAI_REALTIME_WEBSOCKET_URL: &str = "wss://api.x.ai/v1/realtime";
const XAI_TTS_ENDPOINT: &str = "https://api.x.ai/v1/tts";

const OLLAMA_BASE_URL: &str = "http://localhost:11434";
const OLLAMA_CHAT_ENDPOINT: &str = "http://localhost:11434/v1/chat/completions";
const OLLAMA_TAGS_ENDPOINT: &str = "http://localhost:11434/api/tags";

#[derive(Clone)]
pub struct ProviderService {
    client: Client,
    secrets: Arc<dyn SecretStore>,
}

impl ProviderService {
    pub fn new(client: Client, secrets: Arc<dyn SecretStore>) -> Self {
        Self { client, secrets }
    }

    pub fn client(&self) -> &Client {
        &self.client
    }

    pub fn require_api_key_public(&self) -> AppResult<String> {
        self.require_api_key()
    }

    pub fn has_key(&self, provider: ProviderId) -> AppResult<bool> {
        self.secrets.has_api_key(provider)
    }

    pub fn get_api_key(&self, provider: ProviderId) -> AppResult<Option<String>> {
        self.secrets.get_api_key(provider)
    }

    pub fn save_api_key(&self, provider: ProviderId, api_key: &str) -> AppResult<()> {
        self.secrets.set_api_key(provider, api_key)
    }

    pub fn delete_api_key(&self, provider: ProviderId) -> AppResult<()> {
        self.secrets.delete_api_key(provider)
    }

    pub async fn list_models(
        &self,
        provider: Option<ProviderId>,
    ) -> AppResult<Vec<ModelDescriptor>> {
        match provider {
            Some(ProviderId::Ollama) => self.list_ollama_models().await,
            _ => Ok(chat_models()),
        }
    }

    pub async fn list_ollama_models(&self) -> AppResult<Vec<ModelDescriptor>> {
        let response = match self.client.get(OLLAMA_TAGS_ENDPOINT).send().await {
            Ok(r) => r,
            Err(_) => return Ok(Vec::new()),
        };
        if !response.status().is_success() {
            return Ok(Vec::new());
        }
        let json: Value = response.json().await?;
        let models = json
            .get("models")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| {
                        let name = m.get("name").and_then(Value::as_str)?;
                        Some(ModelDescriptor {
                            provider_id: ProviderId::Ollama,
                            model_id: name.to_string(),
                            label: name.to_string(),
                            supports_streaming: true,
                            supports_workspace_context: true,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(models)
    }

    pub async fn check_ollama_available(&self) -> bool {
        matches!(self.client.get(OLLAMA_BASE_URL).send().await, Ok(r) if r.status().is_success())
    }

    pub fn ollama_chat_endpoint() -> &'static str {
        OLLAMA_CHAT_ENDPOINT
    }

    /// Check if a specific Ollama model is installed locally.
    #[allow(dead_code)]
    pub async fn has_ollama_model(&self, model_id: &str) -> bool {
        let models = self.list_ollama_models().await.unwrap_or_default();
        models.iter().any(|m| m.model_id == model_id)
    }

    /// Generate an image using Ollama's /api/generate endpoint (diffusion models).
    /// Returns the image saved to disk as a MediaAsset.
    /// Currently only works on macOS (Ollama limitation).
    pub async fn generate_ollama_image(
        &self,
        request: &GenerateImageRequest,
        output_dir: &Path,
    ) -> AppResult<MediaAsset> {
        std::fs::create_dir_all(output_dir)?;

        let response = self
            .client
            .post(format!("{}/api/generate", OLLAMA_BASE_URL))
            .json(&serde_json::json!({
                "model": request.model_id,
                "prompt": request.prompt,
                "stream": false,
            }))
            .timeout(Duration::from_secs(300))
            .send()
            .await?;

        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::message(format!(
                "Ollama image generation failed: {body}"
            )));
        }

        // Response is newline-delimited JSON. The final line with done:true
        // contains the base64 PNG in the "image" field.
        let body = response.text().await?;
        let mut image_b64: Option<String> = None;
        for line in body.lines().rev() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(json) = serde_json::from_str::<Value>(line) {
                if json.get("done").and_then(Value::as_bool).unwrap_or(false) {
                    if let Some(img) = json.get("image").and_then(Value::as_str) {
                        image_b64 = Some(img.to_string());
                    }
                    break;
                }
            }
        }

        let b64 = image_b64.ok_or_else(|| {
            AppError::message("Ollama image generation returned no image data")
        })?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&b64)
            .map_err(|e| AppError::message(format!("invalid image payload: {e}")))?;

        let file_name = format!("{}.png", uuid::Uuid::new_v4());
        let file_path = output_dir.join(&file_name);
        std::fs::write(&file_path, &bytes)?;

        let now = chrono::Utc::now().to_rfc3339();
        Ok(MediaAsset {
            id: uuid::Uuid::new_v4().to_string(),
            category_id: request.category_id.clone(),
            kind: "image".into(),
            model_id: request.model_id.clone(),
            prompt: request.prompt.clone(),
            file_path: file_path.to_string_lossy().to_string(),
            source_url: None,
            mime_type: Some("image/png".into()),
            status: "completed".into(),
            request_id: None,
            metadata_json: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn stream_chat<F>(
        &self,
        provider: ProviderId,
        model_id: &str,
        history: &[Message],
        workspace_context: &str,
        _temperature: Option<f32>,
        max_output_tokens: Option<u32>,
        cancel: CancellationToken,
        mut on_delta: F,
    ) -> AppResult<TokenUsage>
    where
        F: FnMut(String) -> AppResult<()>,
    {
        let mut messages = vec![serde_json::json!({
            "role": "system",
            "content": base_system_prompt(workspace_context),
        })];
        messages.extend(
            history
                .iter()
                .filter(|message| message.role != "system")
                .map(|message| {
                    serde_json::json!({
                        "role": if message.role == "assistant" { "assistant" } else { "user" },
                        "content": message.content,
                    })
                }),
        );

        let mut request_body = serde_json::json!({
            "model": model_id,
            "stream": true,
            "messages": messages,
        });
        if let Some(max_tokens) = max_output_tokens {
            request_body["max_tokens"] = serde_json::json!(max_tokens);
        }

        let (endpoint, api_key) = match provider {
            ProviderId::Ollama => (OLLAMA_CHAT_ENDPOINT, None),
            _ => (XAI_CHAT_ENDPOINT, Some(self.require_api_key()?)),
        };

        let mut req = self.client.post(endpoint).json(&request_body);
        if let Some(ref key) = api_key {
            req = req.bearer_auth(key);
        }
        let response = req.send().await?;

        if !response.status().is_success() {
            return Err(AppError::message(extract_error(response).await?));
        }

        let mut usage = TokenUsage {
            input_tokens: None,
            output_tokens: None,
        };
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        loop {
            if cancel.is_cancelled() {
                return Err(AppError::message("cancelled"));
            }
            let maybe_chunk = tokio::time::timeout(Duration::from_secs(60), stream.next()).await;
            let chunk = match maybe_chunk {
                Ok(Some(chunk)) => chunk?,
                Ok(None) => break,
                Err(_) => return Err(AppError::message("stream timed out after 60 seconds")),
            };
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(event) = take_sse_event(&mut buffer) {
                let data = event
                    .lines()
                    .filter_map(|line| line.strip_prefix("data:"))
                    .map(str::trim)
                    .collect::<Vec<_>>()
                    .join("");
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }
                let json: Value = serde_json::from_str(&data)?;
                if let Some(delta) = json
                    .get("choices")
                    .and_then(Value::as_array)
                    .and_then(|choices| choices.first())
                    .and_then(|choice| choice.get("delta"))
                    .and_then(|delta| delta.get("content"))
                    .and_then(Value::as_str)
                {
                    on_delta(delta.to_string())?;
                }
                if let Some(usage_value) = json.get("usage") {
                    usage.input_tokens = usage_value
                        .get("prompt_tokens")
                        .and_then(Value::as_u64)
                        .or_else(|| usage_value.get("input_tokens").and_then(Value::as_u64));
                    usage.output_tokens = usage_value
                        .get("completion_tokens")
                        .and_then(Value::as_u64)
                        .or_else(|| usage_value.get("output_tokens").and_then(Value::as_u64));
                }
                if let Some(message) = json
                    .get("error")
                    .and_then(|value| value.get("message"))
                    .and_then(Value::as_str)
                {
                    return Err(AppError::message(message));
                }
            }
        }
        Ok(usage)
    }

    pub async fn generate_image(
        &self,
        request: &GenerateImageRequest,
        output_dir: &Path,
    ) -> AppResult<MediaAsset> {
        let api_key = self.require_api_key()?;
        std::fs::create_dir_all(output_dir)?;

        let response = self
            .client
            .post(XAI_IMAGE_ENDPOINT)
            .bearer_auth(api_key)
            .json(&serde_json::json!({
                "model": request.model_id,
                "prompt": request.prompt,
                "aspect_ratio": request.aspect_ratio.clone().unwrap_or_else(|| "1:1".to_string()),
                "resolution": request.resolution.clone().unwrap_or_else(|| "1k".to_string()),
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::message(extract_error(response).await?));
        }

        let json: Value = response.json().await?;
        let item = json
            .get("data")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .ok_or_else(|| AppError::message("xAI image generation returned no image data"))?;

        let file_name = format!("{}.png", uuid::Uuid::new_v4());
        let file_path = output_dir.join(file_name);
        let source_url = if let Some(b64) = item.get("b64_json").and_then(Value::as_str) {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|error| AppError::message(format!("invalid image payload: {error}")))?;
            std::fs::write(&file_path, bytes)?;
            None
        } else if let Some(url) = item.get("url").and_then(Value::as_str) {
            let bytes = self.download_bytes(url).await?;
            std::fs::write(&file_path, bytes)?;
            Some(url.to_string())
        } else {
            return Err(AppError::message(
                "xAI image generation returned no supported image payload",
            ));
        };

        let now = chrono::Utc::now().to_rfc3339();
        Ok(MediaAsset {
            id: uuid::Uuid::new_v4().to_string(),
            category_id: request.category_id.clone(),
            kind: "image".into(),
            model_id: request.model_id.clone(),
            prompt: request.prompt.clone(),
            file_path: file_path.to_string_lossy().to_string(),
            source_url,
            mime_type: Some("image/png".into()),
            status: "completed".into(),
            request_id: None,
            metadata_json: Some(json.to_string()),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn generate_video(
        &self,
        request: &GenerateVideoRequest,
        output_dir: &Path,
    ) -> AppResult<MediaAsset> {
        let api_key = self.require_api_key()?;
        std::fs::create_dir_all(output_dir)?;

        let response = self
            .client
            .post(XAI_VIDEO_ENDPOINT)
            .bearer_auth(&api_key)
            .json(&serde_json::json!({
                "model": request.model_id,
                "prompt": request.prompt,
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::message(extract_error(response).await?));
        }

        let initial: Value = response.json().await?;
        let request_id = initial
            .get("request_id")
            .or_else(|| initial.get("id"))
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::message("xAI video generation did not return a request id"))?
            .to_string();

        let final_state = self.poll_video_until_ready(&api_key, &request_id).await?;
        let video_url = find_video_url(&final_state).ok_or_else(|| {
            AppError::message("xAI video generation completed without a video URL")
        })?;
        let file_name = format!("{}.mp4", uuid::Uuid::new_v4());
        let file_path = output_dir.join(file_name);
        let bytes = self.download_bytes(&video_url).await?;
        std::fs::write(&file_path, bytes)?;

        let now = chrono::Utc::now().to_rfc3339();
        Ok(MediaAsset {
            id: uuid::Uuid::new_v4().to_string(),
            category_id: request.category_id.clone(),
            kind: "video".into(),
            model_id: request.model_id.clone(),
            prompt: request.prompt.clone(),
            file_path: file_path.to_string_lossy().to_string(),
            source_url: Some(video_url),
            mime_type: Some("video/mp4".into()),
            status: "completed".into(),
            request_id: Some(request_id),
            metadata_json: Some(final_state.to_string()),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn text_to_speech(
        &self,
        request: &TextToSpeechRequest,
        output_dir: &Path,
    ) -> AppResult<MediaAsset> {
        let api_key = self.require_api_key()?;
        std::fs::create_dir_all(output_dir)?;

        let format = request
            .response_format
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "mp3".to_string());
        let voice_id = request.voice.clone().unwrap_or_else(|| "eve".to_string());
        let output_format = if format == "wav" {
            serde_json::json!({
                "codec": "wav",
                "sample_rate": 24000,
            })
        } else {
            serde_json::json!({
                "codec": "mp3",
                "sample_rate": 24000,
                "bit_rate": 128000,
            })
        };
        let model_id = request
            .model_id
            .as_deref()
            .unwrap_or("xai-tts");
        info!(
            model = model_id,
            voice = %voice_id,
            input_len = request.input.len(),
            "Sending TTS request to xAI"
        );
        let response = self
            .client
            .post(XAI_TTS_ENDPOINT)
            .bearer_auth(api_key)
            .json(&serde_json::json!({
                "model": model_id,
                "text": request.input,
                "voice_id": voice_id,
                "language": "en",
                "output_format": output_format,
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let err = extract_error(response).await?;
            error!(error = %err, "TTS request failed");
            return Err(AppError::message(err));
        }

        let bytes = response.bytes().await?;
        let extension = if format == "wav" { "wav" } else { "mp3" };
        let file_path = output_dir.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
        std::fs::write(&file_path, bytes)?;

        let now = chrono::Utc::now().to_rfc3339();
        Ok(MediaAsset {
            id: uuid::Uuid::new_v4().to_string(),
            category_id: request.category_id.clone(),
            kind: "audio".into(),
            model_id: request
                .model_id
                .clone()
                .unwrap_or_else(|| "xai-tts".to_string()),
            prompt: request.input.clone(),
            file_path: file_path.to_string_lossy().to_string(),
            source_url: None,
            mime_type: Some(if extension == "wav" {
                "audio/wav".into()
            } else {
                "audio/mpeg".into()
            }),
            status: "completed".into(),
            request_id: None,
            metadata_json: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn create_realtime_session(
        &self,
        request: &RealtimeSessionRequest,
    ) -> AppResult<RealtimeSession> {
        let api_key = self.require_api_key()?;
        let model_id = request
            .model_id
            .as_deref()
            .unwrap_or("grok-3-mini-fast");
        let websocket_url = XAI_REALTIME_WEBSOCKET_URL.to_string();

        // Try ephemeral client_secrets endpoint first (OpenAI-compatible)
        let ephemeral = self
            .client
            .post(XAI_REALTIME_SECRET_ENDPOINT)
            .bearer_auth(&api_key)
            .json(&serde_json::json!({
                "expires_after": { "anchor": "created_at", "seconds": 900 },
            }))
            .send()
            .await;

        if let Ok(response) = ephemeral {
            if response.status().is_success() {
                if let Ok(json) = response.json::<Value>().await {
                    let secret = json
                        .get("client_secret")
                        .and_then(|v| v.get("value").or_else(|| v.get("secret")))
                        .or_else(|| json.get("value"))
                        .and_then(Value::as_str);
                    let expires_at = json
                        .get("client_secret")
                        .and_then(|v| v.get("expires_at"))
                        .or_else(|| json.get("expires_at"))
                        .and_then(Value::as_str)
                        .map(ToString::to_string);
                    if let Some(secret) = secret {
                        info!("realtime: using ephemeral client secret");
                        return Ok(RealtimeSession {
                            client_secret: secret.to_string(),
                            expires_at,
                            websocket_url,
                            model_id: Some(model_id.to_string()),
                            voice: request.voice.clone(),
                            proxy_port: None,
                        });
                    }
                }
            }
        }

        // Fallback: use the API key directly (desktop app — safe to expose to local webview)
        info!("realtime: ephemeral secret unavailable, using API key directly");
        Ok(RealtimeSession {
            client_secret: api_key,
            expires_at: None,
            websocket_url,
            model_id: Some(model_id.to_string()),
            voice: request.voice.clone(),
            proxy_port: None,
        })
    }

    fn require_api_key(&self) -> AppResult<String> {
        self.secrets
            .get_api_key(ProviderId::Xai)?
            .ok_or_else(|| AppError::message("xAI API key is not configured."))
    }

    async fn poll_video_until_ready(&self, api_key: &str, request_id: &str) -> AppResult<Value> {
        for _ in 0..120 {
            let response = self
                .client
                .get(format!("{XAI_VIDEO_STATUS_ENDPOINT}/{request_id}"))
                .bearer_auth(api_key)
                .send()
                .await?;
            if !response.status().is_success() {
                return Err(AppError::message(extract_error(response).await?));
            }
            let json: Value = response.json().await?;
            let status = json
                .get("status")
                .or_else(|| json.get("state"))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            match status {
                "completed" | "succeeded" | "success" | "done" => return Ok(json),
                "failed" | "error" => {
                    let message = json
                        .get("error")
                        .and_then(|value| value.get("message").or(Some(value)))
                        .and_then(Value::as_str)
                        .unwrap_or("xAI video generation failed");
                    return Err(AppError::message(message));
                }
                _ => tokio::time::sleep(Duration::from_secs(3)).await,
            }
        }
        Err(AppError::message(
            "Timed out waiting for xAI video generation",
        ))
    }

    async fn download_bytes(&self, url: &str) -> AppResult<Vec<u8>> {
        let response = self.client.get(url).send().await?;
        if !response.status().is_success() {
            return Err(AppError::message(extract_error(response).await?));
        }
        Ok(response.bytes().await?.to_vec())
    }
}

fn chat_models() -> Vec<ModelDescriptor> {
    [
        "grok-4-1-fast-reasoning",
        "grok-4-1-fast-non-reasoning",
        "grok-code-fast-1",
        "grok-4-fast-reasoning",
        "grok-4-fast-non-reasoning",
        "grok-4-0709",
        "grok-3-mini",
        "grok-3",
    ]
    .into_iter()
    .map(|model_id| ModelDescriptor {
        provider_id: ProviderId::Xai,
        model_id: model_id.into(),
        label: model_id.into(),
        supports_streaming: true,
        supports_workspace_context: true,
    })
    .collect()
}

fn find_video_url(json: &Value) -> Option<String> {
    json.get("video_url")
        .and_then(Value::as_str)
        .or_else(|| {
            json.get("video")
                .and_then(|value| value.get("url"))
                .and_then(Value::as_str)
        })
        .or_else(|| json.get("url").and_then(Value::as_str))
        .or_else(|| {
            json.get("data")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("url"))
                .and_then(Value::as_str)
        })
        .map(ToString::to_string)
}

pub fn base_system_prompt(workspace_context: &str) -> String {
    if workspace_context.trim().is_empty() {
        return "You are Super ASCIIVision, a concise desktop coding assistant. Respond clearly and use Markdown for code.".into();
    }
    format!(
        "You are Super ASCIIVision, a concise desktop coding assistant. Use the attached workspace context when it is relevant.\n\n{}",
        workspace_context
    )
}

async fn extract_error(response: reqwest::Response) -> AppResult<String> {
    let status = response.status();
    let body = response.text().await?;
    if let Ok(json) = serde_json::from_str::<Value>(&body) {
        if let Some(message) = json
            .get("error")
            .and_then(|value| value.get("message").or(Some(value)))
            .and_then(Value::as_str)
        {
            return Ok(format!("{status}: {message}"));
        }
    }
    Ok(format!("{status}: {body}"))
}

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
