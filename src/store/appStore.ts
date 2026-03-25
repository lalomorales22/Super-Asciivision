import { create } from "zustand";
import { api, events } from "../lib/tauri";
import { useChatStore } from "./chatStore";
import { useHandsStore } from "./handsStore";
import { useMediaStore } from "./mediaStore";
import { useTerminalStore } from "./terminalStore";
import { useWorkspaceStore } from "./workspaceStore";
import type {
  AgentEvent,
  ModelDescriptor,
  ProviderId,
  ProviderStatus,
  Settings,
  StreamEvent,
  TerminalEvent,
  WorkspaceScanEvent,
} from "../types";

type ModelMap = Record<ProviderId, ModelDescriptor[]>;

interface AppState {
  initialized: boolean;
  listenersReady: boolean;
  booting: boolean;
  error?: string;
  info?: string;
  settingsOpen: boolean;
  providerStatuses: ProviderStatus[];
  models: ModelMap;
  settings?: Settings;
  selectedProvider: ProviderId;
  selectedModel?: string;
  initialize: () => Promise<void>;
  refreshProviderStatus: () => Promise<void>;
  refreshModels: () => Promise<void>;
  selectModel: (modelId: string) => void;
  setSelectedProvider: (provider: ProviderId) => void;
  toggleSettings: (value?: boolean) => void;
  saveSettings: (next: Partial<Settings>) => Promise<void>;
  saveApiKey: (provider: ProviderId, apiKey: string) => Promise<void>;
  deleteApiKey: (provider: ProviderId) => Promise<void>;
  clearError: () => void;
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

function pickModel(models: ModelMap, provider: ProviderId = "xai", ollamaDefault?: string) {
  if (provider === "ollama") {
    if (ollamaDefault && models.ollama.some((m) => m.modelId === ollamaDefault)) {
      return ollamaDefault;
    }
    return models.ollama[0]?.modelId ?? "qwen3.5:2b";
  }
  return models.xai[0]?.modelId ?? fallbackSettings.xaiModel ?? "grok-code-fast-1";
}


export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  listenersReady: false,
  booting: true,
  providerStatuses: [],
  models: emptyModels,
  selectedProvider: "xai",
  selectedModel: fallbackSettings.xaiModel ?? "grok-code-fast-1",
  settingsOpen: false,
  initialize: async () => {
    try {
      if (!get().listenersReady) {
        set({ listenersReady: true });
        await events.onStream((event: StreamEvent) => {
          useChatStore.getState().handleStreamEvent(event);
        });

        await events.onWorkspaceScan((event: WorkspaceScanEvent) => {
          if (event.phase === "started") {
            useWorkspaceStore.setState({ scanningWorkspaceId: event.workspaceId });
            set({ info: "Scanning workspace..." });
            return;
          }
          if (event.phase === "completed") {
            useWorkspaceStore.setState({ scanningWorkspaceId: undefined });
            set({ info: undefined });
            void useWorkspaceStore.getState().selectWorkspace(event.workspaceId);
          }
        });

        await events.onTerminal((event: TerminalEvent) => {
          useTerminalStore.getState().handleTerminalEvent(event);
        });

        await events.onError((event) => set({ error: event.message }));
        await events.onHands((handsStatus) => {
          useHandsStore.setState({ handsStatus, handsBusy: false });
          // Refresh media library so Hands-generated assets appear in Imagine
          void useMediaStore.getState().refreshMediaAssets();
          void useMediaStore.getState().refreshMediaCategories();
        });

        await events.onAgent((event: AgentEvent) => {
          useChatStore.getState().handleAgentEvent(event);
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
      if (workspaces.length) useWorkspaceStore.setState({ workspaces });
      const handsStatus = handsResult.status === "fulfilled" ? handsResult.value : undefined;
      if (handsStatus) useHandsStore.setState({ handsStatus });
      // Media categories and assets are loaded lazily when Imagine/Voice pages are first visited

      useChatStore.setState({ conversations });

      set({
        settings,
        providerStatuses,
        selectedProvider: "xai",
        selectedModel: settings.xaiModel ?? fallbackSettings.xaiModel ?? "grok-code-fast-1",
        initialized: true,
        booting: false,
      });

      document.documentElement.setAttribute("data-theme", settings.theme ?? "");

      await Promise.allSettled([get().refreshModels(), useTerminalStore.getState().startTerminal()]);

      const initialConversationId = conversations[0]?.id;
      if (initialConversationId) {
        void useChatStore.getState().loadConversation(initialConversationId);
      }

      const initialWorkspaceId = workspaces[0]?.id;
      if (initialWorkspaceId) {
        void useWorkspaceStore.getState().selectWorkspace(initialWorkspaceId);
      }
    } catch (error) {
      set({
        initialized: true,
        booting: false,
        error: error instanceof Error ? error.message : "Super ASCIIVision failed to initialize.",
      });
    }
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
      selectedModel: state.selectedModel ?? pickModel({ xai: xaiModels, ollama: ollamaModels }, state.selectedProvider, state.settings?.ollamaModel ?? undefined),
    }));
  },

  selectModel: (modelId) => set({ selectedModel: modelId }),

  setSelectedProvider: (provider) =>
    set((state) => ({
      selectedProvider: provider,
      selectedModel: pickModel(state.models, provider, state.settings?.ollamaModel ?? undefined),
    })),

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
      ollamaModel: next.ollamaModel ?? current.ollamaModel ?? "",
      theme: next.theme ?? current.theme ?? "",
    });

    document.documentElement.setAttribute("data-theme", settings.theme ?? "");

    set({
      settings,
      selectedProvider: "xai",
      selectedModel: settings.xaiModel ?? pickModel(get().models),
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

  clearError: () => set({ error: undefined }),
}));
