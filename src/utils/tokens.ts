import type { WorkspaceItem } from "../types";

export function estimateSelectedTokens(items: WorkspaceItem[], selection: Record<string, boolean>) {
  return Math.round(
    items
      .filter((item) => selection[item.id] && item.chunkCount > 0)
      .reduce((sum, item) => sum + item.byteSize, 0) / 4,
  );
}
