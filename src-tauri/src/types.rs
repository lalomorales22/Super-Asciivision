use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum ProviderId {
    #[default]
    #[serde(rename = "xai")]
    Xai,
}

impl ProviderId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Xai => "xai",
        }
    }

    #[allow(dead_code)]
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Xai => "xAI",
        }
    }

    pub fn from_db(_value: &str) -> Self {
        Self::Xai
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageRole {
    System,
    User,
    Assistant,
    ToolNote,
}

impl MessageRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::ToolNote => "tool-note",
        }
    }

    #[allow(dead_code)]
    pub fn from_db(value: &str) -> Self {
        match value {
            "system" => Self::System,
            "assistant" => Self::Assistant,
            "tool-note" => Self::ToolNote,
            _ => Self::User,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider_id: ProviderId,
    pub configured: bool,
    pub available: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDescriptor {
    pub provider_id: ProviderId,
    pub model_id: String,
    pub label: String,
    pub supports_streaming: bool,
    pub supports_workspace_context: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub hotkey: String,
    pub always_on_top: bool,
    pub default_provider: ProviderId,
    pub xai_model: Option<String>,
    pub xai_image_model: Option<String>,
    pub xai_video_model: Option<String>,
    pub xai_tts_model: Option<String>,
    pub xai_realtime_model: Option<String>,
    pub xai_voice_name: Option<String>,
    pub hands_tunnel_provider: Option<String>,
    pub hands_tunnel_executable: Option<String>,
    pub hands_relay_url: Option<String>,
    pub hands_relay_machine_id: Option<String>,
    pub hands_relay_desktop_token: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: "CommandOrControl+Shift+Space".into(),
            always_on_top: false,
            default_provider: ProviderId::Xai,
            xai_model: Some("grok-code-fast-1".into()),
            xai_image_model: Some("grok-imagine-image".into()),
            xai_video_model: Some("grok-imagine-video".into()),
            xai_tts_model: Some("xai-tts".into()),
            xai_realtime_model: Some("grok-realtime".into()),
            xai_voice_name: Some("eve".into()),
            hands_tunnel_provider: Some("relay".into()),
            hands_tunnel_executable: None,
            hands_relay_url: None,
            hands_relay_machine_id: None,
            hands_relay_desktop_token: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub hotkey: Option<String>,
    pub always_on_top: Option<bool>,
    pub default_provider: Option<ProviderId>,
    pub xai_model: Option<String>,
    pub xai_image_model: Option<String>,
    pub xai_video_model: Option<String>,
    pub xai_tts_model: Option<String>,
    pub xai_realtime_model: Option<String>,
    pub xai_voice_name: Option<String>,
    pub hands_tunnel_provider: Option<String>,
    pub hands_tunnel_executable: Option<String>,
    pub hands_relay_url: Option<String>,
    pub hands_relay_machine_id: Option<String>,
    pub hands_relay_desktop_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub pinned: bool,
    pub preview_text: Option<String>,
    pub provider_id: Option<ProviderId>,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub pinned: bool,
    pub preview_text: Option<String>,
    pub provider_id: Option<ProviderId>,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub provider_id: Option<ProviderId>,
    pub model_id: Option<String>,
    pub error: Option<String>,
    pub usage: Option<TokenUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDetail {
    pub conversation: Conversation,
    pub messages: Vec<Message>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewConversation {
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamHandle {
    pub stream_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub conversation_id: String,
    pub provider_id: ProviderId,
    pub model_id: String,
    pub user_text: String,
    pub selected_workspace_items: Vec<String>,
    pub temperature: Option<f32>,
    pub max_output_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatRequest {
    pub conversation_id: String,
    pub provider_id: ProviderId,
    pub model_id: String,
    pub user_text: String,
    pub selected_workspace_items: Vec<String>,
    pub temperature: Option<f32>,
    pub max_output_tokens: Option<u32>,
    pub max_iterations: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub stream_id: String,
    pub kind: String,
    pub text_delta: Option<String>,
    pub message_id: String,
    pub usage: Option<TokenUsage>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWorkspace {
    pub name: Option<String>,
    pub roots: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub roots: Vec<String>,
    pub item_count: usize,
    pub created_at: String,
    pub last_scanned_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceItem {
    pub id: String,
    pub workspace_id: String,
    pub path: String,
    pub mime_hint: Option<String>,
    pub language_hint: Option<String>,
    pub byte_size: u64,
    pub chunk_count: usize,
    pub last_indexed_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMediaFile {
    pub path: String,
    pub kind: String,
    pub mime_type: Option<String>,
    pub file_name: String,
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceScanSummary {
    pub workspace_id: String,
    pub scanned_files: usize,
    pub indexed_items: usize,
    pub skipped_files: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceScanEvent {
    pub workspace_id: String,
    pub phase: String,
    pub scanned_files: usize,
    pub indexed_items: usize,
    pub message: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiErrorEvent {
    pub scope: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameConversation {
    pub conversation_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalHandle {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEvent {
    pub session_id: String,
    pub kind: String,
    pub chunk: Option<String>,
    pub stream: Option<String>,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMediaCategory {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMediaAssetRequest {
    pub category_id: Option<String>,
    pub prompt: Option<String>,
    pub preserve_category: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCategory {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub item_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub id: String,
    pub category_id: Option<String>,
    pub kind: String,
    pub model_id: String,
    pub prompt: String,
    pub file_path: String,
    pub source_url: Option<String>,
    pub mime_type: Option<String>,
    pub status: String,
    pub request_id: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageRequest {
    pub prompt: String,
    pub model_id: String,
    pub category_id: Option<String>,
    pub aspect_ratio: Option<String>,
    pub resolution: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateVideoRequest {
    pub prompt: String,
    pub model_id: String,
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextToSpeechRequest {
    pub input: String,
    pub model_id: Option<String>,
    pub category_id: Option<String>,
    pub voice: Option<String>,
    pub response_format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportLocalMediaRequest {
    pub file_path: String,
    pub category_id: Option<String>,
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorTimelineClip {
    pub asset_id: String,
    pub kind: String,
    pub file_path: String,
    pub trim_start: Option<f64>,
    pub trim_end: Option<f64>,
    pub still_duration: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportEditorTimelineRequest {
    pub title: Option<String>,
    pub category_id: Option<String>,
    pub clips: Vec<EditorTimelineClip>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeSessionRequest {
    pub model_id: Option<String>,
    pub voice: Option<String>,
    pub instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeSession {
    pub client_secret: String,
    pub expires_at: Option<String>,
    pub websocket_url: String,
    pub model_id: Option<String>,
    pub voice: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandsConnection {
    pub id: String,
    pub label: String,
    pub connected_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandsActivityItem {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub created_at: String,
    pub source: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandsGeneratedAsset {
    pub id: String,
    pub kind: String,
    pub prompt: String,
    pub file_path: String,
    pub file_name: String,
    pub mime_type: Option<String>,
    pub created_at: String,
    pub source_url: Option<String>,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandsStatus {
    pub state: String,
    pub tunnel_provider: Option<String>,
    pub tunnel_executable: Option<String>,
    pub local_url: Option<String>,
    pub public_url: Option<String>,
    pub pairing_code: Option<String>,
    pub workspace_dir: String,
    pub tunnel_status: String,
    pub last_error: Option<String>,
    pub last_activity_at: Option<String>,
    pub connections: Vec<HandsConnection>,
    pub activity: Vec<HandsActivityItem>,
    pub assets: Vec<HandsGeneratedAsset>,
}
