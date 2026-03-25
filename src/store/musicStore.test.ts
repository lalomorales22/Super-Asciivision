import { describe, expect, it, beforeEach, vi } from "vitest";
import { useMusicStore } from "./musicStore";

// Mock the tauri API
vi.mock("../lib/tauri", () => ({
  api: {
    listMusicFiles: vi.fn().mockResolvedValue([]),
    listMusicCategories: vi.fn().mockResolvedValue([]),
    createMusicCategory: vi.fn().mockResolvedValue(undefined),
    deleteMusicCategory: vi.fn().mockResolvedValue(undefined),
    importMusicFiles: vi.fn().mockResolvedValue(0),
    linkTracksToCategory: vi.fn().mockResolvedValue(0),
  },
}));

// Mock appStore for error reporting
vi.mock("./appStore", () => ({
  useAppStore: { setState: vi.fn() },
}));

describe("musicStore", () => {
  beforeEach(() => {
    useMusicStore.setState({
      musicTracks: [],
      musicCurrentIndex: -1,
      musicPlaying: false,
      musicShuffleEnabled: false,
      musicRepeatMode: "off",
      musicVolume: 0.8,
      musicFolderPath: undefined,
      musicCategories: [],
      activeMusicCategory: undefined,
    });
  });

  it("has correct initial state", () => {
    const state = useMusicStore.getState();
    expect(state.musicPlaying).toBe(false);
    expect(state.musicCurrentIndex).toBe(-1);
    expect(state.musicVolume).toBe(0.8);
    expect(state.musicRepeatMode).toBe("off");
  });

  it("sets playing state", () => {
    useMusicStore.getState().setMusicPlaying(true);
    expect(useMusicStore.getState().musicPlaying).toBe(true);
  });

  it("sets current index and starts playing", () => {
    useMusicStore.getState().setMusicCurrentIndex(5);
    const state = useMusicStore.getState();
    expect(state.musicCurrentIndex).toBe(5);
    expect(state.musicPlaying).toBe(true);
  });

  it("sets volume", () => {
    useMusicStore.getState().setMusicVolume(0.5);
    expect(useMusicStore.getState().musicVolume).toBe(0.5);
  });

  it("sets shuffle", () => {
    useMusicStore.getState().setMusicShuffle(true);
    expect(useMusicStore.getState().musicShuffleEnabled).toBe(true);
  });

  it("sets repeat mode", () => {
    useMusicStore.getState().setMusicRepeatMode("all");
    expect(useMusicStore.getState().musicRepeatMode).toBe("all");
  });

  it("sets active music category", () => {
    useMusicStore.getState().setActiveMusicCategory("Rock");
    expect(useMusicStore.getState().activeMusicCategory).toBe("Rock");
  });

  describe("musicNext", () => {
    beforeEach(() => {
      useMusicStore.setState({
        musicTracks: [
          { filePath: "a.mp3", fileName: "a" },
          { filePath: "b.mp3", fileName: "b" },
          { filePath: "c.mp3", fileName: "c" },
        ] as never[],
        musicCurrentIndex: 0,
        musicPlaying: true,
        musicShuffleEnabled: false,
        musicRepeatMode: "off",
      });
    });

    it("advances to next track", () => {
      useMusicStore.getState().musicNext();
      expect(useMusicStore.getState().musicCurrentIndex).toBe(1);
    });

    it("stops at end when repeat is off", () => {
      useMusicStore.setState({ musicCurrentIndex: 2 });
      useMusicStore.getState().musicNext();
      expect(useMusicStore.getState().musicPlaying).toBe(false);
    });

    it("wraps around when repeat is all", () => {
      useMusicStore.setState({ musicCurrentIndex: 2, musicRepeatMode: "all" });
      useMusicStore.getState().musicNext();
      expect(useMusicStore.getState().musicCurrentIndex).toBe(0);
      expect(useMusicStore.getState().musicPlaying).toBe(true);
    });

    it("stays on same track when repeat is one", () => {
      useMusicStore.setState({ musicRepeatMode: "one" });
      useMusicStore.getState().musicNext();
      expect(useMusicStore.getState().musicCurrentIndex).toBe(0);
    });
  });

  describe("musicPrevious", () => {
    beforeEach(() => {
      useMusicStore.setState({
        musicTracks: [
          { filePath: "a.mp3", fileName: "a" },
          { filePath: "b.mp3", fileName: "b" },
          { filePath: "c.mp3", fileName: "c" },
        ] as never[],
        musicCurrentIndex: 1,
        musicShuffleEnabled: false,
      });
    });

    it("goes to previous track", () => {
      useMusicStore.getState().musicPrevious();
      expect(useMusicStore.getState().musicCurrentIndex).toBe(0);
    });

    it("wraps to end from first track", () => {
      useMusicStore.setState({ musicCurrentIndex: 0 });
      useMusicStore.getState().musicPrevious();
      expect(useMusicStore.getState().musicCurrentIndex).toBe(2);
    });
  });
});
