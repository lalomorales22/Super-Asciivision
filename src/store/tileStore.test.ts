import { describe, expect, it, beforeEach } from "vitest";
import { useTileStore } from "./tileStore";

describe("tileStore", () => {
  beforeEach(() => {
    useTileStore.setState({ tileSessionIds: [], tileLayout: 4 });
  });

  it("has correct initial state", () => {
    const state = useTileStore.getState();
    expect(state.tileSessionIds).toEqual([]);
    expect(state.tileLayout).toBe(4);
  });

  it("sets tile session IDs", () => {
    useTileStore.getState().setTileSessionIds(["a", "b", "c"]);
    expect(useTileStore.getState().tileSessionIds).toEqual(["a", "b", "c"]);
  });

  it("sets tile layout", () => {
    useTileStore.getState().setTileLayout(9);
    expect(useTileStore.getState().tileLayout).toBe(9);

    useTileStore.getState().setTileLayout(2);
    expect(useTileStore.getState().tileLayout).toBe(2);
  });
});
