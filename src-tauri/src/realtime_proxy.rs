use std::sync::Arc;

use axum::extract::ws::{Message as AxumMsg, WebSocket, WebSocketUpgrade};
use axum::extract::State as AxumState;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message as TungsteniteMsg;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

use crate::error::{AppError, AppResult};

struct ProxyState {
    websocket_url: String,
    api_key: String,
    cancel: CancellationToken,
}

pub struct RealtimeProxy {
    pub port: u16,
    cancel: CancellationToken,
}

impl RealtimeProxy {
    /// Start a local WebSocket proxy that relays to the xAI realtime API with proper auth headers.
    pub async fn start(websocket_url: String, api_key: String) -> AppResult<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| AppError::message(format!("Failed to bind proxy: {e}")))?;
        let port = listener
            .local_addr()
            .map_err(|e| AppError::message(format!("Failed to get proxy port: {e}")))?
            .port();

        let cancel = CancellationToken::new();
        let state = Arc::new(ProxyState {
            websocket_url,
            api_key,
            cancel: cancel.clone(),
        });

        let router = Router::new()
            .route("/ws", get(ws_handler))
            .with_state(state);

        let cancel_signal = cancel.clone();
        tokio::spawn(async move {
            let server = axum::serve(listener, router).with_graceful_shutdown(async move {
                cancel_signal.cancelled().await;
            });
            if let Err(e) = server.await {
                error!("realtime proxy server error: {e}");
            }
        });

        info!("realtime proxy started on port {port}");
        Ok(Self { port, cancel })
    }

    pub fn stop(&self) {
        self.cancel.cancel();
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    AxumState(state): AxumState<Arc<ProxyState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn handle_ws(local_socket: WebSocket, state: Arc<ProxyState>) {
    // Connect to xAI with proper Authorization header
    let mut request = match state.websocket_url.as_str().into_client_request() {
        Ok(r) => r,
        Err(e) => {
            error!("realtime proxy: invalid URL: {e}");
            return;
        }
    };
    request.headers_mut().insert(
        "Authorization",
        match format!("Bearer {}", state.api_key).parse() {
            Ok(v) => v,
            Err(e) => {
                error!("realtime proxy: invalid auth header: {e}");
                return;
            }
        },
    );

    let (upstream, _response) = match connect_async(request).await {
        Ok(pair) => pair,
        Err(e) => {
            error!("realtime proxy: failed to connect to xAI: {e}");
            return;
        }
    };

    info!("realtime proxy: connected to xAI");

    let (mut upstream_sink, mut upstream_stream) = upstream.split();
    let (mut local_sink, mut local_stream) = local_socket.split();
    let cancel = state.cancel.clone();

    // Relay: local → upstream
    let cancel_up = cancel.clone();
    let up_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel_up.cancelled() => break,
                msg = local_stream.next() => {
                    match msg {
                        Some(Ok(AxumMsg::Text(text))) => {
                            if upstream_sink.send(TungsteniteMsg::Text(text.to_string())).await.is_err() {
                                break;
                            }
                        }
                        Some(Ok(AxumMsg::Binary(data))) => {
                            if upstream_sink.send(TungsteniteMsg::Binary(data.to_vec())).await.is_err() {
                                break;
                            }
                        }
                        Some(Ok(AxumMsg::Close(_))) | None => break,
                        _ => {}
                    }
                }
            }
        }
        let _ = upstream_sink.close().await;
    });

    // Relay: upstream → local
    let cancel_down = cancel.clone();
    let down_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel_down.cancelled() => break,
                msg = upstream_stream.next() => {
                    match msg {
                        Some(Ok(TungsteniteMsg::Text(text))) => {
                            if local_sink.send(AxumMsg::Text(text.into())).await.is_err() {
                                break;
                            }
                        }
                        Some(Ok(TungsteniteMsg::Binary(data))) => {
                            if local_sink.send(AxumMsg::Binary(data.into())).await.is_err() {
                                break;
                            }
                        }
                        Some(Ok(TungsteniteMsg::Close(_))) | None => break,
                        _ => {}
                    }
                }
            }
        }
        let _ = local_sink.close().await;
    });

    let _ = tokio::join!(up_task, down_task);
    info!("realtime proxy: session ended");
}
