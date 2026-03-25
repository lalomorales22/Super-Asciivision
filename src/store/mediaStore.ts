import { create } from "zustand";
import { api } from "../lib/tauri";
import type {
  ExportEditorTimelineRequest,
  MediaAsset,
  MediaCategory,
  RealtimeSession,
} from "../types";
import { useAppStore } from "./appStore";

interface MediaState {
  mediaCategories: MediaCategory[];
  mediaAssets: MediaAsset[];
  mediaLoaded: boolean;
  selectedMediaCategoryId?: string;
  generatingImage: boolean;
  generatingVideo: boolean;
  generatingSpeech: boolean;
  exportingEditor: boolean;
  creatingRealtimeSession: boolean;
  realtimeSession?: RealtimeSession;
  refreshMediaCategories: () => Promise<void>;
  refreshMediaAssets: (categoryId?: string) => Promise<void>;
  ensureMediaLoaded: () => Promise<void>;
  createMediaCategory: (name: string, kind?: string) => Promise<void>;
  renameMediaCategory: (categoryId: string, name: string) => Promise<void>;
  deleteMediaCategory: (categoryId: string) => Promise<void>;
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
}

export const useMediaStore = create<MediaState>((set, get) => ({
  mediaCategories: [],
  mediaAssets: [],
  mediaLoaded: false,
  generatingImage: false,
  generatingVideo: false,
  generatingSpeech: false,
  exportingEditor: false,
  creatingRealtimeSession: false,

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

  createMediaCategory: async (name, kind) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    try {
      await api.createMediaCategory({ name: trimmed, kind: kind ?? null });
      await get().refreshMediaCategories();
      await get().refreshMediaAssets();
    } catch (error) {
      useAppStore.setState({ error: error instanceof Error ? error.message : "Category creation failed." });
    }
  },

  renameMediaCategory: async (categoryId, name) => {
    await api.renameMediaCategory(categoryId, name);
    await get().refreshMediaCategories();
  },

  deleteMediaCategory: async (categoryId) => {
    await api.deleteMediaCategory(categoryId);
    await get().refreshMediaCategories();
    await get().refreshMediaAssets();
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
      useAppStore.setState({ error: error instanceof Error ? error.message : "Local media import failed." });
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
    set({ exportingEditor: true });
    useAppStore.setState({ error: undefined });
    try {
      await api.exportEditorTimeline(input);
      await get().refreshMediaAssets();
      await get().refreshMediaCategories();
    } catch (error) {
      useAppStore.setState({ error: error instanceof Error ? error.message : "Editor export failed." });
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
    set({ generatingImage: true });
    useAppStore.setState({ error: undefined });
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
      await useAppStore.getState().refreshProviderStatus();
    } catch (error) {
      useAppStore.setState({ error: error instanceof Error ? error.message : "Image generation failed." });
    } finally {
      set({ generatingImage: false });
    }
  },

  generateVideo: async (prompt, modelId, categoryId) => {
    if (!prompt.trim()) {
      return;
    }
    set({ generatingVideo: true });
    useAppStore.setState({ error: undefined });
    try {
      await api.generateVideo({
        prompt: prompt.trim(),
        modelId,
        categoryId,
      });
      await get().refreshMediaAssets();
      await get().refreshMediaCategories();
      await useAppStore.getState().refreshProviderStatus();
    } catch (error) {
      useAppStore.setState({ error: error instanceof Error ? error.message : "Video generation failed." });
    } finally {
      set({ generatingVideo: false });
    }
  },

  generateSpeech: async (input, modelId, voice, responseFormat, categoryId) => {
    if (!input.trim()) {
      return;
    }
    set({ generatingSpeech: true });
    useAppStore.setState({ error: undefined });
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
      await useAppStore.getState().refreshProviderStatus();
    } catch (error) {
      useAppStore.setState({ error: error instanceof Error ? error.message : "Speech generation failed." });
    } finally {
      set({ generatingSpeech: false });
    }
  },

  createRealtimeSession: async (modelId, voice, instructions) => {
    set({ creatingRealtimeSession: true });
    useAppStore.setState({ error: undefined });
    try {
      const realtimeSession = await api.createRealtimeSession({
        modelId,
        voice,
        instructions,
      });
      set({ realtimeSession });
      await useAppStore.getState().refreshProviderStatus();
    } catch (error) {
      useAppStore.setState({ error: error instanceof Error ? error.message : "Realtime session creation failed." });
    } finally {
      set({ creatingRealtimeSession: false });
    }
  },

  clearRealtimeSession: () => set({ realtimeSession: undefined }),
}));
