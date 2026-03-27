use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::ws::{Message as WsFrame, WebSocket, WebSocketUpgrade};
use base64::Engine;
use axum::extract::{Path as AxumPath, State};
use axum::http::header::{self, HeaderMap, HeaderValue};
use axum::http::{Response, StatusCode};
use axum::response::{Html, IntoResponse};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::TcpListener;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_util::sync::CancellationToken;
use tracing::error;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::providers::ProviderService;
use crate::types::{
    GenerateImageRequest, GenerateVideoRequest, HandsActivityItem, HandsConnection,
    HandsGeneratedAsset, HandsStatus, MediaAsset, Message, ProviderId, Settings,
    SettingsPatch, TextToSpeechRequest, TokenUsage,
};

const HANDS_EVENT: &str = "hands://status";
const SESSION_COOKIE: &str = "hands_session";
const MAX_ACTIVITY_ITEMS: usize = 80;
const MAX_ASSETS: usize = 40;
const MAX_CHAT_HISTORY: usize = 24;

pub struct HandsService {
    runtime: Mutex<Option<HandsRuntime>>,
    db: Database,
    providers: ProviderService,
}

struct HandsRuntime {
    bridge: Arc<HandsBridge>,
    shutdown: CancellationToken,
    server_task: JoinHandle<()>,
    tunnel_task: Option<JoinHandle<()>>,
    tunnel_child: Option<Arc<Mutex<Option<Child>>>>,
}

struct HandsBridge {
    app: AppHandle,
    db: Database,
    providers: ProviderService,
    snapshot: Mutex<HandsStatus>,
    sessions: Mutex<HashMap<String, HandsConnection>>,
    chat_history: Mutex<Vec<Message>>,
    workspace_dir: PathBuf,
    relay_sender: Mutex<Option<mpsc::UnboundedSender<String>>>,
    relay_terminal: Mutex<Option<HandsTerminalSession>>,
}

