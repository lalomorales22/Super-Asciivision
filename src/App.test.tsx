import { render, screen } from "@testing-library/react";
import App from "./App";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

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

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("") } }));

function mockStoreSelector(state: Record<string, unknown>) {
  const hook = (selector: (s: Record<string, unknown>) => unknown) => selector(state);
  hook.getState = () => state;
  hook.setState = vi.fn();
  hook.subscribe = vi.fn();
  return hook;
}

vi.mock("./store/appStore", () => ({
  useAppStore: mockStoreSelector({
    initialize: vi.fn(),
    booting: false,
    error: undefined,
    clearError: vi.fn(),
    settingsOpen: false,
    toggleSettings: vi.fn(),
    settings: { hotkey: "", alwaysOnTop: false, defaultProvider: "xai", xaiModel: "grok-code-fast-1" },
    selectedProvider: "xai",
    selectedModel: "grok-code-fast-1",
    models: { xai: [{ modelId: "grok-code-fast-1", label: "grok-code-fast-1" }], ollama: [] },
    providerStatuses: [{ providerId: "xai", configured: false, available: false, error: null }],
    selectModel: vi.fn(),
    setSelectedProvider: vi.fn(),
    saveSettings: vi.fn(),
    saveApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
    refreshProviderStatus: vi.fn(),
    refreshModels: vi.fn(),
  }),
}));

vi.mock("./store/chatStore", () => ({
  useChatStore: mockStoreSelector({
    conversations: [],
    activeConversation: undefined,
    composer: "",
    sending: false,
    agentMode: false,
    agentToolCalls: [],
    setComposer: vi.fn(),
    sendMessage: vi.fn(),
    sendAgentMessage: vi.fn(),
    stopStream: vi.fn(),
    toggleAgentMode: vi.fn(),
    createConversation: vi.fn(),
    loadConversation: vi.fn(),
    renameConversation: vi.fn(),
    toggleConversationPin: vi.fn(),
    deleteConversation: vi.fn(),
  }),
}));

vi.mock("./store/workspaceStore", () => ({
  useWorkspaceStore: mockStoreSelector({
    workspaces: [],
    activeWorkspaceId: undefined,
    workspaceItems: {},
    workspaceSelection: {},
    scanningWorkspaceId: undefined,
    createWorkspaceFromFolder: vi.fn(),
    deleteWorkspace: vi.fn(),
    selectWorkspace: vi.fn(),
    scanWorkspace: vi.fn(),
    toggleWorkspaceItem: vi.fn(),
    addFilesToWorkspace: vi.fn(),
    removeWorkspaceFile: vi.fn(),
  }),
}));

vi.mock("./store/mediaStore", () => ({
  useMediaStore: mockStoreSelector({
    mediaCategories: [],
    mediaAssets: [],
    mediaLoaded: false,
    generatingImage: false,
    generatingVideo: false,
    generatingSpeech: false,
    exportingEditor: false,
    creatingRealtimeSession: false,
    realtimeSession: undefined,
    ensureMediaLoaded: vi.fn(),
    createMediaCategory: vi.fn(),
    renameMediaCategory: vi.fn(),
    deleteMediaCategory: vi.fn(),
    generateImage: vi.fn(),
    generateVideo: vi.fn(),
    importLocalMediaAsset: vi.fn(),
    moveMediaAssetToCategory: vi.fn(),
    renameMediaAsset: vi.fn(),
    deleteMediaAsset: vi.fn(),
    exportEditorTimeline: vi.fn(),
  }),
}));

vi.mock("./store/musicStore", () => ({
  useMusicStore: mockStoreSelector({
    musicTracks: [],
    musicCurrentIndex: -1,
    musicPlaying: false,
    musicVolume: 0.8,
    musicRepeatMode: "off",
    musicShuffleEnabled: false,
    musicCategories: [],
    setMusicPlaying: vi.fn(),
    setMusicVolume: vi.fn(),
    musicNext: vi.fn(),
    musicPrevious: vi.fn(),
  }),
}));

vi.mock("./store/handsStore", () => ({
  useHandsStore: mockStoreSelector({
    handsStatus: undefined,
    handsBusy: false,
    refreshHandsStatus: vi.fn(),
    startHandsService: vi.fn(),
    stopHandsService: vi.fn(),
  }),
}));

vi.mock("./store/terminalStore", () => ({
  useTerminalStore: mockStoreSelector({
    terminalSessionId: "test",
    terminalOutput: "",
    terminalReady: true,
    writeTerminalData: vi.fn(),
    resizeTerminal: vi.fn(),
    openBrowserPreview: vi.fn(),
    browserUrl: "http://localhost:3000",
    browserDraftUrl: "http://localhost:3000",
    setBrowserDraftUrl: vi.fn(),
    openBrowserUrl: vi.fn(),
  }),
}));

vi.mock("./store/tileStore", () => ({
  useTileStore: mockStoreSelector({
    tileSessionIds: [],
    tileLayout: 4,
    setTileSessionIds: vi.fn(),
    setTileLayout: vi.fn(),
  }),
}));

vi.mock("./lib/tauri", () => ({
  api: new Proxy({}, { get: () => vi.fn().mockResolvedValue([]) }),
  events: new Proxy({}, { get: () => vi.fn().mockResolvedValue(() => {}) }),
}));

describe("App", () => {
  it("renders the shell without crashing", () => {
    render(<App />);
    expect(screen.getByText("CHAT")).toBeInTheDocument();
  });
});
