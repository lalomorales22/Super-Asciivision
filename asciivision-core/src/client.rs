use crate::message::WsMessage;
use crate::video::AsciiFrame;
use crate::webcam::{ascii_frame_to_ws, ws_frame_to_ascii, WebcamCapture, WebcamConfig};
use anyhow::Result;
use futures::{SinkExt, StreamExt};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message as TungsteniteMsg};

pub struct VideoChatClient {
    pub username: String,
    pub server_url: String,
    pub connected_users: Arc<RwLock<Vec<String>>>,
    pub remote_frames: Arc<RwLock<HashMap<String, (String, AsciiFrame)>>>,
    pub local_frame: Arc<RwLock<Option<AsciiFrame>>>,
    pub chat_messages: Arc<RwLock<Vec<(String, String)>>>,
    pub connected: Arc<RwLock<bool>>,
    pub status: Arc<RwLock<String>>,
    chat_tx: mpsc::UnboundedSender<String>,
    chat_rx: Arc<Mutex<mpsc::UnboundedReceiver<String>>>,
}

impl VideoChatClient {
    pub fn new(username: String, server_url: String) -> Self {
        let (chat_tx, chat_rx) = mpsc::unbounded_channel();
        Self {
            username,
            server_url,
            connected_users: Arc::new(RwLock::new(Vec::new())),
            remote_frames: Arc::new(RwLock::new(HashMap::new())),
            local_frame: Arc::new(RwLock::new(None)),
            chat_messages: Arc::new(RwLock::new(Vec::new())),
            connected: Arc::new(RwLock::new(false)),
            status: Arc::new(RwLock::new("disconnected".to_string())),
            chat_tx,
            chat_rx: Arc::new(Mutex::new(chat_rx)),
        }
    }

    pub fn send_chat(&self, content: String) {
        let _ = self.chat_tx.send(content);
    }

    pub fn is_connected(&self) -> bool {
        *self.connected.read()
    }

    pub fn get_status(&self) -> String {
        self.status.read().clone()
    }

    /// Returns a `'static + Send` future that establishes the WebSocket
    /// connection and manages all communication.  Because it captures
    /// Arc-cloned handles from `self`, every update made by the returned
    /// future is visible through the `VideoChatClient` stored in the app.
    pub fn connect_future(
        &self,
    ) -> impl std::future::Future<Output = Result<()>> + Send + 'static {
        let server_url = self.server_url.clone();
        let username = self.username.clone();
        let connected_users = Arc::clone(&self.connected_users);
        let remote_frames = Arc::clone(&self.remote_frames);
        let local_frame = Arc::clone(&self.local_frame);
        let chat_messages = Arc::clone(&self.chat_messages);
        let connected = Arc::clone(&self.connected);
        let status = Arc::clone(&self.status);
        let chat_rx = Arc::clone(&self.chat_rx);

        async move {
            *status.write() = format!("connecting to {}", server_url);

            let (ws_stream, _) = connect_async(&server_url).await?;
            let (ws_tx, mut ws_rx) = ws_stream.split();
            let ws_tx = Arc::new(Mutex::new(ws_tx));

            *connected.write() = true;
            *status.write() = "connected, joining...".to_string();

            let join_msg = WsMessage::Join {
                username: username.clone(),
            };
            {
                let mut tx = ws_tx.lock().await;
                tx.send(TungsteniteMsg::Text(serde_json::to_string(&join_msg)?))
                    .await?;
            }

            let webcam = WebcamCapture::start(WebcamConfig::default()).ok();

            // -- receive task --
            let connected_users_rx = Arc::clone(&connected_users);
            let remote_frames_rx = Arc::clone(&remote_frames);
            let chat_messages_rx = Arc::clone(&chat_messages);
            let connected_rx = Arc::clone(&connected);
            let status_rx = Arc::clone(&status);

            tokio::spawn(async move {
                while let Some(msg_result) = ws_rx.next().await {
                    match msg_result {
                        Ok(TungsteniteMsg::Text(text)) => {
                            if let Ok(msg) = serde_json::from_str::<WsMessage>(&text) {
                                match msg {
                                    WsMessage::Ack { message, .. } => {
                                        *status_rx.write() = message;
                                    }
                                    WsMessage::UserList(users) => {
                                        let mut guard = connected_users_rx.write();
                                        *guard =
                                            users.iter().map(|u| u.username.clone()).collect();
                                        *status_rx.write() =
                                            format!("{} users online", guard.len());
                                    }
                                    WsMessage::Frame {
                                        user_id: frame_uid,
                                        username: frame_user,
                                        frame,
                                    } => {
                                        let ascii = ws_frame_to_ascii(&frame);
                                        remote_frames_rx
                                            .write()
                                            .insert(frame_uid, (frame_user, ascii));
                                    }
                                    WsMessage::Chat {
                                        username: chat_user,
                                        content,
                                        ..
                                    } => {
                                        let mut msgs = chat_messages_rx.write();
                                        msgs.push((chat_user, content));
                                        if msgs.len() > 200 {
                                            msgs.drain(0..50);
                                        }
                                    }
                                    WsMessage::UserJoined {
                                        username: joined, ..
                                    } => {
                                        chat_messages_rx.write().push((
                                            "SYSTEM".to_string(),
                                            format!("{} joined", joined),
                                        ));
                                    }
                                    WsMessage::UserLeft {
                                        user_id: left_uid,
                                        username: left,
                                    } => {
                                        chat_messages_rx.write().push((
                                            "SYSTEM".to_string(),
                                            format!("{} left", left),
                                        ));
                                        remote_frames_rx.write().remove(&left_uid);
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Ok(TungsteniteMsg::Close(_)) | Err(_) => break,
                        _ => {}
                    }
                }
                *connected_rx.write() = false;
                *status_rx.write() = "disconnected".to_string();
            });

            // -- webcam send task --
            let ws_tx_cam = Arc::clone(&ws_tx);
            let local_frame_cam = Arc::clone(&local_frame);
            let username_cam = username.clone();

            if webcam.is_some() {
                tokio::spawn(async move {
                    let cam = webcam.unwrap();
                    loop {
                        if let Some(frame) = cam.try_recv() {
                            *local_frame_cam.write() = Some(frame.clone());
                            let ws_frame = ascii_frame_to_ws(&frame);
                            let msg = WsMessage::Frame {
                                user_id: String::new(),
                                username: username_cam.clone(),
                                frame: ws_frame,
                            };
                            if let Ok(json) = serde_json::to_string(&msg) {
                                let mut tx = ws_tx_cam.lock().await;
                                if tx.send(TungsteniteMsg::Text(json)).await.is_err() {
                                    break;
                                }
                            }
                        }
                        tokio::time::sleep(tokio::time::Duration::from_millis(33)).await;
                    }
                });
            }

            // -- chat send task --
            let ws_tx_chat = Arc::clone(&ws_tx);
            let username_chat = username.clone();

            tokio::spawn(async move {
                let mut rx = chat_rx.lock().await;
                while let Some(content) = rx.recv().await {
                    let msg = WsMessage::Chat {
                        user_id: String::new(),
                        username: username_chat.clone(),
                        content,
                    };
                    if let Ok(json) = serde_json::to_string(&msg) {
                        let mut tx = ws_tx_chat.lock().await;
                        let _ = tx.send(TungsteniteMsg::Text(json)).await;
                    }
                }
            });

            Ok(())
        }
    }
}
