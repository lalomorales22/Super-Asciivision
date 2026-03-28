import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
// Mock Tauri APIs that pages may call at module-load time
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize: vi.fn(), close: vi.fn(), startDragging: vi.fn() }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

// Mock xterm (used by TilesPage)
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
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = vi.fn(); } }));

// Mock qrcode (used by HandsPage)
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,") } }));

// Mock Tauri API layer
vi.mock("../lib/tauri", () => ({
  api: new Proxy({}, {
    get: (_target: unknown, prop: string) => {
      if (prop === "getDefaultMusicFolder") return vi.fn().mockResolvedValue("/music");
      return vi.fn().mockResolvedValue([]);
    },
  }),
  events: new Proxy({}, { get: () => vi.fn().mockResolvedValue(() => {}) }),
}));

// Create mock store factories
function mockStoreSelector(state: Record<string, unknown>) {
  const hook = (selector: (s: Record<string, unknown>) => unknown) => selector(state);
  hook.getState = () => state;
  hook.setState = vi.fn();
  hook.subscribe = vi.fn();
  return hook;
}

const appState = {
  settings: { hotkey: "", alwaysOnTop: false, defaultProvider: "xai", xaiModel: "grok-4-1-fast-reasoning" },
  providerStatuses: [],
  models: { xai: [], ollama: [] },
  selectedProvider: "xai",
  selectedModel: "grok-4-1-fast-reasoning",
  settingsOpen: false,
  toggleSettings: vi.fn(),
  selectModel: vi.fn(),
  setSelectedProvider: vi.fn(),
};

const chatState = {
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
  refreshConversations: vi.fn(),
  loadConversation: vi.fn(),
  createConversation: vi.fn(),
  renameConversation: vi.fn(),
  toggleConversationPin: vi.fn(),
  deleteConversation: vi.fn(),
};

const workspaceState = {
  workspaces: [],
  activeWorkspaceId: undefined,
  workspaceItems: {},
  workspaceSelection: {},
  scanningWorkspaceId: undefined,
  createWorkspaceFromFolder: vi.fn(),
  createWorkspaceFromFiles: vi.fn(),
  addFilesToWorkspace: vi.fn(),
  removeWorkspaceFile: vi.fn(),
  deleteWorkspace: vi.fn(),
  selectWorkspace: vi.fn(),
  scanWorkspace: vi.fn(),
  toggleWorkspaceItem: vi.fn(),
};

const mediaState = {
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
  generateSpeech: vi.fn(),
  createRealtimeSession: vi.fn(),
  clearRealtimeSession: vi.fn(),
  importLocalMediaAsset: vi.fn(),
  moveMediaAssetToCategory: vi.fn(),
  renameMediaAsset: vi.fn(),
  deleteMediaAsset: vi.fn(),
  exportEditorTimeline: vi.fn(),
  refreshMediaCategories: vi.fn(),
  refreshMediaAssets: vi.fn(),
  selectMediaCategory: vi.fn(),
};

const musicState = {
  musicTracks: [],
  musicCurrentIndex: -1,
  musicPlaying: false,
  musicShuffleEnabled: false,
  musicRepeatMode: "off",
  musicVolume: 0.8,
  musicFolderPath: undefined,
  musicCategories: [],
  activeMusicCategory: undefined,
  refreshMusicLibrary: vi.fn(),
  setMusicPlaying: vi.fn(),
  setMusicCurrentIndex: vi.fn(),
  setMusicShuffle: vi.fn(),
  setMusicRepeatMode: vi.fn(),
  setMusicVolume: vi.fn(),
  musicNext: vi.fn(),
  musicPrevious: vi.fn(),
  setMusicFolder: vi.fn(),
  refreshMusicCategories: vi.fn(),
  setActiveMusicCategory: vi.fn(),
  linkTracksToCategory: vi.fn(),
};

const handsState = {
  handsStatus: undefined,
  handsBusy: false,
  refreshHandsStatus: vi.fn(),
  startHandsService: vi.fn(),
  stopHandsService: vi.fn(),
};

const terminalState = {
  terminalSessionId: "test",
  terminalOutput: "",
  terminalReady: true,
  writeTerminalData: vi.fn(),
  resizeTerminal: vi.fn(),
  openBrowserPreview: vi.fn(),
};

const tileState = {
  tileSessionIds: [],
  tileLayout: 4,
  setTileSessionIds: vi.fn(),
  setTileLayout: vi.fn(),
};

vi.mock("../store/appStore", () => ({ useAppStore: mockStoreSelector(appState) }));
vi.mock("../store/chatStore", () => ({ useChatStore: mockStoreSelector(chatState) }));
vi.mock("../store/workspaceStore", () => ({ useWorkspaceStore: mockStoreSelector(workspaceState) }));
vi.mock("../store/mediaStore", () => ({ useMediaStore: mockStoreSelector(mediaState) }));
vi.mock("../store/musicStore", () => ({ useMusicStore: mockStoreSelector(musicState) }));
vi.mock("../store/handsStore", () => ({ useHandsStore: mockStoreSelector(handsState) }));
vi.mock("../store/terminalStore", () => ({ useTerminalStore: mockStoreSelector(terminalState) }));
vi.mock("../store/tileStore", () => ({ useTileStore: mockStoreSelector(tileState) }));

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Page smoke tests", () => {
  it("ChatPage mounts without crashing", async () => {
    const { ChatPage } = await import("./ChatPage");
    const { container } = render(<ChatPage />);
    expect(container).toBeTruthy();
  });

  it("MusicPage mounts without crashing", async () => {
    const { MusicPage } = await import("./MusicPage");
    let container: HTMLElement;
    await act(async () => {
      const result = render(<MusicPage />);
      container = result.container;
    });
    expect(container!).toBeTruthy();
  });

  it("ImaginePage mounts without crashing", async () => {
    const { ImaginePage } = await import("./ImaginePage");
    const { container } = render(<ImaginePage onShowBrowser={vi.fn()} />);
    expect(container).toBeTruthy();
  });

  it("VoiceAudioPage mounts without crashing", async () => {
    const { VoiceAudioPage } = await import("./VoiceAudioPage");
    const { container } = render(<VoiceAudioPage onShowBrowser={vi.fn()} />);
    expect(container).toBeTruthy();
  });

  it("HandsPage mounts without crashing", async () => {
    const { HandsPage } = await import("./HandsPage");
    const { container } = render(<HandsPage onNavigate={vi.fn()} />);
    expect(container).toBeTruthy();
  });

  it("TilesPage mounts without crashing", async () => {
    const { TilesPage } = await import("./TilesPage");
    const { container } = render(<TilesPage />);
    expect(container).toBeTruthy();
  });
});