#[derive(Clone)]
struct SessionContext {
    token: String,
    connection: HandsConnection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairRequest {
    code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileChatRequest {
    text: String,
    model_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileImageRequest {
    prompt: String,
    model_id: Option<String>,
    aspect_ratio: Option<String>,
    resolution: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileVideoRequest {
    prompt: String,
    model_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileAudioRequest {
    prompt: String,
    model_id: Option<String>,
    voice: Option<String>,
    response_format: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelaySessionPayload {
    session_id: Option<String>,
    session_label: Option<String>,
}

struct HandsTerminalSession {
    writer: std::sync::Mutex<Box<dyn Write + Send>>,
    master: std::sync::Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    _child: std::sync::Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

impl HandsService {
    pub fn new(db: Database, providers: ProviderService) -> Self {
        Self {
            runtime: Mutex::new(None),
            db,
            providers,
        }
    }

    pub async fn snapshot(&self, settings: &Settings) -> HandsStatus {
        let runtime = self.runtime.lock().await;
        if let Some(runtime) = runtime.as_ref() {
            return runtime.bridge.snapshot().await;
        }
        offline_snapshot(settings)
    }

    pub async fn start(&self, app: AppHandle, settings: Settings) -> AppResult<HandsStatus> {
        let mut runtime = self.runtime.lock().await;
        if let Some(existing) = runtime.as_ref() {
            return Ok(existing.bridge.snapshot().await);
        }

        let effective_settings = self.ensure_provider_settings(settings)?;

        let workspace_dir = hands_workspace_dir();
        std::fs::create_dir_all(&workspace_dir)?;
        ensure_workspace_readme(&workspace_dir)?;

        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let local_url = format!("http://127.0.0.1:{port}");
        let pairing_code = random_code(8);
        let tunnel_provider = effective_settings
            .hands_tunnel_provider
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "relay".to_string());

        let bridge = Arc::new(HandsBridge {
            app: app.clone(),
            db: self.db.clone(),
            providers: self.providers.clone(),
            snapshot: Mutex::new(HandsStatus {
                state: "running".into(),
                tunnel_provider: Some(tunnel_provider.clone()),
                tunnel_executable: effective_settings.hands_tunnel_executable.clone(),
                local_url: Some(local_url.clone()),
                public_url: None,
                pairing_code: Some(pairing_code),
                workspace_dir: workspace_dir.to_string_lossy().to_string(),
                tunnel_status: "Starting mobile bridge...".into(),
                last_error: None,
                last_activity_at: Some(now_rfc3339()),
                connections: Vec::new(),
                activity: vec![HandsActivityItem {
                    id: uuid::Uuid::new_v4().to_string(),
                    kind: "system".into(),
                    title: "Hands bridge started".into(),
                    body: "Local mobile bridge is online and waiting for a secure tunnel.".into(),
                    created_at: now_rfc3339(),
                    source: "desktop".into(),
                    status: "complete".into(),
                }],
                assets: Vec::new(),
            }),
            sessions: Mutex::new(HashMap::new()),
            chat_history: Mutex::new(Vec::new()),
            workspace_dir: workspace_dir.clone(),
            relay_sender: Mutex::new(None),
            relay_terminal: Mutex::new(None),
        });

        bridge.emit_snapshot().await;

        let router = Router::new()
            .route("/", get(root_page))
            .route("/api/pair", post(pair_client))
            .route("/api/bootstrap", get(bootstrap))
            .route("/api/chat", post(send_chat))
            .route("/api/generate/image", post(generate_image))
            .route("/api/generate/video", post(generate_video))
            .route("/api/generate/audio", post(generate_audio))
            .route("/api/assets/{asset_id}", get(download_asset))
            .route("/api/terminal/ws", get(terminal_ws_handler))
            .with_state(bridge.clone());

        let shutdown = CancellationToken::new();
        let shutdown_signal = shutdown.clone();
        let server_task = tokio::spawn(async move {
            let server = axum::serve(listener, router).with_graceful_shutdown(async move {
                shutdown_signal.cancelled().await;
            });
            if let Err(error) = server.await {
                error!("hands server failed: {error}");
            }
        });

        let (tunnel_task, tunnel_child) = if tunnel_provider == "relay" {
            spawn_relay_client(bridge.clone(), shutdown.clone(), &effective_settings).await
        } else {
            spawn_tunnel_process(bridge.clone(), shutdown.clone(), &local_url, &effective_settings)
                .await
        };

        *runtime = Some(HandsRuntime {
            bridge: bridge.clone(),
            shutdown,
            server_task,
            tunnel_task,
            tunnel_child,
        });

        Ok(bridge.snapshot().await)
    }

    fn ensure_provider_settings(&self, settings: Settings) -> AppResult<Settings> {
        let provider = settings
            .hands_tunnel_provider
            .clone()
            .unwrap_or_else(|| "relay".to_string());
        if provider != "relay" {
            return Ok(settings);
        }

        let mut patch = SettingsPatch::default();
        let mut changed = false;

        if settings
            .hands_relay_machine_id
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            patch.hands_relay_machine_id = Some(uuid::Uuid::new_v4().to_string());
            changed = true;
        }
        if settings
            .hands_relay_desktop_token
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            patch.hands_relay_desktop_token = Some(uuid::Uuid::new_v4().to_string());
            changed = true;
        }
        // Relay URL is intentionally left empty by default.
        // The user must deploy their own relay and configure the URL in Settings.

        if changed {
            return self.db.update_settings(patch);
        }

        Ok(settings)
    }

    pub async fn stop(&self, settings: &Settings) -> HandsStatus {
        let mut runtime = self.runtime.lock().await;
        if let Some(current) = runtime.take() {
            current.shutdown.cancel();
            if let Some(child) = current.tunnel_child {
                if let Some(mut child) = child.lock().await.take() {
                    let _ = child.kill().await;
                }
            }
            if let Some(task) = current.tunnel_task {
                task.abort();
            }
            current.server_task.abort();
        }
        offline_snapshot(settings)
    }
}

impl HandsBridge {
    async fn snapshot(&self) -> HandsStatus {
        self.snapshot.lock().await.clone()
    }

    async fn emit_snapshot(&self) {
        let payload = self.snapshot().await;
        if let Some(sender) = self.relay_sender.lock().await.clone() {
            let _ = sender.send(
                json!({
                    "type": "desktop.snapshot",
                    "snapshot": payload,
                })
                .to_string(),
            );
        }
        let _ = self.app.emit(HANDS_EVENT, payload);
    }

    async fn set_relay_sender(&self, sender: Option<mpsc::UnboundedSender<String>>) {
        *self.relay_sender.lock().await = sender;
    }

    async fn set_tunnel_status(
        &self,
        public_url: Option<String>,
        tunnel_status: impl Into<String>,
        last_error: Option<String>,
    ) {
        {
            let mut snapshot = self.snapshot.lock().await;
            snapshot.public_url = public_url;
            snapshot.tunnel_status = tunnel_status.into();
            snapshot.last_error = last_error;
            snapshot.last_activity_at = Some(now_rfc3339());
        }
        self.emit_snapshot().await;
    }

    async fn set_tunnel_executable(&self, value: Option<String>) {
        {
            let mut snapshot = self.snapshot.lock().await;
            snapshot.tunnel_executable = value;
        }
        self.emit_snapshot().await;
    }

    async fn upsert_session(&self, session_key: String, label: String) -> HandsConnection {
        let now = now_rfc3339();
        let connection = {
            let mut sessions = self.sessions.lock().await;
            let entry = sessions.entry(session_key).or_insert_with(|| HandsConnection {
                id: uuid::Uuid::new_v4().to_string(),
                label: label.clone(),
                connected_at: now.clone(),
                last_seen_at: now.clone(),
            });
            entry.label = label;
            entry.last_seen_at = now.clone();
            entry.clone()
        };
        let connections = self
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        {
            let mut snapshot = self.snapshot.lock().await;
            snapshot.connections = connections;
            snapshot.last_activity_at = Some(now_rfc3339());
        }
        self.emit_snapshot().await;
        connection
    }

    async fn add_session(&self, token: String, label: String) -> HandsConnection {
        let now = now_rfc3339();
        let connection = HandsConnection {
            id: uuid::Uuid::new_v4().to_string(),
            label,
            connected_at: now.clone(),
            last_seen_at: now,
        };
        self.sessions.lock().await.insert(token, connection.clone());
        let connections = self
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        {
            let mut snapshot = self.snapshot.lock().await;
            snapshot.connections = connections;
            snapshot.last_activity_at = Some(now_rfc3339());
        }
        let _ = self.append_workspace_log("SESSION", &connection.label, "paired");
        self.emit_snapshot().await;
        connection
    }

    async fn touch_session(&self, token: &str) -> Option<HandsConnection> {
        let updated = {
            let mut sessions = self.sessions.lock().await;
            let session = sessions.get_mut(token)?;
            session.last_seen_at = now_rfc3339();
            session.clone()
        };
        let connections = self
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        {
            let mut snapshot = self.snapshot.lock().await;
            snapshot.connections = connections;
        }
        self.emit_snapshot().await;
        Some(updated)
    }

    async fn append_chat_message(&self, role: &str, content: &str, model_id: Option<&str>) {
        let now = now_rfc3339();
        let mut history = self.chat_history.lock().await;
        history.push(Message {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: "hands".into(),
            role: role.into(),
            content: content.into(),
            status: "complete".into(),
            created_at: now.clone(),
            updated_at: now,
            provider_id: Some(ProviderId::Xai),
            model_id: model_id.map(ToString::to_string),
            error: None,
            usage: None,
        });
        if history.len() > MAX_CHAT_HISTORY {
            let remove_count = history.len().saturating_sub(MAX_CHAT_HISTORY);
            history.drain(0..remove_count);
        }
    }

    async fn chat_history(&self) -> Vec<Message> {
        self.chat_history.lock().await.clone()
    }

    async fn log_activity(
        &self,
        kind: &str,
        title: impl Into<String>,
        body: impl Into<String>,
        source: &str,
        status: &str,
    ) {
        let entry = HandsActivityItem {
            id: uuid::Uuid::new_v4().to_string(),
            kind: kind.into(),
            title: title.into(),
            body: body.into(),
            created_at: now_rfc3339(),
            source: source.into(),
            status: status.into(),
        };
        {
            let mut snapshot = self.snapshot.lock().await;
            snapshot.activity.insert(0, entry.clone());
            snapshot.activity.truncate(MAX_ACTIVITY_ITEMS);
            snapshot.last_activity_at = Some(entry.created_at.clone());
        }
        let _ = self.append_workspace_log(&entry.kind, &entry.title, &entry.body);
        self.emit_snapshot().await;
    }

    async fn add_asset(&self, asset: &MediaAsset) {
        let record = HandsGeneratedAsset {
            id: asset.id.clone(),
            kind: asset.kind.clone(),
            prompt: asset.prompt.clone(),
            file_path: asset.file_path.clone(),
            file_name: Path::new(&asset.file_path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            mime_type: asset.mime_type.clone(),
            created_at: asset.created_at.clone(),
            source_url: asset.source_url.clone(),
            download_url: format!("/api/assets/{}", asset.id),
        };
        {
            let mut snapshot = self.snapshot.lock().await;
            snapshot.assets.insert(0, record.clone());
            snapshot.assets.truncate(MAX_ASSETS);
            snapshot.last_activity_at = Some(now_rfc3339());
        }
        let _ = self.write_asset_manifest(&record);
        self.emit_snapshot().await;
    }

    fn append_workspace_log(&self, kind: &str, title: &str, body: &str) -> AppResult<()> {
        let log_path = self.workspace_dir.join("activity.log");
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)?;
        writeln!(file, "[{}] {} | {} | {}", now_rfc3339(), kind, title, body)?;
        Ok(())
    }

    fn write_asset_manifest(&self, asset: &HandsGeneratedAsset) -> AppResult<()> {
        let directory = self.workspace_dir.join("assets");
        std::fs::create_dir_all(&directory)?;
        std::fs::write(
            directory.join(format!("{}.json", asset.id)),
            serde_json::to_vec_pretty(asset)?,
        )?;
        Ok(())
    }

    async fn handle_chat(
        &self,
        session_key: String,
        session_label: String,
        input: MobileChatRequest,
    ) -> AppResult<Value> {
        let connection = self.upsert_session(session_key, session_label).await;
        let text = input.text.trim();
        if text.is_empty() {
            return Err(AppError::message("Message cannot be empty."));
        }

        let settings = self.db.load_settings()?;
        let model_id = input
            .model_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| settings.xai_model.clone())
            .unwrap_or_else(|| "grok-4-1-fast-reasoning".to_string());

        self.append_chat_message("user", text, Some(&model_id)).await;
        self.log_activity(
            "message",
            format!("Phone -> Grok ({})", connection.label),
            text,
            "phone",
            "complete",
        )
        .await;

        let history = self.chat_history().await;
        let mut aggregate = String::new();
        let usage: Result<TokenUsage, AppError> = self
            .providers
            .stream_chat(
                ProviderId::Xai,
                &model_id,
                &history,
                "",
                None,
                Some(2048),
                CancellationToken::new(),
                |delta| {
                    aggregate.push_str(&delta);
                    Ok(())
                },
            )
            .await;

        match usage {
            Ok(_) => {
                self.append_chat_message("assistant", &aggregate, Some(&model_id))
                    .await;
                self.log_activity("assistant", "Grok -> Phone", &aggregate, "desktop", "complete")
                    .await;
                Ok(json!({ "reply": aggregate, "modelId": model_id }))
            }
            Err(error) => {
                self.log_activity(
                    "assistant",
                    "Grok -> Phone failed",
                    error.to_string(),
                    "desktop",
                    "error",
                )
                .await;
                Err(error)
            }
        }
    }

    async fn handle_generate_image(
        &self,
        session_key: String,
        session_label: String,
        input: MobileImageRequest,
    ) -> AppResult<Value> {
        let connection = self.upsert_session(session_key, session_label).await;
        let prompt = input.prompt.trim();
        if prompt.is_empty() {
            return Err(AppError::message("Prompt cannot be empty."));
        }

        let settings = self.db.load_settings()?;
        let model_id = input
            .model_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| settings.xai_image_model.clone())
            .unwrap_or_else(|| "grok-imagine-image".to_string());

        self.log_activity(
            "image",
            format!("Image request from {}", connection.label),
            prompt,
            "phone",
            "pending",
        )
        .await;

        let asset = self
            .providers
            .generate_image(
                &GenerateImageRequest {
                    prompt: prompt.to_string(),
                    model_id,
                    category_id: None,
                    aspect_ratio: input.aspect_ratio.clone(),
                    resolution: input.resolution.clone(),
                },
                &media_root_dir().join("images"),
            )
            .await?;
        Ok(asset_response_json(self.store_generated_asset(asset).await?))
    }

    async fn handle_generate_video(
        &self,
        session_key: String,
        session_label: String,
        input: MobileVideoRequest,
    ) -> AppResult<Value> {
        let connection = self.upsert_session(session_key, session_label).await;
        let prompt = input.prompt.trim();
        if prompt.is_empty() {
            return Err(AppError::message("Prompt cannot be empty."));
        }

        let settings = self.db.load_settings()?;
        let model_id = input
            .model_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| settings.xai_video_model.clone())
            .unwrap_or_else(|| "grok-imagine-video".to_string());

        self.log_activity(
            "video",
            format!("Video request queued from {}", connection.label),
            prompt,
            "phone",
            "pending",
        )
        .await;

        let asset = self
            .providers
            .generate_video(
                &GenerateVideoRequest {
                    prompt: prompt.to_string(),
                    model_id,
                    category_id: None,
                },
                &media_root_dir().join("videos"),
            )
            .await?;
        Ok(asset_response_json(self.store_generated_asset(asset).await?))
    }

    async fn handle_generate_audio(
        &self,
        session_key: String,
        session_label: String,
        input: MobileAudioRequest,
    ) -> AppResult<Value> {
        let connection = self.upsert_session(session_key, session_label).await;
        let prompt = input.prompt.trim();
        if prompt.is_empty() {
            return Err(AppError::message("Prompt cannot be empty."));
        }

        let settings = self.db.load_settings()?;
        let model_id = input
            .model_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| settings.xai_tts_model.clone())
            .unwrap_or_else(|| "xai-tts".to_string());

        self.log_activity(
            "audio",
            format!("Audio request from {}", connection.label),
            prompt,
            "phone",
            "pending",
        )
        .await;

        let asset = self
            .providers
            .text_to_speech(
                &TextToSpeechRequest {
                    input: prompt.to_string(),
                    model_id: Some(model_id),
                    category_id: None,
                    voice: input.voice.clone().or(settings.xai_voice_name.clone()),
                    response_format: input.response_format.clone(),
                },
                &media_root_dir().join("audio"),
            )
            .await?;
        Ok(asset_response_json(self.store_generated_asset(asset).await?))
    }

