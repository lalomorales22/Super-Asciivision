import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AgentChatRequest,
  AgentEvent,
  ChatRequest,
  Conversation,
  ConversationDetail,
  ConversationSummary,
  ExportEditorTimelineRequest,
  GenerateImageRequest,
  GenerateVideoRequest,
  HandsStatus,
  ImportLocalMediaRequest,
  MediaAsset,
  MediaCategory,
  ModelDescriptor,
  MusicTrack,
  NewConversation,
  NewMediaCategory,
  NewWorkspace,
  ProviderId,
  ProviderStatus,
  RealtimeSession,
  RealtimeSessionRequest,
  Settings,
  SettingsPatch,
  StreamEvent,
  StreamHandle,
  TerminalEvent,
  TerminalHandle,
  TextToSpeechRequest,
  UpdateMediaAssetRequest,
  UpdateWorkspaceRequest,
  UiErrorEvent,
  Workspace,
  WorkspaceMediaFile,
  WorkspaceItem,
  WorkspaceScanEvent,
  WorkspaceScanSummary,
} from "../types";

export const api = {
  saveApiKey: (provider: ProviderId, apiKey: string) =>
    invoke<void>("save_api_key", { provider, apiKey }),
  deleteApiKey: (provider: ProviderId) =>
    invoke<void>("delete_api_key", { provider }),
  getProviderStatus: () => invoke<ProviderStatus[]>("get_provider_status"),
  getHandsStatus: () => invoke<HandsStatus>("get_hands_status"),
  startHandsService: () => invoke<HandsStatus>("start_hands_service"),
  stopHandsService: () => invoke<HandsStatus>("stop_hands_service"),
  listModels: (provider?: ProviderId) =>
    invoke<ModelDescriptor[]>("list_models", { provider }),
  listOllamaModels: () =>
    invoke<ModelDescriptor[]>("list_models", { provider: "ollama" }),
  readMediaDataUrl: (filePath: string) =>
    invoke<string>("read_media_data_url", { filePath }),
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (input: SettingsPatch) =>
    invoke<Settings>("update_settings", { input }),
  createConversation: (input: NewConversation) =>
    invoke<Conversation>("create_conversation", { input }),
  listConversations: () => invoke<ConversationSummary[]>("list_conversations"),
  loadConversation: (conversationId: string) =>
    invoke<ConversationDetail>("load_conversation", { conversationId }),
  renameConversation: (conversationId: string, title: string) =>
    invoke<void>("rename_conversation", { input: { conversationId, title } }),
  setConversationPinned: (conversationId: string, pinned: boolean) =>
    invoke<void>("set_conversation_pinned", { conversationId, pinned }),
  deleteConversation: (conversationId: string) =>
    invoke<void>("delete_conversation", { conversationId }),
  sendMessage: (input: ChatRequest) =>
    invoke<StreamHandle>("send_message", { input }),
  cancelStream: (streamId: string) =>
    invoke<void>("cancel_stream", { streamId }),
  createWorkspace: (input: NewWorkspace) =>
    invoke<Workspace>("create_workspace", { input }),
  updateWorkspace: (workspaceId: string, input: UpdateWorkspaceRequest) =>
    invoke<Workspace>("update_workspace", { workspaceId, input }),
  listWorkspaces: () => invoke<Workspace[]>("list_workspaces"),
  deleteWorkspace: (workspaceId: string) =>
    invoke<void>("delete_workspace", { workspaceId }),
  scanWorkspace: (workspaceId: string) =>
    invoke<WorkspaceScanSummary>("scan_workspace_command", { workspaceId }),
  listWorkspaceItems: (workspaceId: string) =>
    invoke<WorkspaceItem[]>("list_workspace_items", { workspaceId }),
  readWorkspaceTextFile: (filePath: string) =>
    invoke<string>("read_workspace_text_file", { filePath }),
  writeWorkspaceTextFile: (filePath: string, content: string) =>
    invoke<void>("write_workspace_text_file", { filePath, content }),
  createWorkspaceTextFile: (filePath: string, content = "") =>
    invoke<void>("create_workspace_text_file", { filePath, content }),
  renameWorkspacePath: (path: string, newName: string) =>
    invoke<void>("rename_workspace_path", { path, newName }),
  deleteWorkspacePath: (path: string) =>
    invoke<void>("delete_workspace_path", { path }),
  listWorkspaceMedia: (workspaceId: string, kind?: "image" | "video" | "audio") =>
    invoke<WorkspaceMediaFile[]>("list_workspace_media", { workspaceId, kind }),
  createMediaCategory: (input: NewMediaCategory) =>
    invoke<MediaCategory>("create_media_category", { input }),
  listMediaCategories: () => invoke<MediaCategory[]>("list_media_categories"),
  listMediaAssets: (categoryId?: string) =>
    invoke<MediaAsset[]>("list_media_assets", { categoryId }),
  importLocalMedia: (input: ImportLocalMediaRequest) =>
    invoke<MediaAsset>("import_local_media_command", { input }),
  updateMediaAssetCategory: (assetId: string, input: UpdateMediaAssetRequest) =>
    invoke<MediaAsset>("update_media_asset_category", { assetId, input }),
  deleteMediaAsset: (assetId: string) =>
    invoke<void>("delete_media_asset", { assetId }),
  clearAllMedia: () =>
    invoke<void>("clear_all_media"),
  generateImage: (input: GenerateImageRequest) =>
    invoke<MediaAsset>("generate_image_command", { input }),
  generateVideo: (input: GenerateVideoRequest) =>
    invoke<MediaAsset>("generate_video_command", { input }),
  exportEditorTimeline: (input: ExportEditorTimelineRequest) =>
    invoke<MediaAsset>("export_editor_timeline_command", { input }),
  textToSpeech: (input: TextToSpeechRequest) =>
    invoke<MediaAsset>("text_to_speech_command", { input }),
  createRealtimeSession: (input: RealtimeSessionRequest) =>
    invoke<RealtimeSession>("create_realtime_session_command", { input }),
  sendAgentMessage: (input: AgentChatRequest) =>
    invoke<StreamHandle>("send_agent_message", { input }),
  startTerminal: () => invoke<TerminalHandle>("start_terminal"),
  createTerminal: () => invoke<TerminalHandle>("create_terminal"),
  launchAsciivision: (cols?: number, rows?: number) =>
    invoke<TerminalHandle>("launch_asciivision", { cols: cols ?? null, rows: rows ?? null }),
  writeTerminalInput: (sessionId: string, input: string) =>
    invoke<void>("write_terminal_input", { sessionId, input }),
  killTerminal: (sessionId: string) =>
    invoke<void>("kill_terminal", { sessionId }),
  resizeTerminal: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("resize_terminal_command", { sessionId, cols, rows }),
  getTerminalBuffer: (sessionId: string) =>
    invoke<string>("get_terminal_buffer", { sessionId }),
  listMusicFiles: (folderPath?: string) =>
    invoke<MusicTrack[]>("list_music_files", { folderPath }),
  getDefaultMusicFolder: () =>
    invoke<string>("get_default_music_folder"),
  revealMusicFolder: (folderPath: string) =>
    invoke<void>("reveal_music_folder", { folderPath }),
};

export const events = {
  onStream: (handler: (event: StreamEvent) => void) =>
    listen<StreamEvent>("chat://stream", ({ payload }) => handler(payload)),
  onWorkspaceScan: (handler: (event: WorkspaceScanEvent) => void) =>
    listen<WorkspaceScanEvent>("workspace://scan", ({ payload }) => handler(payload)),
  onTerminal: (handler: (event: TerminalEvent) => void) =>
    listen<TerminalEvent>("terminal://event", ({ payload }) => handler(payload)),
  onError: (handler: (event: UiErrorEvent) => void) =>
    listen<UiErrorEvent>("app://error", ({ payload }) => handler(payload)),
  onHands: (handler: (event: HandsStatus) => void) =>
    listen<HandsStatus>("hands://status", ({ payload }) => handler(payload)),
  onAgent: (handler: (event: AgentEvent) => void) =>
    listen<AgentEvent>("agent://event", ({ payload }) => handler(payload)),
};
