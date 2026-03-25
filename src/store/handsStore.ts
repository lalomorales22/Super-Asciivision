import { create } from "zustand";
import { api } from "../lib/tauri";
import type { HandsStatus } from "../types";
import { useAppStore } from "./appStore";

interface HandsState {
  handsStatus?: HandsStatus;
  handsBusy: boolean;
  refreshHandsStatus: () => Promise<void>;
  startHandsService: () => Promise<void>;
  stopHandsService: () => Promise<void>;
}

export const useHandsStore = create<HandsState>((set) => ({
  handsBusy: false,

  refreshHandsStatus: async () => {
    const handsStatus = await api.getHandsStatus();
    set({ handsStatus });
  },

  startHandsService: async () => {
    set({ handsBusy: true });
    useAppStore.setState({ error: undefined });
    try {
      const handsStatus = await api.startHandsService();
      set({ handsStatus, handsBusy: false });
    } catch (error) {
      set({ handsBusy: false });
      useAppStore.setState({
        error: error instanceof Error ? error.message : "Failed to start Hands.",
      });
    }
  },

  stopHandsService: async () => {
    set({ handsBusy: true });
    useAppStore.setState({ error: undefined });
    try {
      const handsStatus = await api.stopHandsService();
      set({ handsStatus, handsBusy: false });
    } catch (error) {
      set({ handsBusy: false });
      useAppStore.setState({
        error: error instanceof Error ? error.message : "Failed to stop Hands.",
      });
    }
  },
}));