    async fn store_generated_asset(&self, asset: MediaAsset) -> AppResult<HandsGeneratedAsset> {
        self.db.insert_media_asset(&asset)?;
        self.add_asset(&asset).await;
        self.log_activity(
            &asset.kind,
            format!("{} ready", asset.kind.to_uppercase()),
            &asset.prompt,
            "desktop",
            "complete",
        )
        .await;
        Ok(HandsGeneratedAsset {
            id: asset.id.clone(),
            kind: asset.kind.clone(),
            prompt: asset.prompt.clone(),
            file_path: asset.file_path.clone(),
            file_name: Path::new(&asset.file_path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            mime_type: asset.mime_type.clone(),
            created_at: asset.created_at.clone(),
            source_url: asset.source_url.clone(),
            download_url: format!("/api/assets/{}", asset.id),
        })
    }

    async fn open_relay_terminal(&self) {
        self.close_relay_terminal().await;

        let sender = match self.relay_sender.lock().await.clone() {
            Some(sender) => sender,
            None => return,
        };

        let pty_system = native_pty_system();
        let pair = match pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(pair) => pair,
            Err(_) => return,
        };

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let home_dir = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
        let mut command = CommandBuilder::new(&shell);
        command.arg("-l");
        command.arg("-i");
        command.cwd(&home_dir);
        command.env("HOME", home_dir.to_string_lossy().to_string());
        if let Ok(path) = std::env::var("PATH") {
            command.env("PATH", path);
        }
        command.env("TERM", "xterm-256color");
        command.env("CLICOLOR", "1");
        command.env("COLORTERM", "truecolor");

        let child = match pair.slave.spawn_command(command) {
            Ok(child) => child,
            Err(_) => return,
        };
        drop(pair.slave);

        let master = pair.master;
        let mut reader = match master.try_clone_reader() {
            Ok(reader) => reader,
            Err(_) => return,
        };
        let writer = match master.take_writer() {
            Ok(writer) => writer,
            Err(_) => return,
        };

        let session = HandsTerminalSession {
            writer: std::sync::Mutex::new(writer),
            master: std::sync::Mutex::new(master),
            _child: std::sync::Mutex::new(child),
        };
        *self.relay_terminal.lock().await = Some(session);

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data =
                            base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        let msg = json!({
                            "type": "desktop.terminal.output",
                            "data": data,
                        })
                        .to_string();
                        if sender.send(msg).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        self.log_activity(
            "terminal",
            "Remote terminal opened",
            "Phone connected to terminal via relay.",
            "phone",
            "complete",
        )
        .await;
    }

