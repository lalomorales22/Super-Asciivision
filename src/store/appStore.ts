import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { api, events } from "../lib/tauri";
import type {
  AgentChatRequest,
  AgentEvent,
  ChatRequest,
  ConversationDetail,
  ConversationSummary,
  MediaAsset,
  MediaCategory,
  ModelDescriptor,
  MusicTrack,
  ExportEditorTimelineRequest,
  HandsStatus,
  ProviderId,
  ProviderStatus,
  RealtimeSession,
  Settings,
  StreamEvent,
  TerminalEvent,
  Workspace,
  WorkspaceItem,
  WorkspaceScanEvent,
} from "../types";

type ModelMap = Record<ProviderId, ModelDescriptor[]>;
type ItemMap = Record<string, WorkspaceItem[]>;
type SelectionMap = Record<string, boolean>;

interface AppState {
  initialized: boolean;
  listenersReady: boolean;
  booting: boolean;
  sending: boolean;
  generatingImage: boolean;
  generatingVideo: boolean;
  generatingSpeech: boolean;
  exportingEditor: boolean;
  creatingRealtimeSession: boolean;
  scanningWorkspaceId?: string;
  error?: string;
  info?: string;
  settingsOpen: boolean;
  providerStatuses: ProviderStatus[];
  models: ModelMap;
  settings?: Settings;
  selectedProvider: ProviderId;
  selectedModel?: string;
  conversations: ConversationSummary[];
  activeConversation?: ConversationDetail;
  workspaces: Workspace[];
  activeWorkspaceId?: string;
  workspaceItems: ItemMap;
  workspaceSelection: SelectionMap;
  composer: string;
  activeStreamId?: string;
  terminalSessionId?: string;
  terminalOutput: string;
  terminalReady: boolean;
  detectedServerUrl?: string;
  browserUrl: string;
  browserDraftUrl: string;
  browserPreviewHtml?: string;
  mediaCategories: MediaCategory[];
  mediaAssets: MediaAsset[];
  mediaLoaded: boolean;
  selectedMediaCategoryId?: string;
  handsStatus?: HandsStatus;
  handsBusy: boolean;
  realtimeSession?: RealtimeSession;
  agentMode: boolean;
  agentToolCalls: Array<{
    toolName: string;
    args: string;
    result?: string;
    success?: boolean;
    isRunning: boolean;
  }>;
  musicTracks: MusicTrack[];
  musicCurrentIndex: number;
  musicPlaying: boolean;
  musicShuffleEnabled: boolean;
  musicRepeatMode: "off" | "all" | "one";
  musicVolume: number;
  musicFolderPath?: string;
  tileSessionIds: string[];
  tileLayout: 2 | 4 | 9;
  setTileSessionIds: (ids: string[]) => void;
  setTileLayout: (layout: 2 | 4 | 9) => void;
  initialize: () => Promise<void>;
  refreshConversations: () => Promise<void>;
  refreshProviderStatus: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshMediaCategories: () => Promise<void>;
  refreshMediaAssets: (categoryId?: string) => Promise<void>;
  ensureMediaLoaded: () => Promise<void>;
  refreshHandsStatus: () => Promise<void>;
  startHandsService: () => Promise<void>;
  stopHandsService: () => Promise<void>;
  startTerminal: () => Promise<void>;
  selectModel: (modelId: string) => void;
  setSelectedProvider: (provider: ProviderId) => void;
  setComposer: (value: string) => void;
  loadConversation: (conversationId: string) => Promise<void>;
  createConversation: () => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  toggleConversationPin: (conversationId: string, pinned: boolean) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  sendMessage: () => Promise<void>;
  sendAgentMessage: () => Promise<void>;
  toggleAgentMode: () => void;
  stopStream: () => Promise<void>;
  toggleSettings: (value?: boolean) => void;
  saveSettings: (next: Partial<Settings>) => Promise<void>;
  saveApiKey: (provider: ProviderId, apiKey: string) => Promise<void>;
  deleteApiKey: (provider: ProviderId) => Promise<void>;
  createWorkspaceFromFolder: () => Promise<void>;
  createWorkspaceFromFiles: () => Promise<void>;
  replaceWorkspaceFromFolder: (workspaceId: string) => Promise<void>;
  replaceWorkspaceFromFiles: (workspaceId: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  scanWorkspace: (workspaceId: string) => Promise<void>;
  toggleWorkspaceItem: (itemId: string) => void;
  writeTerminalData: (value: string) => Promise<void>;
  interruptTerminal: () => Promise<void>;
  clearTerminalOutput: () => void;
  resizeTerminal: (cols: number, rows: number) => Promise<void>;
  setBrowserDraftUrl: (value: string) => void;
  openBrowserUrl: (value?: string) => void;
  openBrowserPreview: (html: string) => void;
  createMediaCategory: (name: string) => Promise<void>;
  importLocalMediaAsset: (filePath: string, categoryId?: string, prompt?: string) => Promise<MediaAsset | undefined>;
  moveMediaAssetToCategory: (assetId: string, categoryId?: string) => Promise<void>;
  renameMediaAsset: (assetId: string, prompt: string) => Promise<void>;
  deleteMediaAsset: (assetId: string) => Promise<void>;
  exportEditorTimeline: (input: ExportEditorTimelineRequest) => Promise<void>;
  selectMediaCategory: (categoryId?: string) => Promise<void>;
  generateImage: (prompt: string, modelId: string, aspectRatio?: string, resolution?: string, categoryId?: string) => Promise<void>;
  generateVideo: (prompt: string, modelId: string, categoryId?: string) => Promise<void>;
  generateSpeech: (
    input: string,
    modelId?: string,
    voice?: string,
    responseFormat?: string,
    categoryId?: string,
  ) => Promise<void>;
  createRealtimeSession: (modelId?: string, voice?: string, instructions?: string) => Promise<void>;
  clearRealtimeSession: () => void;
  clearError: () => void;
  refreshMusicLibrary: (folderPath?: string) => Promise<void>;
  setMusicPlaying: (playing: boolean) => void;
  setMusicCurrentIndex: (index: number) => void;
  setMusicShuffle: (enabled: boolean) => void;
  setMusicRepeatMode: (mode: "off" | "all" | "one") => void;
  setMusicVolume: (volume: number) => void;
  musicNext: () => void;
  musicPrevious: () => void;
  setMusicFolder: (path: string) => Promise<void>;
}

const emptyModels: ModelMap = {
  xai: [],
  ollama: [],
};

const fallbackSettings: Settings = {
  hotkey: "CommandOrControl+Shift+Space",
  alwaysOnTop: false,
  defaultProvider: "xai",
  xaiModel: "grok-code-fast-1",
  xaiImageModel: "grok-imagine-image",
  xaiVideoModel: "grok-imagine-video",
  xaiTtsModel: "xai-tts",
  xaiRealtimeModel: "grok-realtime",
  xaiVoiceName: "eve",
  handsTunnelProvider: "relay",
  handsTunnelExecutable: "",
  handsRelayUrl: "",
  handsRelayMachineId: "",
  handsRelayDesktopToken: "",
};

function pickModel(models: ModelMap, provider: ProviderId = "xai") {
  if (provider === "ollama") {
    return models.ollama[0]?.modelId ?? "qwen3.5:2b";
  }
  return models.xai[0]?.modelId ?? fallbackSettings.xaiModel ?? "grok-code-fast-1";
}

function summarizeTitle(input: string) {
  return input.trim().slice(0, 36) || "New chat";
}

function detectServerUrl(value: string) {
  const match = value.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s]*)?/i);
  return match?.[0];
}

function normalizeBrowserUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "http://localhost:3000";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

function appendTerminalOutput(existing: string, nextChunk: string) {
  const combined = `${existing}${nextChunk}`;
  return combined.length > 120_000 ? combined.slice(-120_000) : combined;
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  listenersReady: false,
  booting: true,
  sending: false,
  generatingImage: false,
  generatingVideo: false,
  generatingSpeech: false,
  exportingEditor: false,
  creatingRealtimeSession: false,
  providerStatuses: [],
  models: emptyModels,
  selectedProvider: "xai",
  selectedModel: fallbackSettings.xaiModel ?? "grok-code-fast-1",
  conversations: [],
  workspaces: [],
  workspaceItems: {},
  workspaceSelection: {},
  composer: "",
  settingsOpen: false,
  terminalOutput: "",
  terminalReady: false,
  browserUrl: "http://localhost:3000",
  browserDraftUrl: "http://localhost:3000",
  mediaCategories: [],
  mediaAssets: [],
  mediaLoaded: false,
  handsBusy: false,
  agentMode: false,
  agentToolCalls: [],
  musicTracks: [],
  musicCurrentIndex: -1,
  musicPlaying: false,
  musicShuffleEnabled: false,
  musicRepeatMode: "off",
  musicVolume: 0.8,
  tileSessionIds: [],
  tileLayout: 4,
  setTileSessionIds: (ids) => set({ tileSessionIds: ids }),
  setTileLayout: (layout) => set({ tileLayout: layout }),

  initialize: async () => {
    try {
      if (!get().listenersReady) {
        set({ listenersReady: true });
        await events.onStream((event: StreamEvent) => {
          set((state) => {
            const detail = state.activeConversation;
            if (!detail) {
              return {
                sending:
                  event.kind === "started" || event.kind === "delta"
                    ? true
                    : event.kind === "completed" || event.kind === "cancelled" || event.kind === "error"
                      ? false
                      : state.sending,
                activeStreamId:
                  event.kind === "completed" || event.kind === "cancelled" || event.kind === "error"
                    ? undefined
                    : state.activeStreamId,
              };
            }

            const messages = detail.messages.map((message) => {
              if (message.id !== event.messageId) {
                return message;
              }
              if (event.kind === "delta") {
                return {
                  ...message,
                  content: `${message.content}${event.textDelta ?? ""}`,
                  status: "streaming",
                };
              }
              if (event.kind === "completed") {
                return { ...message, status: "complete", usage: event.usage ?? undefined };
              }
              if (event.kind === "cancelled") {
                return { ...message, status: "cancelled" };
              }
              if (event.kind === "error") {
                return { ...message, status: "error", error: event.error };
              }
              return message;
            });

            return {
              activeConversation: { ...detail, messages },
              sending:
                event.kind === "started" || event.kind === "delta"
                  ? true
                  : event.kind === "completed" || event.kind === "cancelled" || event.kind === "error"
                    ? false
                    : state.sending,
              activeStreamId:
                event.kind === "completed" || event.kind === "cancelled" || event.kind === "error"
                  ? undefined
                  : state.activeStreamId,
              error: event.kind === "error" ? event.error ?? "Streaming failed." : state.error,
            };
          });
        });

        await events.onWorkspaceScan((event: WorkspaceScanEvent) => {
          if (event.phase === "started") {
            set({ scanningWorkspaceId: event.workspaceId, info: "Scanning workspace..." });
            return;
          }
          if (event.phase === "completed") {
            set({ scanningWorkspaceId: undefined, info: undefined });
            void get().selectWorkspace(event.workspaceId);
          }
        });

        await events.onTerminal((event: TerminalEvent) => {
          // Strict allowlist: only process events from the footer terminal.
          // Any other PTY session (ASCIIVision overlay, Tiles terminals) is
          // ignored.  When terminalSessionId is not yet set (footer terminal
          // hasn't started), we skip everything — no events can leak in.
          const footerSessionId = get().terminalSessionId;
          if (event.sessionId !== footerSessionId) {
            return;
          }

          if (event.kind === "output") {
            set((state) => {
              const rawChunk = event.chunk ?? "";
              const detectedServerUrl = detectServerUrl(rawChunk) ?? state.detectedServerUrl;
              return {
                terminalOutput: appendTerminalOutput(state.terminalOutput, rawChunk),
                terminalReady: true,
                detectedServerUrl,
                browserUrl:
                  detectedServerUrl && state.browserUrl === "http://localhost:3000"
                    ? detectedServerUrl
                    : state.browserUrl,
                browserDraftUrl:
                  detectedServerUrl && state.browserDraftUrl === "http://localhost:3000"
                    ? detectedServerUrl
                    : state.browserDraftUrl,
              };
            });
            return;
          }

          set((state) => ({
            terminalReady: false,
            terminalOutput: appendTerminalOutput(
              state.terminalOutput,
              `\n[terminal exited${event.exitCode != null ? `: ${event.exitCode}` : ""}]\n`,
            ),
          }));
        });

        await events.onError((event) => set({ error: event.message }));
        await events.onHands((handsStatus) => {
          set({ handsStatus, handsBusy: false });
          // Refresh media library so Hands-generated assets appear in Imagine
          void get().refreshMediaAssets();
          void get().refreshMediaCategories();
        });

        await events.onAgent((event: AgentEvent) => {
          set((state) => {
            const detail = state.activeConversation;

            if (event.kind === "tool_call") {
              return {
                agentToolCalls: [
                  ...state.agentToolCalls,
                  {
                    toolName: event.toolName ?? "unknown",
                    args: event.toolArgs ?? "{}",
                    isRunning: true,
                  },
                ],
              };
            }

            if (event.kind === "tool_result") {
              const calls = [...state.agentToolCalls];
              let lastRunning = -1;
              for (let i = calls.length - 1; i >= 0; i--) {
                if (calls[i].isRunning) { lastRunning = i; break; }
              }
              if (lastRunning >= 0) {
                calls[lastRunning] = {
                  ...calls[lastRunning],
                  result: event.toolResult ?? "",
                  success: event.toolSuccess ?? false,
                  isRunning: false,
                };
              }
              return { agentToolCalls: calls };
            }

            if (event.kind === "text_delta" && detail) {
              const messageId = event.messageId;
              if (!messageId) return {};
              const messages = detail.messages.map((msg) => {
                if (msg.id !== messageId) return msg;
                return {
                  ...msg,
                  content: `${msg.content}${event.textDelta ?? ""}`,
                  status: "streaming",
                };
              });
              return { activeConversation: { ...detail, messages } };
            }

            if (event.kind === "complete") {
              return {
                sending: false,
                activeStreamId: undefined,
              };
            }

            if (event.kind === "error") {
              return {
                sending: false,
                activeStreamId: undefined,
                error: event.error ?? "Agent execution failed.",
              };
            }

            return {};
          });
        });

        set({ listenersReady: true });
      }

      const [
        settingsResult,
        statusResult,
        conversationsResult,
        workspacesResult,
        handsResult,
      ] = await Promise.allSettled([
        api.getSettings(),
        api.getProviderStatus(),
        api.listConversations(),
        api.listWorkspaces(),
        api.getHandsStatus(),
      ]);

      const settings = settingsResult.status === "fulfilled" ? settingsResult.value : fallbackSettings;
      const providerStatuses = statusResult.status === "fulfilled" ? statusResult.value : [];
      const conversations = conversationsResult.status === "fulfilled" ? conversationsResult.value : [];
      const workspaces = workspacesResult.status === "fulfilled" ? workspacesResult.value : [];
      const handsStatus = handsResult.status === "fulfilled" ? handsResult.value : undefined;
      // Media categories and assets are loaded lazily when Imagine/Voice pages are first visited

      set({
        settings,
        providerStatuses,
        conversations,
        workspaces,
        mediaCategories: [],
        mediaAssets: [],
        handsStatus,
        selectedProvider: "xai",
        selectedModel: settings.xaiModel ?? fallbackSettings.xaiModel ?? "grok-code-fast-1",
        initialized: true,
        booting: false,
      });

      await Promise.allSettled([get().refreshModels(), get().startTerminal()]);

      const initialConversationId = conversations[0]?.id;
      if (initialConversationId) {
        void get().loadConversation(initialConversationId);
      }

      const initialWorkspaceId = workspaces[0]?.id;
      if (initialWorkspaceId) {
        void get().selectWorkspace(initialWorkspaceId);
      }
    } catch (error) {
      set({
        initialized: true,
        booting: false,
        error: error instanceof Error ? error.message : "Super ASCIIVision failed to initialize.",
      });
    }
  },

  refreshConversations: async () => {
    const conversations = await api.listConversations();
    set({ conversations });
  },

  refreshProviderStatus: async () => {
    const providerStatuses = await api.getProviderStatus();
    set({ providerStatuses });
  },

  refreshModels: async () => {
    const [xaiResult, ollamaResult] = await Promise.allSettled([
      api.listModels("xai"),
      api.listOllamaModels(),
    ]);
    const xaiModels = xaiResult.status === "fulfilled" ? xaiResult.value.filter((m) => m.providerId === "xai") : [];
    const ollamaModels = ollamaResult.status === "fulfilled" ? ollamaResult.value.filter((m) => m.providerId === "ollama") : [];
    set((state) => ({
      models: { xai: xaiModels, ollama: ollamaModels },
      selectedModel: state.selectedModel ?? pickModel({ xai: xaiModels, ollama: ollamaModels }, state.selectedProvider),
    }));
  },

  refreshMediaCategories: async () => {
    const mediaCategories = await api.listMediaCategories();
    set({ mediaCategories });
  },

  refreshMediaAssets: async (categoryId) => {
    const mediaAssets = await api.listMediaAssets(categoryId);
    set({ mediaAssets, selectedMediaCategoryId: categoryId });
  },

  ensureMediaLoaded: async () => {
    if (get().mediaLoaded) return;
    const [categories, assets] = await Promise.all([
      api.listMediaCategories(),
      api.listMediaAssets(),
    ]);
    set({ mediaCategories: categories, mediaAssets: assets, mediaLoaded: true });
  },

  refreshHandsStatus: async () => {
    const handsStatus = await api.getHandsStatus();
    set({ handsStatus });
  },

  startHandsService: async () => {
    set({ handsBusy: true, error: undefined });
    try {
      const handsStatus = await api.startHandsService();
      set({ handsStatus, handsBusy: false });
    } catch (error) {
      set({
        handsBusy: false,
        error: error instanceof Error ? error.message : "Failed to start Hands.",
      });
    }
  },

  stopHandsService: async () => {
    set({ handsBusy: true, error: undefined });
    try {
      const handsStatus = await api.stopHandsService();
      set({ handsStatus, handsBusy: false });
    } catch (error) {
      set({
        handsBusy: false,
        error: error instanceof Error ? error.message : "Failed to stop Hands.",
      });
    }
  },

  startTerminal: async () => {
    if (get().terminalSessionId && get().terminalReady) {
      return;
    }
    const handle = await api.startTerminal();
    set({
      terminalSessionId: handle.sessionId,
      terminalReady: true,
    });
  },

  selectModel: (modelId) => set({ selectedModel: modelId }),

  setSelectedProvider: (provider) =>
    set((state) => ({
      selectedProvider: provider,
      selectedModel: pickModel(state.models, provider),
    })),

  setComposer: (value) => set({ composer: value }),

  loadConversation: async (conversationId) => {
    const detail = await api.loadConversation(conversationId);
    set({ activeConversation: detail });
  },

  createConversation: async () => {
    const conversation = await api.createConversation({ title: "New chat" });
    await get().refreshConversations();
    await get().loadConversation(conversation.id);
  },

  renameConversation: async (conversationId, title) => {
    await api.renameConversation(conversationId, title);
    await get().refreshConversations();
    if (get().activeConversation?.conversation.id === conversationId) {
      await get().loadConversation(conversationId);
    }
  },

  toggleConversationPin: async (conversationId, pinned) => {
    await api.setConversationPinned(conversationId, pinned);
    await get().refreshConversations();
    if (get().activeConversation?.conversation.id === conversationId) {
      await get().loadConversation(conversationId);
    }
  },

  deleteConversation: async (conversationId) => {
    await api.deleteConversation(conversationId);
    await get().refreshConversations();
    if (get().activeConversation?.conversation.id === conversationId) {
      set({ activeConversation: undefined });
      const nextConversation = get().conversations[0];
      if (nextConversation) {
        await get().loadConversation(nextConversation.id);
      }
    }
  },

  sendMessage: async () => {
    const state = get();
    const userText = state.composer.trim();
    if (!userText || state.sending) {
      return;
    }

    let conversationId = state.activeConversation?.conversation.id;
    if (!conversationId) {
      const conversation = await api.createConversation({ title: summarizeTitle(userText) });
      conversationId = conversation.id;
      await get().refreshConversations();
    }

    const provider = state.selectedProvider;
    const modelId = state.selectedModel ?? pickModel(state.models, provider);
    if (!modelId) {
      set({ error: "No model is available." });
      return;
    }

    const request: ChatRequest = {
      conversationId,
      providerId: provider,
      modelId,
      userText,
      selectedWorkspaceItems: Object.entries(state.workspaceSelection)
        .filter(([, selected]) => selected)
        .map(([itemId]) => itemId),
      maxOutputTokens: 2048,
    };

    set({ sending: true, error: undefined, composer: "" });
    const handle = await api.sendMessage(request);
    await get().refreshConversations();
    await get().loadConversation(conversationId);
    set({ activeStreamId: handle.streamId });
  },

  sendAgentMessage: async () => {
    const state = get();
    const userText = state.composer.trim();
    if (!userText || state.sending) return;

    let conversationId = state.activeConversation?.conversation.id;
    if (!conversationId) {
      const conversation = await api.createConversation({ title: summarizeTitle(userText) });
      conversationId = conversation.id;
      await get().refreshConversations();
    }

    const provider = state.selectedProvider;
    const modelId = state.selectedModel ?? pickModel(state.models, provider);
    if (!modelId) {
      set({ error: "No model is available." });
      return;
    }

    const request: AgentChatRequest = {
      conversationId,
      providerId: provider,
      modelId,
      userText,
      selectedWorkspaceItems: Object.entries(state.workspaceSelection)
        .filter(([, selected]) => selected)
        .map(([itemId]) => itemId),
      maxOutputTokens: 4096,
      maxIterations: 25,
    };

    set({ sending: true, error: undefined, composer: "", agentToolCalls: [] });
    const handle = await api.sendAgentMessage(request);
    await get().refreshConversations();
    await get().loadConversation(conversationId);
    set({ activeStreamId: handle.streamId });
  },

  toggleAgentMode: () => set((state) => ({ agentMode: !state.agentMode })),

  stopStream: async () => {
    const streamId = get().activeStreamId;
    if (!streamId) {
      return;
    }
    await api.cancelStream(streamId);
    set({ sending: false, activeStreamId: undefined });
  },

  toggleSettings: (value) =>
    set((state) => ({ settingsOpen: typeof value === "boolean" ? value : !state.settingsOpen })),

  saveSettings: async (next) => {
    const current = get().settings ?? fallbackSettings;
    const settings = await api.updateSettings({
      hotkey: next.hotkey ?? current.hotkey,
      alwaysOnTop: next.alwaysOnTop ?? current.alwaysOnTop,
      defaultProvider: "xai",
      xaiModel: next.xaiModel ?? current.xaiModel ?? fallbackSettings.xaiModel ?? "",
      xaiImageModel: next.xaiImageModel ?? current.xaiImageModel ?? fallbackSettings.xaiImageModel ?? "",
      xaiVideoModel: next.xaiVideoModel ?? current.xaiVideoModel ?? fallbackSettings.xaiVideoModel ?? "",
      xaiTtsModel: next.xaiTtsModel ?? current.xaiTtsModel ?? fallbackSettings.xaiTtsModel ?? "",
      xaiRealtimeModel:
        next.xaiRealtimeModel ?? current.xaiRealtimeModel ?? fallbackSettings.xaiRealtimeModel ?? "",
      xaiVoiceName: next.xaiVoiceName ?? current.xaiVoiceName ?? fallbackSettings.xaiVoiceName ?? "",
      handsTunnelProvider:
        next.handsTunnelProvider ??
        current.handsTunnelProvider ??
        fallbackSettings.handsTunnelProvider ??
        "relay",
      handsTunnelExecutable:
        next.handsTunnelExecutable ??
        current.handsTunnelExecutable ??
        fallbackSettings.handsTunnelExecutable ??
        "",
      handsRelayUrl: next.handsRelayUrl ?? current.handsRelayUrl ?? fallbackSettings.handsRelayUrl ?? "",
      handsRelayMachineId:
        next.handsRelayMachineId ??
        current.handsRelayMachineId ??
        fallbackSettings.handsRelayMachineId ??
        "",
      handsRelayDesktopToken:
        next.handsRelayDesktopToken ??
        current.handsRelayDesktopToken ??
        fallbackSettings.handsRelayDesktopToken ??
        "",
    });

    set({
      settings,
      selectedProvider: "xai",
      selectedModel: settings.xaiModel ?? pickModel(get().models),
      settingsOpen: false,
    });
  },

  saveApiKey: async (provider, apiKey) => {
    await api.saveApiKey(provider, apiKey);
    await get().refreshProviderStatus();
    set({ info: `${provider} key saved.` });
  },

  deleteApiKey: async (provider) => {
    await api.deleteApiKey(provider);
    await get().refreshProviderStatus();
    set({ info: `${provider} key removed.` });
  },

  createWorkspaceFromFolder: async () => {
    const selection = await open({ directory: true, multiple: false });
    if (typeof selection !== "string") {
      return;
    }
    const workspace = await api.createWorkspace({ roots: [selection] });
    const workspaces = await api.listWorkspaces();
    set({ workspaces, activeWorkspaceId: workspace.id });
    await get().scanWorkspace(workspace.id);
  },

  createWorkspaceFromFiles: async () => {
    const selection = await open({ directory: false, multiple: true });
    const roots =
      typeof selection === "string"
        ? [selection]
        : Array.isArray(selection)
          ? selection.filter((value): value is string => typeof value === "string")
          : [];
    if (!roots.length) {
      return;
    }
    const workspace = await api.createWorkspace({ roots });
    const workspaces = await api.listWorkspaces();
    set({ workspaces, activeWorkspaceId: workspace.id });
    await get().scanWorkspace(workspace.id);
  },

  replaceWorkspaceFromFolder: async (workspaceId) => {
    const selection = await open({ directory: true, multiple: false });
    if (typeof selection !== "string") {
      return;
    }
    await api.updateWorkspace(workspaceId, { roots: [selection] });
    const workspaces = await api.listWorkspaces();
    set((state) => ({
      workspaces,
      activeWorkspaceId: workspaceId,
      workspaceItems: { ...state.workspaceItems, [workspaceId]: [] },
      workspaceSelection: Object.fromEntries(
        Object.entries(state.workspaceSelection).filter(([itemId]) => {
          const items = state.workspaceItems[workspaceId] ?? [];
          return !items.some((item) => item.id === itemId);
        }),
      ),
    }));
    await get().scanWorkspace(workspaceId);
  },

  replaceWorkspaceFromFiles: async (workspaceId) => {
    const selection = await open({ directory: false, multiple: true });
    const roots =
      typeof selection === "string"
        ? [selection]
        : Array.isArray(selection)
          ? selection.filter((value): value is string => typeof value === "string")
          : [];
    if (!roots.length) {
      return;
    }
    await api.updateWorkspace(workspaceId, { roots });
    const workspaces = await api.listWorkspaces();
    set((state) => ({
      workspaces,
      activeWorkspaceId: workspaceId,
      workspaceItems: { ...state.workspaceItems, [workspaceId]: [] },
      workspaceSelection: Object.fromEntries(
        Object.entries(state.workspaceSelection).filter(([itemId]) => {
          const items = state.workspaceItems[workspaceId] ?? [];
          return !items.some((item) => item.id === itemId);
        }),
      ),
    }));
    await get().scanWorkspace(workspaceId);
  },

  deleteWorkspace: async (workspaceId) => {
    await api.deleteWorkspace(workspaceId);
    const workspaces = await api.listWorkspaces();
    set((state) => {
      const nextWorkspaceItems = { ...state.workspaceItems };
      const removedItems = nextWorkspaceItems[workspaceId] ?? [];
      delete nextWorkspaceItems[workspaceId];
      return {
        workspaces,
        activeWorkspaceId:
          state.activeWorkspaceId === workspaceId ? workspaces[0]?.id : state.activeWorkspaceId,
        workspaceItems: nextWorkspaceItems,
        workspaceSelection: Object.fromEntries(
          Object.entries(state.workspaceSelection).filter(
            ([itemId]) => !removedItems.some((item) => item.id === itemId),
          ),
        ),
      };
    });
    const nextWorkspaceId = get().activeWorkspaceId;
    if (nextWorkspaceId) {
      await get().selectWorkspace(nextWorkspaceId);
    }
  },

  selectWorkspace: async (workspaceId) => {
    const items = await api.listWorkspaceItems(workspaceId);
    set((state) => ({
      activeWorkspaceId: workspaceId,
      workspaceItems: { ...state.workspaceItems, [workspaceId]: items },
      workspaceSelection: Object.fromEntries(
        items.map((item) => [item.id, state.workspaceSelection[item.id] ?? true]),
      ),
    }));
  },

  scanWorkspace: async (workspaceId) => {
    set({ scanningWorkspaceId: workspaceId });
    await api.scanWorkspace(workspaceId);
    const workspaces = await api.listWorkspaces();
    set({ workspaces });
    await get().selectWorkspace(workspaceId);
  },

  toggleWorkspaceItem: (itemId) =>
    set((state) => ({
      workspaceSelection: {
        ...state.workspaceSelection,
        [itemId]: !state.workspaceSelection[itemId],
      },
    })),

  writeTerminalData: async (value) => {
    const sessionId = get().terminalSessionId;
    if (!sessionId || !value) {
      return;
    }
    await api.writeTerminalInput(sessionId, value);
  },

  interruptTerminal: async () => {
    const sessionId = get().terminalSessionId;
    if (!sessionId) {
      return;
    }
    await api.writeTerminalInput(sessionId, "\u0003");
  },

  clearTerminalOutput: () => set({ terminalOutput: "" }),

  resizeTerminal: async (cols, rows) => {
    const sessionId = get().terminalSessionId;
    if (!sessionId || cols < 1 || rows < 1) {
      return;
    }
    await api.resizeTerminal(sessionId, cols, rows);
  },

  setBrowserDraftUrl: (value) => set({ browserDraftUrl: value }),

  openBrowserUrl: (value) => {
    const nextUrl = normalizeBrowserUrl(value ?? get().browserDraftUrl);
    set({ browserUrl: nextUrl, browserDraftUrl: nextUrl, browserPreviewHtml: undefined });
  },

  openBrowserPreview: (html) =>
    set({
      browserPreviewHtml: html,
      browserDraftUrl: "preview://assistant-snippet",
    }),

  createMediaCategory: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    try {
      const category = await api.createMediaCategory({ name: trimmed });
      await get().refreshMediaCategories();
      await get().refreshMediaAssets(category.id);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Category creation failed." });
    }
  },

  importLocalMediaAsset: async (filePath, categoryId, prompt) => {
    try {
      const asset = await api.importLocalMedia({
        filePath,
        categoryId: categoryId ?? null,
        prompt: prompt?.trim() || null,
      });
      await get().refreshMediaAssets();
      await get().refreshMediaCategories();
      return asset;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Local media import failed." });
      return undefined;
    }
  },

  moveMediaAssetToCategory: async (assetId, categoryId) => {
    await api.updateMediaAssetCategory(assetId, { categoryId: categoryId ?? null, preserveCategory: false });
    await get().refreshMediaAssets();
    await get().refreshMediaCategories();
  },

  renameMediaAsset: async (assetId, prompt) => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }
    await api.updateMediaAssetCategory(assetId, { prompt: trimmed, preserveCategory: true });
    await get().refreshMediaAssets();
    await get().refreshMediaCategories();
  },

  deleteMediaAsset: async (assetId) => {
    await api.deleteMediaAsset(assetId);
    await get().refreshMediaAssets();
    await get().refreshMediaCategories();
  },

  exportEditorTimeline: async (input) => {
    set({ exportingEditor: true, error: undefined });
    try {
      await api.exportEditorTimeline(input);
      await get().refreshMediaAssets();
      await get().refreshMediaCategories();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Editor export failed." });
    } finally {
      set({ exportingEditor: false });
    }
  },

  selectMediaCategory: async (categoryId) => {
    await get().refreshMediaAssets(categoryId);
  },

  generateImage: async (prompt, modelId, aspectRatio, resolution, categoryId) => {
    if (!prompt.trim()) {
      return;
    }
    set({ generatingImage: true, error: undefined });
    try {
      await api.generateImage({
        prompt: prompt.trim(),
        modelId,
        aspectRatio: aspectRatio?.trim() || undefined,
        resolution: resolution?.trim() || undefined,
        categoryId,
      });
      await get().refreshMediaAssets();
      await get().refreshMediaCategories();
      await get().refreshProviderStatus();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Image generation failed." });
    } finally {
      set({ generatingImage: false });
    }
  },

  generateVideo: async (prompt, modelId, categoryId) => {
    if (!prompt.trim()) {
      return;
    }
    set({ generatingVideo: true, error: undefined });
    try {
      await api.generateVideo({
        prompt: prompt.trim(),
        modelId,
        categoryId,
      });
      await get().refreshMediaAssets();
      await get().refreshMediaCategories();
      await get().refreshProviderStatus();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Video generation failed." });
    } finally {
      set({ generatingVideo: false });
    }
  },

  generateSpeech: async (input, modelId, voice, responseFormat, categoryId) => {
    if (!input.trim()) {
      return;
    }
    set({ generatingSpeech: true, error: undefined });
    try {
      await api.textToSpeech({
        input: input.trim(),
        modelId,
        voice,
        responseFormat,
        categoryId,
      });
      await get().refreshMediaAssets();
      await get().refreshMediaCategories();
      await get().refreshProviderStatus();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Speech generation failed." });
    } finally {
      set({ generatingSpeech: false });
    }
  },

  createRealtimeSession: async (modelId, voice, instructions) => {
    set({ creatingRealtimeSession: true, error: undefined });
    try {
      const realtimeSession = await api.createRealtimeSession({
        modelId,
        voice,
        instructions,
      });
      set({ realtimeSession });
      await get().refreshProviderStatus();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Realtime session creation failed." });
    } finally {
      set({ creatingRealtimeSession: false });
    }
  },

  clearRealtimeSession: () => set({ realtimeSession: undefined }),

  clearError: () => set({ error: undefined }),

  refreshMusicLibrary: async (folderPath?: string) => {
    try {
      const folder = folderPath ?? get().musicFolderPath;
      const tracks = await api.listMusicFiles(folder);
      set({ musicTracks: tracks, musicFolderPath: folder });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to load music library" });
    }
  },
  setMusicPlaying: (playing) => set({ musicPlaying: playing }),
  setMusicCurrentIndex: (index) => set({ musicCurrentIndex: index, musicPlaying: true }),
  setMusicShuffle: (enabled) => set({ musicShuffleEnabled: enabled }),
  setMusicRepeatMode: (mode) => set({ musicRepeatMode: mode }),
  setMusicVolume: (volume) => set({ musicVolume: volume }),
  musicNext: () =>
    set((state) => {
      const { musicTracks, musicCurrentIndex, musicShuffleEnabled, musicRepeatMode } = state;
      if (!musicTracks.length) return {};
      if (musicRepeatMode === "one") return { musicCurrentIndex, musicPlaying: true };
      if (musicShuffleEnabled) {
        const next = Math.floor(Math.random() * musicTracks.length);
        return { musicCurrentIndex: next, musicPlaying: true };
      }
      const next = musicCurrentIndex + 1;
      if (next >= musicTracks.length) {
        return musicRepeatMode === "all"
          ? { musicCurrentIndex: 0, musicPlaying: true }
          : { musicPlaying: false };
      }
      return { musicCurrentIndex: next, musicPlaying: true };
    }),
  musicPrevious: () =>
    set((state) => {
      const { musicTracks, musicCurrentIndex, musicShuffleEnabled } = state;
      if (!musicTracks.length) return {};
      if (musicShuffleEnabled) {
        const next = Math.floor(Math.random() * musicTracks.length);
        return { musicCurrentIndex: next, musicPlaying: true };
      }
      const prev = musicCurrentIndex - 1;
      return {
        musicCurrentIndex: prev < 0 ? musicTracks.length - 1 : prev,
        musicPlaying: true,
      };
    }),
  setMusicFolder: async (path) => {
    set({ musicFolderPath: path, musicCurrentIndex: -1, musicPlaying: false });
    await get().refreshMusicLibrary(path);
  },
}));
