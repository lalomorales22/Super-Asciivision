export type ProviderId = "xai" | "ollama";

export interface ProviderStatus {
  providerId: ProviderId;
  configured: boolean;
  available: boolean;
  error?: string | null;
}

export interface ModelDescriptor {
  providerId: ProviderId;
  modelId: string;
  label: string;
  supportsStreaming: boolean;
  supportsWorkspaceContext: boolean;
}

export interface Settings {
  hotkey: string;
  alwaysOnTop: boolean;
  defaultProvider: ProviderId;
  xaiModel?: string | null;
  xaiImageModel?: string | null;
  xaiVideoModel?: string | null;
  xaiTtsModel?: string | null;
  xaiRealtimeModel?: string | null;
  xaiVoiceName?: string | null;
  handsTunnelProvider?: string | null;
  handsTunnelExecutable?: string | null;
  handsRelayUrl?: string | null;
  handsRelayMachineId?: string | null;
  handsRelayDesktopToken?: string | null;
}

export interface SettingsPatch {
  hotkey?: string;
  alwaysOnTop?: boolean;
  defaultProvider?: ProviderId;
  xaiModel?: string;
  xaiImageModel?: string;
  xaiVideoModel?: string;
  xaiTtsModel?: string;
  xaiRealtimeModel?: string;
  xaiVoiceName?: string;
  handsTunnelProvider?: string;
  handsTunnelExecutable?: string;
  handsRelayUrl?: string;
  handsRelayMachineId?: string;
  handsRelayDesktopToken?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  previewText?: string | null;
  providerId?: ProviderId | null;
  modelId?: string | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  pinned: boolean;
  previewText?: string | null;
  providerId?: ProviderId | null;
  modelId?: string | null;
}

export interface TokenUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface Message {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  providerId?: ProviderId | null;
  modelId?: string | null;
  error?: string | null;
  usage?: TokenUsage | null;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
}

export interface NewConversation {
  title?: string;
}

export interface NewWorkspace {
  name?: string;
  roots: string[];
}

export interface UpdateWorkspaceRequest {
  name?: string;
  roots: string[];
}

export interface Workspace {
  id: string;
  name: string;
  roots: string[];
  itemCount: number;
  createdAt: string;
  lastScannedAt?: string | null;
}

export interface WorkspaceItem {
  id: string;
  workspaceId: string;
  path: string;
  mimeHint?: string | null;
  languageHint?: string | null;
  byteSize: number;
  chunkCount: number;
  lastIndexedAt: string;
}

export interface WorkspaceMediaFile {
  path: string;
  kind: "image" | "video" | "audio";
  mimeType?: string | null;
  fileName: string;
  fileSize: number;
}

export interface WorkspaceScanSummary {
  workspaceId: string;
  scannedFiles: number;
  indexedItems: number;
  skippedFiles: number;
  totalBytes: number;
}

export interface WorkspaceScanEvent {
  workspaceId: string;
  phase: string;
  scannedFiles: number;
  indexedItems: number;
  message?: string | null;
}

export interface UiErrorEvent {
  scope: string;
  message: string;
}

export interface StreamHandle {
  streamId: string;
  messageId: string;
}

export interface StreamEvent {
  streamId: string;
  kind: "started" | "delta" | "completed" | "cancelled" | "error";
  textDelta?: string | null;
  messageId: string;
  usage?: TokenUsage | null;
  error?: string | null;
}

export interface ChatRequest {
  conversationId: string;
  providerId: ProviderId;
  modelId: string;
  userText: string;
  selectedWorkspaceItems: string[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface TerminalHandle {
  sessionId: string;
}

export interface TerminalEvent {
  sessionId: string;
  kind: "output" | "exit";
  chunk?: string | null;
  stream?: "stdout" | "stderr" | null;
  exitCode?: number | null;
}

export interface NewMediaCategory {
  name: string;
  kind?: string | null;
}

export interface MediaCategory {
  id: string;
  name: string;
  kind?: string | null;
  createdAt: string;
  itemCount: number;
}

export interface MediaAsset {
  id: string;
  categoryId?: string | null;
  kind: "image" | "video" | "audio";
  modelId: string;
  prompt: string;
  filePath: string;
  sourceUrl?: string | null;
  mimeType?: string | null;
  status: string;
  requestId?: string | null;
  metadataJson?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateMediaAssetRequest {
  categoryId?: string | null;
  prompt?: string | null;
  preserveCategory?: boolean;
}

export interface GenerateImageRequest {
  prompt: string;
  modelId: string;
  categoryId?: string | null;
  aspectRatio?: string | null;
  resolution?: string | null;
}

export interface GenerateVideoRequest {
  prompt: string;
  modelId: string;
  categoryId?: string | null;
}

export interface TextToSpeechRequest {
  input: string;
  modelId?: string | null;
  categoryId?: string | null;
  voice?: string | null;
  responseFormat?: string | null;
}

export interface ImportLocalMediaRequest {
  filePath: string;
  categoryId?: string | null;
  prompt?: string | null;
}

export interface RealtimeSessionRequest {
  modelId?: string | null;
  voice?: string | null;
  instructions?: string | null;
}

export interface RealtimeSession {
  clientSecret: string;
  expiresAt?: string | null;
  websocketUrl: string;
  modelId?: string | null;
  voice?: string | null;
  proxyPort?: number | null;
}

export interface HandsConnection {
  id: string;
  label: string;
  connectedAt: string;
  lastSeenAt: string;
}

export interface HandsActivityItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
  source: string;
  status: string;
}

export interface HandsGeneratedAsset {
  id: string;
  kind: "image" | "video" | "audio" | string;
  prompt: string;
  filePath: string;
  fileName: string;
  mimeType?: string | null;
  createdAt: string;
  sourceUrl?: string | null;
  downloadUrl: string;
}

export interface HandsStatus {
  state: string;
  tunnelProvider?: string | null;
  tunnelExecutable?: string | null;
  localUrl?: string | null;
  publicUrl?: string | null;
  pairingCode?: string | null;
  workspaceDir: string;
  tunnelStatus: string;
  lastError?: string | null;
  lastActivityAt?: string | null;
  connections: HandsConnection[];
  activity: HandsActivityItem[];
  assets: HandsGeneratedAsset[];
}

export interface EditorTimelineClip {
  assetId: string;
  kind: "image" | "video" | "audio";
  filePath: string;
  trimStart?: number | null;
  trimEnd?: number | null;
  stillDuration?: number | null;
}

export interface ExportEditorTimelineRequest {
  title?: string | null;
  categoryId?: string | null;
  clips: EditorTimelineClip[];
}

// ---------------------------------------------------------------------------
// Agent types
// ---------------------------------------------------------------------------

export interface AgentChatRequest {
  conversationId: string;
  providerId: ProviderId;
  modelId: string;
  userText: string;
  selectedWorkspaceItems: string[];
  temperature?: number;
  maxOutputTokens?: number;
  maxIterations?: number;
}

// ---------------------------------------------------------------------------
// Music player types
// ---------------------------------------------------------------------------

export interface MusicTrack {
  filePath: string;
  fileName: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  durationSecs?: number | null;
  coverArtDataUrl?: string | null;
}

export interface AgentEvent {
  streamId: string;
  kind: "thinking" | "tool_call" | "tool_result" | "text_delta" | "complete" | "error";
  toolName?: string | null;
  toolArgs?: string | null;
  toolResult?: string | null;
  toolSuccess?: boolean | null;
  textDelta?: string | null;
  messageId?: string | null;
  iterations?: number | null;
  error?: string | null;
}