    async fn write_relay_terminal(&self, data_b64: &str) {
        if let Some(ref session) = *self.relay_terminal.lock().await {
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data_b64) {
                if let Ok(mut w) = session.writer.lock() {
                    let _ = w.write_all(&bytes);
                    let _ = w.flush();
                }
            }
        }
    }

    async fn resize_relay_terminal(&self, cols: u16, rows: u16) {
        if let Some(ref session) = *self.relay_terminal.lock().await {
            if let Ok(m) = session.master.lock() {
                let _ = m.resize(PtySize {
                    rows: rows.max(1),
                    cols: cols.max(1),
                    pixel_width: 0,
                    pixel_height: 0,
                });
            }
        }
    }

    async fn close_relay_terminal(&self) {
        if let Some(session) = self.relay_terminal.lock().await.take() {
            if let Ok(mut c) = session._child.lock() {
                let _ = c.kill();
            }
            self.log_activity(
                "terminal",
                "Remote terminal closed",
                "Phone disconnected from terminal.",
                "phone",
                "complete",
            )
            .await;
        }
    }

    async fn download_asset_bytes(&self, asset_id: &str) -> AppResult<(Vec<u8>, String)> {
        let asset = {
            let snapshot = self.snapshot.lock().await;
            snapshot
                .assets
                .iter()
                .find(|item| item.id == asset_id)
                .cloned()
                .ok_or_else(|| AppError::message("Asset was not found."))?
        };
        let canonical_root = media_root_dir().canonicalize()?;
        let canonical_asset = PathBuf::from(&asset.file_path).canonicalize()?;
        if !canonical_asset.starts_with(&canonical_root) {
            return Err(AppError::message("Asset is outside the media directory."));
        }
        let bytes = std::fs::read(&canonical_asset)?;
        Ok((
            bytes,
            asset
                .mime_type
                .unwrap_or_else(|| "application/octet-stream".to_string()),
        ))
    }
}

async fn spawn_tunnel_process(
    bridge: Arc<HandsBridge>,
    shutdown: CancellationToken,
    local_url: &str,
    settings: &Settings,
) -> (Option<JoinHandle<()>>, Option<Arc<Mutex<Option<Child>>>>) {
    let executable = settings
        .hands_tunnel_executable
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "cloudflared".to_string());
    bridge.set_tunnel_executable(Some(executable.clone())).await;

    let mut command = Command::new(&executable);
    command
        .arg("tunnel")
        .arg("--url")
        .arg(local_url)
        .arg("--no-autoupdate")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            bridge
                .set_tunnel_status(
                    None,
                    "Tunnel unavailable. Install cloudflared or point Hands at the correct executable path.",
                    Some(error.to_string()),
                )
                .await;
            return (None, None);
        }
    };

    bridge
        .set_tunnel_status(None, "Cloudflare quick tunnel is starting...", None)
        .await;

    let child = Arc::new(Mutex::new(Some(child)));
    let stdout = {
        let mut guard = child.lock().await;
        guard.as_mut().and_then(|process| process.stdout.take())
    };
    let stderr = {
        let mut guard = child.lock().await;
        guard.as_mut().and_then(|process| process.stderr.take())
    };

    if let Some(stdout) = stdout {
        let bridge_handle = bridge.clone();
        tokio::spawn(async move {
            read_tunnel_stream(BufReader::new(stdout), bridge_handle).await;
        });
    }
    if let Some(stderr) = stderr {
        let bridge_handle = bridge.clone();
        tokio::spawn(async move {
            read_tunnel_stream(BufReader::new(stderr), bridge_handle).await;
        });
    }

    let child_handle = child.clone();
    let bridge_handle = bridge.clone();
    let task = tokio::spawn(async move {
        loop {
            if shutdown.is_cancelled() {
                if let Some(mut child) = child_handle.lock().await.take() {
                    let _ = child.kill().await;
                }
                break;
            }

            let status = {
                let mut guard = child_handle.lock().await;
                if let Some(child) = guard.as_mut() {
                    match child.try_wait() {
                        Ok(status) => status,
                        Err(_) => None,
                    }
                } else {
                    None
                }
            };

            if let Some(status) = status {
                if !status.success() {
                    bridge_handle
                        .set_tunnel_status(
                            None,
                            "Cloudflare quick tunnel exited.",
                            Some(format!("exit status: {status}")),
                        )
                        .await;
                }
                break;
            }

            tokio::time::sleep(Duration::from_millis(400)).await;
        }
    });

    (Some(task), Some(child))
}

