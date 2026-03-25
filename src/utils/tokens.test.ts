import { describe, expect, it } from "vitest";
import { estimateSelectedTokens } from "./tokens";
import type { WorkspaceItem } from "../types";

function makeItem(id: string, byteSize: number, chunkCount: number): WorkspaceItem {
  return {
    id,
    path: `/path/${id}`,
    kind: "file",
    byteSize,
    chunkCount,
    workspaceId: "ws-1",
  };
}

describe("estimateSelectedTokens", () => {
  it("estimates tokens as byteSize / 4", () => {
    const items = [makeItem("a", 4000, 1)];
    expect(estimateSelectedTokens(items, { a: true })).toBe(1000);
  });

  it("sums selected items only", () => {
    const items = [makeItem("a", 4000, 1), makeItem("b", 2000, 1)];
    expect(estimateSelectedTokens(items, { a: true, b: false })).toBe(1000);
  });

  it("skips items with chunkCount 0", () => {
    const items = [makeItem("a", 4000, 0)];
    expect(estimateSelectedTokens(items, { a: true })).toBe(0);
  });

  it("returns 0 for empty selection", () => {
    const items = [makeItem("a", 4000, 1)];
    expect(estimateSelectedTokens(items, {})).toBe(0);
  });

  it("rounds the result", () => {
    const items = [makeItem("a", 3, 1)];
    expect(estimateSelectedTokens(items, { a: true })).toBe(1);
  });
});
