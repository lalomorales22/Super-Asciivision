import { create } from "zustand";

interface TileState {
  tileSessionIds: string[];
  tileLayout: 2 | 4 | 9;
  setTileSessionIds: (ids: string[]) => void;
  setTileLayout: (layout: 2 | 4 | 9) => void;
}

export const useTileStore = create<TileState>((set) => ({
  tileSessionIds: [],
  tileLayout: 4,
  setTileSessionIds: (ids) => set({ tileSessionIds: ids }),
  setTileLayout: (layout) => set({ tileLayout: layout }),
}));
