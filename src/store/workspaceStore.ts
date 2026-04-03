import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { api } from "../lib/tauri";
import type { Workspace, WorkspaceItem } from "../types";

type ItemMap = Record<string, WorkspaceItem[]>;
type SelectionMap = Record<string, boolean>;

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId?: string;
  workspaceItems: ItemMap;
  workspaceSelection: SelectionMap;
  scanningWorkspaceId?: string;
  /** Separate selection map for the Chat page — isolated from IDE workspace. */
  chatSelection: SelectionMap;
  /** The workspace ID currently active in the Chat sidebar (independent of IDE). */
  chatWorkspaceId?: string;
  createWorkspaceFromFolder: () => Promise<void>;
  createWorkspaceFromFiles: () => Promise<void>;
  addFilesToWorkspace: (filePaths: string[]) => Promise<void>;
  removeWorkspaceFile: (filePath: string) => Promise<void>;
  replaceWorkspaceFromFolder: (workspaceId: string) => Promise<void>;
  replaceWorkspaceFromFiles: (workspaceId: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  scanWorkspace: (workspaceId: string) => Promise<void>;
  toggleWorkspaceItem: (itemId: string) => void;
  /** Select a workspace for Chat context (separate from IDE). */
  selectChatWorkspace: (workspaceId: string) => Promise<void>;
  /** Toggle a single item in the Chat selection map. */
  toggleChatItem: (itemId: string) => void;
  /** Clear the Chat workspace selection. */
  clearChatSelection: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  workspaceItems: {},
  workspaceSelection: {},
  chatSelection: {},

  createWorkspaceFromFolder: async () => {
    const selection = await open({ directory: true, multiple: false });
    if (typeof selection !== "string") {
      return;
    }
    const workspace = await api.createWorkspace({ roots: [selection] });
    const workspaces = await api.listWorkspaces();
    set({ workspaces, activeWorkspaceId: workspace.id });
    await get().scanWorkspace(workspace.id);
  },

  createWorkspaceFromFiles: async () => {
    const selection = await open({ directory: false, multiple: true });
    const roots =
      typeof selection === "string"
        ? [selection]
        : Array.isArray(selection)
          ? selection.filter((value): value is string => typeof value === "string")
          : [];
    if (!roots.length) {
      return;
    }
    const workspace = await api.createWorkspace({ roots });
    const workspaces = await api.listWorkspaces();
    set({ workspaces, activeWorkspaceId: workspace.id });
    await get().scanWorkspace(workspace.id);
  },

  addFilesToWorkspace: async (filePaths) => {
    if (!filePaths.length) return;
    const state = get();
    if (state.activeWorkspaceId) {
      const activeWorkspace = state.workspaces.find((ws) => ws.id === state.activeWorkspaceId);
      if (activeWorkspace) {
        const existingRoots = new Set(activeWorkspace.roots);
        const newRoots = filePaths.filter((p) => !existingRoots.has(p));
        if (!newRoots.length) return;
        const mergedRoots = [...activeWorkspace.roots, ...newRoots];
        await api.updateWorkspace(state.activeWorkspaceId, { roots: mergedRoots });
        const workspaces = await api.listWorkspaces();
        set({ workspaces });
        await get().scanWorkspace(state.activeWorkspaceId);
      }
    } else {
      const workspace = await api.createWorkspace({ roots: filePaths });
      const workspaces = await api.listWorkspaces();
      set({ workspaces, activeWorkspaceId: workspace.id });
      await get().scanWorkspace(workspace.id);
    }
  },

  removeWorkspaceFile: async (filePath) => {
    const state = get();
    if (!state.activeWorkspaceId) return;
    const activeWorkspace = state.workspaces.find((ws) => ws.id === state.activeWorkspaceId);
    if (!activeWorkspace) return;
    const remainingRoots = activeWorkspace.roots.filter((r) => r !== filePath);
    if (remainingRoots.length === 0) {
      await get().deleteWorkspace(state.activeWorkspaceId);
    } else {
      await api.updateWorkspace(state.activeWorkspaceId, { roots: remainingRoots });
      const workspaces = await api.listWorkspaces();
      set({ workspaces });
      await get().scanWorkspace(state.activeWorkspaceId);
    }
  },

  replaceWorkspaceFromFolder: async (workspaceId) => {
    const selection = await open({ directory: true, multiple: false });
    if (typeof selection !== "string") {
      return;
    }
    await api.updateWorkspace(workspaceId, { roots: [selection] });
    const workspaces = await api.listWorkspaces();
    set((state) => ({
      workspaces,
      activeWorkspaceId: workspaceId,
      workspaceItems: { ...state.workspaceItems, [workspaceId]: [] },
      workspaceSelection: Object.fromEntries(
        Object.entries(state.workspaceSelection).filter(([itemId]) => {
          const items = state.workspaceItems[workspaceId] ?? [];
          return !items.some((item) => item.id === itemId);
        }),
      ),
    }));
    await get().scanWorkspace(workspaceId);
  },

  replaceWorkspaceFromFiles: async (workspaceId) => {
    const selection = await open({ directory: false, multiple: true });
    const roots =
      typeof selection === "string"
        ? [selection]
        : Array.isArray(selection)
          ? selection.filter((value): value is string => typeof value === "string")
          : [];
    if (!roots.length) {
      return;
    }
    await api.updateWorkspace(workspaceId, { roots });
    const workspaces = await api.listWorkspaces();
    set((state) => ({
      workspaces,
      activeWorkspaceId: workspaceId,
      workspaceItems: { ...state.workspaceItems, [workspaceId]: [] },
      workspaceSelection: Object.fromEntries(
        Object.entries(state.workspaceSelection).filter(([itemId]) => {
          const items = state.workspaceItems[workspaceId] ?? [];
          return !items.some((item) => item.id === itemId);
        }),
      ),
    }));
    await get().scanWorkspace(workspaceId);
  },

  deleteWorkspace: async (workspaceId) => {
    await api.deleteWorkspace(workspaceId);
    const workspaces = await api.listWorkspaces();
    set((state) => {
      const nextWorkspaceItems = { ...state.workspaceItems };
      const removedItems = nextWorkspaceItems[workspaceId] ?? [];
      delete nextWorkspaceItems[workspaceId];
      return {
        workspaces,
        activeWorkspaceId:
          state.activeWorkspaceId === workspaceId ? workspaces[0]?.id : state.activeWorkspaceId,
        workspaceItems: nextWorkspaceItems,
        workspaceSelection: Object.fromEntries(
          Object.entries(state.workspaceSelection).filter(
            ([itemId]) => !removedItems.some((item) => item.id === itemId),
          ),
        ),
      };
    });
    const nextWorkspaceId = get().activeWorkspaceId;
    if (nextWorkspaceId) {
      await get().selectWorkspace(nextWorkspaceId);
    }
  },

  selectWorkspace: async (workspaceId) => {
    const items = await api.listWorkspaceItems(workspaceId);
    set((state) => ({
      activeWorkspaceId: workspaceId,
      workspaceItems: { ...state.workspaceItems, [workspaceId]: items },
      workspaceSelection: Object.fromEntries(
        items.map((item) => [item.id, state.workspaceSelection[item.id] ?? true]),
      ),
    }));
  },

  scanWorkspace: async (workspaceId) => {
    set({ scanningWorkspaceId: workspaceId });
    try {
      await api.scanWorkspace(workspaceId);
      const workspaces = await api.listWorkspaces();
      set({ workspaces });
      await get().selectWorkspace(workspaceId);
    } finally {
      set({ scanningWorkspaceId: undefined });
    }
  },

  toggleWorkspaceItem: (itemId) =>
    set((state) => ({
      workspaceSelection: {
        ...state.workspaceSelection,
        [itemId]: !state.workspaceSelection[itemId],
      },
    })),

  selectChatWorkspace: async (workspaceId) => {
    const items = await api.listWorkspaceItems(workspaceId);
    set((state) => ({
      chatWorkspaceId: workspaceId,
      workspaceItems: { ...state.workspaceItems, [workspaceId]: items },
      chatSelection: Object.fromEntries(
        items.map((item) => [item.id, state.chatSelection[item.id] ?? true]),
      ),
    }));
  },

  toggleChatItem: (itemId) =>
    set((state) => ({
      chatSelection: {
        ...state.chatSelection,
        [itemId]: !state.chatSelection[itemId],
      },
    })),

  clearChatSelection: () =>
    set({ chatWorkspaceId: undefined, chatSelection: {} }),
}));