async fn spawn_relay_client(
    bridge: Arc<HandsBridge>,
    shutdown: CancellationToken,
    settings: &Settings,
) -> (Option<JoinHandle<()>>, Option<Arc<Mutex<Option<Child>>>>) {
    let relay_url = match settings
        .hands_relay_url
        .clone()
        .filter(|value| !value.trim().is_empty())
    {
        Some(value) => value,
        None => {
            bridge
                .set_tunnel_status(
                    None,
                    "Hands relay URL is missing. Add the relay origin in Hands settings.",
                    Some("missing hands relay URL".into()),
                )
                .await;
            return (None, None);
        }
    };
    let machine_id = settings
        .hands_relay_machine_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let desktop_token = settings
        .hands_relay_desktop_token
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let public_url = format!("{}/m/{}", relay_public_base(&relay_url), machine_id);

    let task = tokio::spawn(async move {
        loop {
            if shutdown.is_cancelled() {
                bridge.set_relay_sender(None).await;
                break;
            }

            let websocket_url = relay_websocket_url(&relay_url, &machine_id, &desktop_token);
            match connect_async(&websocket_url).await {
                Ok((stream, _)) => {
                    let (mut writer, mut reader) = stream.split();
                    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
                    bridge.set_relay_sender(Some(tx.clone())).await;
                    bridge
                        .set_tunnel_status(Some(public_url.clone()), "Hands relay connected.", None)
                        .await;

                    let initial_snapshot = bridge.snapshot().await;
                    let hello = json!({
                        "type": "desktop.hello",
                        "machineId": machine_id,
                        "machineLabel": "Super ASCIIVision",
                        "desktopToken": desktop_token,
                        "snapshot": initial_snapshot,
                    });
                    let _ = tx.send(hello.to_string());

                    let writer_task = tokio::spawn(async move {
                        while let Some(message) = rx.recv().await {
                            if writer.send(WsMessage::Text(message)).await.is_err() {
                                break;
                            }
                        }
                    });

                    let relay_result = async {
                        while let Some(message) = reader.next().await {
                            let message = match message {
                                Ok(value) => value,
                                Err(error) => {
                                    return Err(AppError::message(error.to_string()));
                                }
                            };
                            if !message.is_text() {
                                continue;
                            }
                            let Ok(text) = message.into_text() else {
                                continue;
                            };
                            let Ok(payload) = serde_json::from_str::<Value>(&text) else {
                                continue;
                            };
                            let message_type = payload.get("type").and_then(Value::as_str).unwrap_or_default();
                            if message_type == "relay.hello" {
                                let url = payload
                                    .get("publicUrl")
                                    .and_then(Value::as_str)
                                    .map(ToString::to_string)
                                    .unwrap_or_else(|| public_url.clone());
                                bridge
                                    .set_tunnel_status(Some(url), "Hands relay connected.", None)
                                    .await;
                                continue;
                            }
                            if message_type == "relay.request" {
                                let request_id = payload
                                    .get("requestId")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default()
                                    .to_string();
                                let action = payload
                                    .get("action")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default()
                                    .to_string();
                                let request_payload =
                                    payload.get("payload").cloned().unwrap_or_else(|| json!({}));
                                handle_relay_request(bridge.clone(), tx.clone(), request_id, action, request_payload)
                                    .await;
                            }
                            if message_type == "relay.terminal.open" {
                                bridge.open_relay_terminal().await;
                                continue;
                            }
                            if message_type == "relay.terminal.input" {
                                if let Some(data) = payload.get("data").and_then(Value::as_str) {
                                    bridge.write_relay_terminal(data).await;
                                }
                                continue;
                            }
                            if message_type == "relay.terminal.resize" {
                                let cols = payload.get("cols").and_then(Value::as_u64).unwrap_or(80) as u16;
                                let rows = payload.get("rows").and_then(Value::as_u64).unwrap_or(24) as u16;
                                bridge.resize_relay_terminal(cols, rows).await;
                                continue;
                            }
                            if message_type == "relay.terminal.close" {
                                bridge.close_relay_terminal().await;
                                continue;
                            }
                        }
                        Ok::<(), AppError>(())
                    }
                    .await;

                    writer_task.abort();
                    bridge.set_relay_sender(None).await;
                    match relay_result {
                        Ok(()) => {
                            bridge
                                .set_tunnel_status(
                                    None,
                                    "Hands relay disconnected. Reconnecting...",
                                    Some("desktop websocket closed".into()),
                                )
                                .await;
                        }
                        Err(error) => {
                            bridge
                                .set_tunnel_status(
                                    None,
                                    "Hands relay disconnected. Reconnecting...",
                                    Some(error.to_string()),
                                )
                                .await;
                        }
                    }
                }
                Err(error) => {
                    bridge
                        .set_tunnel_status(
                            None,
                            "Hands relay unavailable. Start the relay service or point Hands at the deployed relay URL.",
                            Some(error.to_string()),
                        )
                        .await;
                }
            }

            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    });

    (Some(task), None)
}

async fn handle_relay_request(
    bridge: Arc<HandsBridge>,
    sender: mpsc::UnboundedSender<String>,
    request_id: String,
    action: String,
    payload: Value,
) {
    let session_meta = serde_json::from_value::<RelaySessionPayload>(payload.clone()).unwrap_or(RelaySessionPayload {
        session_id: None,
        session_label: None,
    });
    let session_key = session_meta
        .session_id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let session_label = session_meta
        .session_label
        .unwrap_or_else(|| "Remote phone".to_string());

    let response = match action.as_str() {
        "chat" => match serde_json::from_value::<MobileChatRequest>(payload) {
            Ok(input) => bridge
                .handle_chat(session_key, session_label, input)
                .await
                .map(|value| json!({ "type": "desktop.response", "requestId": request_id, "ok": true, "payload": value })),
            Err(error) => Err(AppError::message(error.to_string())),
        },
        "generateImage" => match serde_json::from_value::<MobileImageRequest>(payload) {
            Ok(input) => bridge
                .handle_generate_image(session_key, session_label, input)
                .await
                .map(|value| json!({ "type": "desktop.response", "requestId": request_id, "ok": true, "payload": value })),
            Err(error) => Err(AppError::message(error.to_string())),
        },
        "generateVideo" => match serde_json::from_value::<MobileVideoRequest>(payload) {
            Ok(input) => bridge
                .handle_generate_video(session_key, session_label, input)
                .await
                .map(|value| json!({ "type": "desktop.response", "requestId": request_id, "ok": true, "payload": value })),
            Err(error) => Err(AppError::message(error.to_string())),
        },
        "generateAudio" => match serde_json::from_value::<MobileAudioRequest>(payload) {
            Ok(input) => bridge
                .handle_generate_audio(session_key, session_label, input)
                .await
                .map(|value| json!({ "type": "desktop.response", "requestId": request_id, "ok": true, "payload": value })),
            Err(error) => Err(AppError::message(error.to_string())),
        },
        "downloadAsset" => {
            let asset_id = payload
                .get("assetId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            match bridge.download_asset_bytes(&asset_id).await {
                Ok((bytes, content_type)) => Ok(json!({
                    "type": "desktop.response",
                    "requestId": request_id,
                    "ok": true,
                    "binaryBase64": base64::engine::general_purpose::STANDARD.encode(bytes),
                    "contentType": content_type,
                })),
                Err(error) => Err(error),
            }
        }
        _ => Err(AppError::message(format!("unsupported relay action: {action}"))),
    };

    let payload = match response {
        Ok(value) => value,
        Err(error) => json!({
            "type": "desktop.response",
            "requestId": request_id,
            "ok": false,
            "error": error.to_string(),
        }),
    };
    let _ = sender.send(payload.to_string());
}

async fn read_tunnel_stream<R>(reader: BufReader<R>, bridge: Arc<HandsBridge>)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(url) = extract_public_url(&line) {
            bridge
                .set_tunnel_status(Some(url), "Secure tunnel is live.", None)
                .await;
        }
    }
}

async fn root_page() -> Html<&'static str> {
    Html(MOBILE_HTML)
}

