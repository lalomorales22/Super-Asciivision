import { create } from "zustand";
import { api } from "../lib/tauri";
import type { MusicCategory as MusicCategoryType, MusicTrack } from "../types";
import { useAppStore } from "./appStore";

interface MusicState {
  musicTracks: MusicTrack[];
  musicCurrentIndex: number;
  musicPlaying: boolean;
  musicShuffleEnabled: boolean;
  musicRepeatMode: "off" | "all" | "one";
  musicVolume: number;
  musicFolderPath?: string;
  musicCategories: MusicCategoryType[];
  activeMusicCategory?: string;
  refreshMusicLibrary: (folderPath?: string) => Promise<void>;
  setMusicPlaying: (playing: boolean) => void;
  setMusicCurrentIndex: (index: number) => void;
  setMusicShuffle: (enabled: boolean) => void;
  setMusicRepeatMode: (mode: "off" | "all" | "one") => void;
  setMusicVolume: (volume: number) => void;
  musicNext: () => void;
  musicPrevious: () => void;
  setMusicFolder: (path: string) => Promise<void>;
  refreshMusicCategories: (folderPath?: string) => Promise<void>;
  setActiveMusicCategory: (name?: string) => void;
  createMusicCategory: (name: string) => Promise<void>;
  deleteMusicCategory: (categoryPath: string) => Promise<void>;
  importMusicFiles: (filePaths: string[], targetFolder?: string) => Promise<number>;
  linkTracksToCategory: (trackPaths: string[], categoryName: string) => Promise<number>;
}

export const useMusicStore = create<MusicState>((set, get) => ({
  musicTracks: [],
  musicCurrentIndex: -1,
  musicPlaying: false,
  musicShuffleEnabled: false,
  musicRepeatMode: "off",
  musicVolume: 0.8,
  musicCategories: [],

  refreshMusicLibrary: async (folderPath?: string) => {
    try {
      const folder = folderPath ?? get().musicFolderPath;
      const tracks = await api.listMusicFiles(folder);
      set({ musicTracks: tracks, musicFolderPath: folder });
    } catch (error) {
      useAppStore.setState({ error: error instanceof Error ? error.message : "Failed to load music library" });
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
    await get().refreshMusicCategories(path);
  },
  refreshMusicCategories: async (folderPath?: string) => {
    try {
      const folder = folderPath ?? get().musicFolderPath;
      const categories = await api.listMusicCategories(folder);
      set({ musicCategories: categories });
    } catch (error) {
      useAppStore.setState({ error: error instanceof Error ? error.message : "Failed to load music categories" });
    }
  },
  setActiveMusicCategory: (name) => set({ activeMusicCategory: name }),
  createMusicCategory: async (name) => {
    const folder = get().musicFolderPath;
    await api.createMusicCategory(name, folder);
    await get().refreshMusicCategories(folder);
  },
  deleteMusicCategory: async (categoryPath) => {
    await api.deleteMusicCategory(categoryPath);
    const folder = get().musicFolderPath;
    await get().refreshMusicCategories(folder);
    await get().refreshMusicLibrary(folder);
  },
  importMusicFiles: async (filePaths, targetFolder) => {
    const folder = get().musicFolderPath;
    const count = await api.importMusicFiles(filePaths, targetFolder, folder);
    await get().refreshMusicLibrary(folder);
    await get().refreshMusicCategories(folder);
    return count;
  },
  linkTracksToCategory: async (trackPaths, categoryName) => {
    const folder = get().musicFolderPath;
    const count = await api.linkTracksToCategory(trackPaths, categoryName, folder);
    await get().refreshMusicLibrary(folder);
    await get().refreshMusicCategories(folder);
    return count;
  },
}));
