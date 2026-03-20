import { render, screen } from "@testing-library/react";
import App from "./App";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
  }),
}));

vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    write = vi.fn();
    reset = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("./store/appStore", () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      initialize: vi.fn(),
      booting: false,
      error: undefined,
      clearError: vi.fn(),
      settingsOpen: false,
      toggleSettings: vi.fn(),
      settings: {
        hotkey: "CommandOrControl+Shift+Space",
        alwaysOnTop: false,
        defaultProvider: "xai",
        xaiModel: "grok-code-fast-1",
        xaiImageModel: "grok-imagine-image",
        xaiVideoModel: "grok-imagine-video",
        xaiTtsModel: "xai-tts",
        xaiRealtimeModel: "grok-realtime",
        xaiVoiceName: "eve",
        handsTunnelProvider: "cloudflare",
        handsTunnelExecutable: "cloudflared",
      },
      selectedProvider: "xai",
      selectedModel: "grok-code-fast-1",
      models: {
        xai: [{ modelId: "grok-code-fast-1", label: "grok-code-fast-1" }],
      },
      providerStatuses: [{ providerId: "xai", configured: false, available: false, error: null }],
      createConversation: vi.fn(),
      conversations: [],
      activeConversation: undefined,
      loadConversation: vi.fn(),
      renameConversation: vi.fn(),
      toggleConversationPin: vi.fn(),
      deleteConversation: vi.fn(),
      composer: "",
      sending: false,
      activeWorkspaceId: undefined,
      workspaceItems: {},
      workspaceSelection: {},
      setComposer: vi.fn(),
      sendMessage: vi.fn(),
      stopStream: vi.fn(),
      workspaces: [],
      scanningWorkspaceId: undefined,
      createWorkspaceFromFolder: vi.fn(),
      createWorkspaceFromFiles: vi.fn(),
      replaceWorkspaceFromFolder: vi.fn(),
      replaceWorkspaceFromFiles: vi.fn(),
      deleteWorkspace: vi.fn(),
      selectWorkspace: vi.fn(),
      scanWorkspace: vi.fn(),
      toggleWorkspaceItem: vi.fn(),
      selectModel: vi.fn(),
      saveSettings: vi.fn(),
      saveApiKey: vi.fn(),
      deleteApiKey: vi.fn(),
      mediaCategories: [],
      mediaAssets: [],
      selectedMediaCategoryId: undefined,
      handsStatus: {
        state: "stopped",
        tunnelProvider: "cloudflare",
        tunnelExecutable: "cloudflared",
        localUrl: undefined,
        publicUrl: undefined,
        pairingCode: undefined,
        workspaceDir: "/tmp/hands-workspace",
        tunnelStatus: "Hands bridge is offline.",
        lastError: undefined,
        lastActivityAt: undefined,
        connections: [],
        activity: [],
        assets: [],
      },
      handsBusy: false,
      generatingImage: false,
      generatingVideo: false,
      generatingSpeech: false,
      exportingEditor: false,
      creatingRealtimeSession: false,
      realtimeSession: undefined,
      refreshProviderStatus: vi.fn(),
      refreshModels: vi.fn(),
      refreshMediaCategories: vi.fn(),
      refreshMediaAssets: vi.fn(),
      refreshHandsStatus: vi.fn(),
      startHandsService: vi.fn(),
      stopHandsService: vi.fn(),
      createMediaCategory: vi.fn(),
      moveMediaAssetToCategory: vi.fn(),
      renameMediaAsset: vi.fn(),
      deleteMediaAsset: vi.fn(),
      exportEditorTimeline: vi.fn(),
      selectMediaCategory: vi.fn(),
      generateImage: vi.fn(),
      generateVideo: vi.fn(),
      generateSpeech: vi.fn(),
      createRealtimeSession: vi.fn(),
      clearRealtimeSession: vi.fn(),
      terminalOutput: "",
      terminalSessionId: "test-session",
      terminalReady: true,
      browserUrl: "http://localhost:3000",
      browserDraftUrl: "http://localhost:3000",
      browserPreviewHtml: undefined,
      detectedServerUrl: undefined,
      interruptTerminal: vi.fn(),
      clearTerminalOutput: vi.fn(),
      writeTerminalData: vi.fn(),
      resizeTerminal: vi.fn(),
      setBrowserDraftUrl: vi.fn(),
      openBrowserUrl: vi.fn(),
      openBrowserPreview: vi.fn(),
    }),
}));

describe("App", () => {
  it("renders the shell without entering a render loop", () => {
    render(<App />);

    expect(screen.getByText("Chats")).toBeInTheDocument();
    expect(screen.getByText("CHAT")).toBeInTheDocument();
    expect(screen.getByText("Browser")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open settings" })).toBeInTheDocument();
  });
});