async fn pair_client(
    State(bridge): State<Arc<HandsBridge>>,
    headers: HeaderMap,
    Json(input): Json<PairRequest>,
) -> impl IntoResponse {
    let code = {
        let snapshot = bridge.snapshot.lock().await;
        snapshot.pairing_code.clone().unwrap_or_default()
    };

    if input.code.trim().to_uppercase() != code.to_uppercase() {
        return error_response(StatusCode::UNAUTHORIZED, "Pairing code did not match.");
    }

    let label = simplify_user_agent(
        headers
            .get(header::USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("phone"),
    );
    let token = uuid::Uuid::new_v4().to_string();
    let connection = bridge.add_session(token.clone(), label).await;
    bridge
        .log_activity(
            "connection",
            "Phone paired",
            format!("{} is now connected to Hands.", connection.label),
            "phone",
            "complete",
        )
        .await;

    let mut response = Json(json!({ "ok": true })).into_response();
    let cookie =
        format!("{SESSION_COOKIE}={token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800");
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

async fn bootstrap(
    State(bridge): State<Arc<HandsBridge>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    match require_session(&bridge, &headers).await {
        Ok(session) => {
            let status = bridge.snapshot().await;
            Json(json!({ "session": session.connection, "status": status })).into_response()
        }
        Err(response) => response,
    }
}

async fn send_chat(
    State(bridge): State<Arc<HandsBridge>>,
    headers: HeaderMap,
    Json(input): Json<MobileChatRequest>,
) -> impl IntoResponse {
    let session = match require_session(&bridge, &headers).await {
        Ok(session) => session,
        Err(response) => return response,
    };

    match bridge
        .handle_chat(session.token.clone(), session.connection.label.clone(), input)
        .await
    {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => error_response(StatusCode::BAD_GATEWAY, &error.to_string()),
    }
}

async fn generate_image(
    State(bridge): State<Arc<HandsBridge>>,
    headers: HeaderMap,
    Json(input): Json<MobileImageRequest>,
) -> impl IntoResponse {
    let session = match require_session(&bridge, &headers).await {
        Ok(session) => session,
        Err(response) => return response,
    };
    match bridge
        .handle_generate_image(session.token.clone(), session.connection.label.clone(), input)
        .await
    {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => error_response(StatusCode::BAD_GATEWAY, &error.to_string()),
    }
}

async fn generate_video(
    State(bridge): State<Arc<HandsBridge>>,
    headers: HeaderMap,
    Json(input): Json<MobileVideoRequest>,
) -> impl IntoResponse {
    let session = match require_session(&bridge, &headers).await {
        Ok(session) => session,
        Err(response) => return response,
    };
    match bridge
        .handle_generate_video(session.token.clone(), session.connection.label.clone(), input)
        .await
    {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => error_response(StatusCode::BAD_GATEWAY, &error.to_string()),
    }
}

async fn generate_audio(
    State(bridge): State<Arc<HandsBridge>>,
    headers: HeaderMap,
    Json(input): Json<MobileAudioRequest>,
) -> impl IntoResponse {
    let session = match require_session(&bridge, &headers).await {
        Ok(session) => session,
        Err(response) => return response,
    };
    match bridge
        .handle_generate_audio(session.token.clone(), session.connection.label.clone(), input)
        .await
    {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => error_response(StatusCode::BAD_GATEWAY, &error.to_string()),
    }
}

async fn download_asset(
    State(bridge): State<Arc<HandsBridge>>,
    headers: HeaderMap,
    AxumPath(asset_id): AxumPath<String>,
) -> impl IntoResponse {
    if let Err(response) = require_session(&bridge, &headers).await {
        return response;
    }

    match bridge.download_asset_bytes(&asset_id).await {
        Ok((bytes, mime)) => {
            let mut response = Response::new(Body::from(bytes));
            *response.status_mut() = StatusCode::OK;
            if let Ok(value) = HeaderValue::from_str(&mime) {
                response.headers_mut().insert(header::CONTENT_TYPE, value);
            }
            response
        }
        Err(error) => error_response(StatusCode::NOT_FOUND, &error.to_string()),
    }
}

async fn terminal_ws_handler(
    State(bridge): State<Arc<HandsBridge>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response<Body> {
    if require_session(&bridge, &headers).await.is_err() {
        return error_response(StatusCode::UNAUTHORIZED, "Pair this device first.");
    }
    ws.on_upgrade(move |socket| handle_terminal_ws(socket, bridge))
        .into_response()
}

async fn handle_terminal_ws(socket: WebSocket, bridge: Arc<HandsBridge>) {
    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(pair) => pair,
        Err(err) => {
            error!("failed to open PTY for hands terminal: {err}");
            return;
        }
    };

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let home_dir = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    let mut command = CommandBuilder::new(&shell);
    command.arg("-l");
    command.arg("-i");
    command.cwd(&home_dir);
    command.env("HOME", home_dir.to_string_lossy().to_string());
    if let Ok(path) = std::env::var("PATH") {
        command.env("PATH", path);
    }
    command.env("TERM", "xterm-256color");
    command.env("CLICOLOR", "1");
    command.env("CLICOLOR_FORCE", "1");
    command.env("COLORTERM", "truecolor");

    let mut child = match pair.slave.spawn_command(command) {
        Ok(child) => child,
        Err(err) => {
            error!("failed to spawn shell for hands terminal: {err}");
            return;
        }
    };
    drop(pair.slave);

    let master = pair.master;
    let mut reader = match master.try_clone_reader() {
        Ok(reader) => reader,
        Err(err) => {
            error!("failed to clone PTY reader: {err}");
            return;
        }
    };
    let writer = match master.take_writer() {
        Ok(writer) => writer,
        Err(err) => {
            error!("failed to take PTY writer: {err}");
            return;
        }
    };

    let writer = Arc::new(std::sync::Mutex::new(writer));
    let master = Arc::new(std::sync::Mutex::new(master));
    let (output_tx, mut output_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if output_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let (mut ws_sender, mut ws_receiver) = socket.split();

    let send_task = tokio::spawn(async move {
        while let Some(data) = output_rx.recv().await {
            if ws_sender
                .send(WsFrame::Binary(data.into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    bridge
        .log_activity(
            "terminal",
            "Mobile terminal opened",
            "Phone connected to a terminal session.",
            "phone",
            "complete",
        )
        .await;

    while let Some(Ok(msg)) = ws_receiver.next().await {
        match msg {
            WsFrame::Text(ref text) => {
                let s: &str = text;
                if let Ok(cmd) = serde_json::from_str::<Value>(s) {
                    match cmd.get("type").and_then(Value::as_str) {
                        Some("input") => {
                            if let Some(data) = cmd.get("data").and_then(Value::as_str) {
                                if let Ok(mut w) = writer.lock() {
                                    let _ = w.write_all(data.as_bytes());
                                    let _ = w.flush();
                                }
                            }
                        }
                        Some("resize") => {
                            let cols =
                                cmd.get("cols").and_then(Value::as_u64).unwrap_or(80) as u16;
                            let rows =
                                cmd.get("rows").and_then(Value::as_u64).unwrap_or(24) as u16;
                            if let Ok(m) = master.lock() {
                                let _ = m.resize(PtySize {
                                    rows: rows.max(1),
                                    cols: cols.max(1),
                                    pixel_width: 0,
                                    pixel_height: 0,
                                });
                            }
                        }
                        _ => {}
                    }
                }
            }
            WsFrame::Binary(ref data) => {
                if let Ok(mut w) = writer.lock() {
                    let _ = w.write_all(data);
                    let _ = w.flush();
                }
            }
            WsFrame::Close(_) => break,
            _ => {}
        }
    }

    send_task.abort();
    let _ = child.kill();

    bridge
        .log_activity(
            "terminal",
            "Mobile terminal closed",
            "Phone disconnected from terminal session.",
            "phone",
            "complete",
        )
        .await;
}

async fn require_session(
    bridge: &HandsBridge,
    headers: &HeaderMap,
) -> Result<SessionContext, Response<Body>> {
    let token = extract_cookie_token(headers)
        .ok_or_else(|| error_response(StatusCode::UNAUTHORIZED, "Pair this device first."))?;
    let connection = bridge
        .touch_session(&token)
        .await
        .ok_or_else(|| error_response(StatusCode::UNAUTHORIZED, "Session expired. Pair again."))?;
    Ok(SessionContext { token, connection })
}

fn extract_cookie_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookie| {
            cookie.split(';').find_map(|entry| {
                let mut parts = entry.trim().splitn(2, '=');
                let key = parts.next()?;
                let value = parts.next()?;
                (key == SESSION_COOKIE).then(|| value.to_string())
            })
        })
}

fn error_response(status: StatusCode, message: &str) -> Response<Body> {
    let mut response = Json(json!({ "error": message })).into_response();
    *response.status_mut() = status;
    response
}

fn simplify_user_agent(value: &str) -> String {
    if value.contains("iPhone") {
        "iPhone".into()
    } else if value.contains("Android") {
        "Android phone".into()
    } else if value.contains("iPad") {
        "iPad".into()
    } else {
        value
            .split_whitespace()
            .take(3)
            .collect::<Vec<_>>()
            .join(" ")
    }
}

fn extract_public_url(line: &str) -> Option<String> {
    line.split_whitespace()
        .find(|token| token.contains("trycloudflare.com"))
        .map(|token| token.trim_matches(|char| matches!(char, '"' | '\'' | ')' | '(' | ',')))
        .map(ToString::to_string)
}

fn relay_public_base(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn relay_websocket_url(relay_url: &str, machine_id: &str, desktop_token: &str) -> String {
    let base = relay_public_base(relay_url);
    let websocket_base = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        format!("ws://{base}")
    };
    format!(
        "{websocket_base}/ws/desktop?machineId={}&desktopToken={}&label=Grok%20Desktop",
        machine_id, desktop_token
    )
}

fn asset_response_json(asset: HandsGeneratedAsset) -> Value {
    json!({
        "asset": {
            "id": asset.id,
            "kind": asset.kind,
            "prompt": asset.prompt,
            "filePath": asset.file_path,
            "mimeType": asset.mime_type,
            "downloadUrl": asset.download_url,
        }
    })
}

fn ensure_workspace_readme(workspace_dir: &Path) -> AppResult<()> {
    let readme = workspace_dir.join("README.md");
    if readme.exists() {
        return Ok(());
    }
    std::fs::write(
        readme,
        "# Hands Workspace\n\nThis folder stores the local mobile bridge log and generated asset manifests for the Hands page.\n",
    )?;
    Ok(())
}

fn hands_workspace_dir() -> PathBuf {
    app_storage_dir().join("hands-workspace")
}

fn media_root_dir() -> PathBuf {
    app_storage_dir().join("media")
}

fn app_storage_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("SuperASCIIVision")
}

fn random_code(length: usize) -> String {
    uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(length)
        .collect::<String>()
        .to_uppercase()
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn offline_snapshot(settings: &Settings) -> HandsStatus {
    HandsStatus {
        state: "stopped".into(),
        tunnel_provider: settings
            .hands_tunnel_provider
            .clone()
            .or_else(|| Some("cloudflare".into())),
        tunnel_executable: settings.hands_tunnel_executable.clone(),
        local_url: None,
        public_url: None,
        pairing_code: None,
        workspace_dir: hands_workspace_dir().to_string_lossy().to_string(),
        tunnel_status: "Hands bridge is offline.".into(),
        last_error: None,
        last_activity_at: None,
        connections: Vec::new(),
        activity: Vec::new(),
        assets: Vec::new(),
    }
}

const MOBILE_HTML: &str = r##"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Hands</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0a0d0f;
        --panel: rgba(20, 26, 28, 0.92);
        --muted: #8da39e;
        --text: #f4f7f5;
        --accent: #7fe7b5;
        --line: rgba(255, 255, 255, 0.08);
        --warn: #fbbf24;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
        background:
          radial-gradient(circle at top, rgba(127, 231, 181, 0.18), transparent 42%),
          linear-gradient(180deg, #0f1716 0%, #090c0e 72%);
        color: var(--text);
      }
      main { padding: 18px 16px 32px; max-width: 720px; margin: 0 auto; }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 22px;
        padding: 16px;
        backdrop-filter: blur(18px);
        box-shadow: 0 18px 70px rgba(0, 0, 0, 0.26);
      }
      h1, h2, p { margin: 0; }
      .stack { display: grid; gap: 14px; }
      .eyebrow {
        font-size: 11px;
        letter-spacing: 0.24em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .hero { display: grid; gap: 8px; margin-bottom: 16px; }
      .hero h1 { font-size: 28px; line-height: 1; }
      .hero p { color: #d4dfda; font-size: 14px; line-height: 1.45; }
      input, textarea, select, button {
        width: 100%;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.04);
        color: var(--text);
        padding: 12px 14px;
        font: inherit;
      }
      textarea { min-height: 110px; resize: vertical; }
      button {
        background: linear-gradient(180deg, rgba(127, 231, 181, 0.24), rgba(87, 180, 140, 0.18));
        border-color: rgba(127, 231, 181, 0.26);
        font-weight: 600;
      }
      .secondary {
        background: rgba(255, 255, 255, 0.04);
        border-color: var(--line);
      }
      .row { display: grid; gap: 10px; }
      .chips { display: flex; gap: 8px; flex-wrap: wrap; }
      .chip {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 7px 11px;
        font-size: 12px;
        color: #d7e6df;
      }
      .tabs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
      .tab.active { border-color: rgba(127, 231, 181, 0.28); background: rgba(127, 231, 181, 0.12); }
      .messages, .assets { display: grid; gap: 10px; }
      .message, .asset {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.03);
      }
      .message small, .asset small { color: var(--muted); display: block; margin-bottom: 6px; }
      .asset a { color: var(--accent); text-decoration: none; }
      .hidden { display: none !important; }
      .warning { color: var(--warn); }
      #terminal-area { height: 320px; border-radius: 12px; overflow: hidden; background: #0a0d0f; }
      #terminal-area .xterm { padding: 4px; }
    </style>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
  </head>
  <body>
    <main class="stack">
      <section class="hero">
        <div class="eyebrow">Hands</div>
        <h1>Super ASCIIVision on your phone.</h1>
        <p>Pair once with the desktop app, then chat and generate images, video, and audio from this secure mobile surface.</p>
      </section>

      <section id="pair-panel" class="panel stack">
        <div>
          <h2>Pair this phone</h2>
          <p style="margin-top:6px;color:var(--muted);font-size:13px;">Enter the pairing code shown in the desktop Hands page.</p>
        </div>
        <input id="pair-code" placeholder="PAIR CODE" autocomplete="one-time-code" />
        <button id="pair-button" type="button">Pair phone</button>
        <p id="pair-error" class="warning hidden"></p>
      </section>

      <section id="app-panel" class="hidden stack">
        <div class="panel stack">
          <div class="eyebrow">Status</div>
          <div id="status-chips" class="chips"></div>
          <p id="status-text" style="font-size:13px;color:var(--muted);"></p>
        </div>

        <div class="panel stack">
          <div class="tabs">
            <button class="tab active" data-tab="chat" type="button">Chat</button>
            <button class="tab secondary" data-tab="image" type="button">Image</button>
            <button class="tab secondary" data-tab="video" type="button">Video</button>
            <button class="tab secondary" data-tab="audio" type="button">Audio</button>
            <button class="tab secondary" data-tab="terminal" type="button">Term</button>
          </div>

          <div id="prompt-area" class="row">
            <textarea id="prompt" placeholder="Send a message or describe what to generate."></textarea>
            <div id="extra-fields" class="row"></div>
            <button id="submit" type="button">Send</button>
          </div>
          <div id="terminal-area" class="hidden"></div>
        </div>

        <div class="panel stack">
          <div class="eyebrow">Timeline</div>
          <div id="messages" class="messages"></div>
        </div>

        <div class="panel stack">
          <div class="eyebrow">Generated Files</div>
          <div id="assets" class="assets"></div>
        </div>
      </section>
    </main>

    <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
    <script>
      const state = { mode: "chat", status: null };
      const pairPanel = document.getElementById("pair-panel");
      const appPanel = document.getElementById("app-panel");
      const pairError = document.getElementById("pair-error");
      const promptInput = document.getElementById("prompt");
      const submitButton = document.getElementById("submit");
      const statusChips = document.getElementById("status-chips");
      const statusText = document.getElementById("status-text");
      const messagesEl = document.getElementById("messages");
      const assetsEl = document.getElementById("assets");
      const extraFields = document.getElementById("extra-fields");

      async function request(path, options = {}) {
        const response = await fetch(path, {
          credentials: "include",
          headers: { "Content-Type": "application/json", ...(options.headers || {}) },
          ...options,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `Request failed: ${response.status}`);
        }
        return response.json().catch(() => ({}));
      }

      function render() {
        const status = state.status?.status;
        if (!status) return;
        pairPanel.classList.add("hidden");
        appPanel.classList.remove("hidden");
        statusChips.innerHTML = "";
        [
          status.publicUrl ? "Secure link live" : "Local bridge live",
          `${status.connections.length} phone${status.connections.length === 1 ? "" : "s"}`,
          status.tunnelProvider || "cloudflare",
        ].forEach((label) => {
          const chip = document.createElement("div");
          chip.className = "chip";
          chip.textContent = label;
          statusChips.appendChild(chip);
        });
        statusText.textContent = status.publicUrl
          ? `${status.tunnelStatus} Pairing stays on the desktop side.`
          : status.tunnelStatus;
        messagesEl.innerHTML = "";
        (status.activity || []).slice(0, 12).forEach((item) => {
          const card = document.createElement("div");
          card.className = "message";
          card.innerHTML = `<small>${item.kind.toUpperCase()} · ${new Date(item.createdAt).toLocaleString()}</small><strong>${item.title}</strong><div style="margin-top:6px;white-space:pre-wrap;">${item.body}</div>`;
          messagesEl.appendChild(card);
        });
        if (!messagesEl.childElementCount) {
          messagesEl.innerHTML = '<div class="message"><small>Waiting</small><strong>No activity yet.</strong></div>';
        }
        assetsEl.innerHTML = "";
        (status.assets || []).slice(0, 8).forEach((asset) => {
          const card = document.createElement("div");
          card.className = "asset";
          card.innerHTML = `<small>${asset.kind.toUpperCase()} · ${new Date(asset.createdAt).toLocaleString()}</small><strong>${asset.fileName}</strong><div style="margin-top:6px;">${asset.prompt}</div><div style="margin-top:8px;"><a href="${asset.downloadUrl}" target="_blank" rel="noreferrer">Open file</a></div>`;
          assetsEl.appendChild(card);
        });
        if (!assetsEl.childElementCount) {
          assetsEl.innerHTML = '<div class="asset"><small>Workspace</small><strong>No generated files yet.</strong></div>';
        }
        renderFields();
      }

      function renderFields() {
        if (state.mode === "image") {
          extraFields.innerHTML = '<select id="aspect"><option value="1:1">1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option></select><select id="resolution"><option value="1k">1k</option><option value="2k">2k</option></select>';
          return;
        }
        if (state.mode === "audio") {
          extraFields.innerHTML = '<select id="voice"><option value="eve">Eve</option><option value="ara">Ara</option><option value="rex">Rex</option><option value="sal">Sal</option><option value="leo">Leo</option></select><select id="format"><option value="mp3">MP3</option><option value="wav">WAV</option></select>';
          return;
        }
        extraFields.innerHTML = "";
      }

      async function bootstrap() {
        try {
          state.status = await request("/api/bootstrap", { method: "GET" });
          render();
        } catch (error) {
          pairPanel.classList.remove("hidden");
          appPanel.classList.add("hidden");
        }
      }

      document.getElementById("pair-button").addEventListener("click", async () => {
        pairError.classList.add("hidden");
        try {
          await request("/api/pair", {
            method: "POST",
            body: JSON.stringify({ code: document.getElementById("pair-code").value }),
          });
          await bootstrap();
        } catch (error) {
          pairError.textContent = error.message;
          pairError.classList.remove("hidden");
        }
      });

      let term = null;
      let termWs = null;
      let fitAddon = null;

      function connectTerminal() {
        const container = document.getElementById("terminal-area");
        container.classList.remove("hidden");
        if (!term) {
          term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: '"SF Mono", "Menlo", "Courier New", monospace',
            theme: { background: "#0a0d0f", foreground: "#f4f7f5", cursor: "#7fe7b5", selectionBackground: "rgba(127,231,181,0.3)" },
          });
          fitAddon = new FitAddon.FitAddon();
          term.loadAddon(fitAddon);
          term.open(container);
          setTimeout(() => fitAddon.fit(), 50);
          term.onData((data) => {
            if (termWs && termWs.readyState === WebSocket.OPEN) {
              termWs.send(JSON.stringify({ type: "input", data }));
            }
          });
          window.addEventListener("resize", () => {
            if (fitAddon && state.mode === "terminal") {
              fitAddon.fit();
              if (termWs && termWs.readyState === WebSocket.OPEN) {
                termWs.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
              }
            }
          });
        } else {
          setTimeout(() => fitAddon.fit(), 50);
        }
        if (!termWs || termWs.readyState !== WebSocket.OPEN) {
          const proto = location.protocol === "https:" ? "wss:" : "ws:";
          termWs = new WebSocket(proto + "//" + location.host + "/api/terminal/ws");
          termWs.binaryType = "arraybuffer";
          termWs.onopen = () => {
            termWs.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
          };
          termWs.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
              term.write(new Uint8Array(event.data));
            }
          };
          termWs.onclose = () => { termWs = null; };
          termWs.onerror = () => { termWs = null; };
        }
      }

      document.querySelectorAll(".tab").forEach((button) => {
        button.addEventListener("click", () => {
          state.mode = button.dataset.tab;
          document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
          document.querySelectorAll(".tab").forEach((tab) => tab.classList.add("secondary"));
          button.classList.add("active");
          button.classList.remove("secondary");
          if (state.mode === "terminal") {
            document.getElementById("prompt-area").classList.add("hidden");
            connectTerminal();
          } else {
            document.getElementById("prompt-area").classList.remove("hidden");
            document.getElementById("terminal-area").classList.add("hidden");
            renderFields();
          }
        });
      });

      submitButton.addEventListener("click", async () => {
        const prompt = promptInput.value.trim();
        if (!prompt) return;
        submitButton.disabled = true;
        try {
          if (state.mode === "chat") {
            await request("/api/chat", { method: "POST", body: JSON.stringify({ text: prompt }) });
          } else if (state.mode === "image") {
            await request("/api/generate/image", {
              method: "POST",
              body: JSON.stringify({
                prompt,
                aspectRatio: document.getElementById("aspect")?.value,
                resolution: document.getElementById("resolution")?.value,
              }),
            });
          } else if (state.mode === "video") {
            await request("/api/generate/video", { method: "POST", body: JSON.stringify({ prompt }) });
          } else if (state.mode === "audio") {
            await request("/api/generate/audio", {
              method: "POST",
              body: JSON.stringify({
                prompt,
                voice: document.getElementById("voice")?.value,
                responseFormat: document.getElementById("format")?.value,
              }),
            });
          }
          promptInput.value = "";
          await bootstrap();
        } catch (error) {
          alert(error.message);
        } finally {
          submitButton.disabled = false;
        }
      });

      renderFields();
      bootstrap();
      window.setInterval(bootstrap, 4000);
    </script>
  </body>
</html>
"##;
