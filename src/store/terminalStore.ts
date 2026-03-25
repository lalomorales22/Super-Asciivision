import { create } from "zustand";
import { api } from "../lib/tauri";

function detectServerUrl(value: string) {
  const match = value.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s]*)?/i);
  return match?.[0];
}

function normalizeBrowserUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "http://localhost:3000";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

function appendTerminalOutput(existing: string, nextChunk: string) {
  const combined = `${existing}${nextChunk}`;
  return combined.length > 120_000 ? combined.slice(-120_000) : combined;
}

interface TerminalState {
  terminalSessionId?: string;
  terminalOutput: string;
  terminalReady: boolean;
  detectedServerUrl?: string;
  browserUrl: string;
  browserDraftUrl: string;
  browserPreviewHtml?: string;
  startTerminal: () => Promise<void>;
  writeTerminalData: (value: string) => Promise<void>;
  interruptTerminal: () => Promise<void>;
  clearTerminalOutput: () => void;
  resizeTerminal: (cols: number, rows: number) => Promise<void>;
  setBrowserDraftUrl: (value: string) => void;
  openBrowserUrl: (value?: string) => void;
  openBrowserPreview: (html: string) => void;
  handleTerminalEvent: (event: { sessionId: string; kind: string; chunk?: string | null; exitCode?: number | null }) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminalOutput: "",
  terminalReady: false,
  browserUrl: "http://localhost:3000",
  browserDraftUrl: "http://localhost:3000",

  startTerminal: async () => {
    if (get().terminalSessionId && get().terminalReady) {
      return;
    }
    const handle = await api.startTerminal();
    set({
      terminalSessionId: handle.sessionId,
      terminalReady: true,
    });
  },

  writeTerminalData: async (value) => {
    const sessionId = get().terminalSessionId;
    if (!sessionId || !value) {
      return;
    }
    await api.writeTerminalInput(sessionId, value);
  },

  interruptTerminal: async () => {
    const sessionId = get().terminalSessionId;
    if (!sessionId) {
      return;
    }
    await api.writeTerminalInput(sessionId, "\u0003");
  },

  clearTerminalOutput: () => set({ terminalOutput: "" }),

  resizeTerminal: async (cols, rows) => {
    const sessionId = get().terminalSessionId;
    if (!sessionId || cols < 1 || rows < 1) {
      return;
    }
    await api.resizeTerminal(sessionId, cols, rows);
  },

  setBrowserDraftUrl: (value) => set({ browserDraftUrl: value }),

  openBrowserUrl: (value) => {
    const nextUrl = normalizeBrowserUrl(value ?? get().browserDraftUrl);
    set({ browserUrl: nextUrl, browserDraftUrl: nextUrl, browserPreviewHtml: undefined });
  },

  openBrowserPreview: (html) =>
    set({
      browserPreviewHtml: html,
      browserDraftUrl: "preview://assistant-snippet",
    }),

  handleTerminalEvent: (event) => {
    // Strict allowlist: only process events from the footer terminal.
    const footerSessionId = get().terminalSessionId;
    if (event.sessionId !== footerSessionId) {
      return;
    }

    if (event.kind === "output") {
      set((state) => {
        const rawChunk = event.chunk ?? "";
        const detected = detectServerUrl(rawChunk) ?? state.detectedServerUrl;
        return {
          terminalOutput: appendTerminalOutput(state.terminalOutput, rawChunk),
          terminalReady: true,
          detectedServerUrl: detected,
          browserUrl:
            detected && state.browserUrl === "http://localhost:3000"
              ? detected
              : state.browserUrl,
          browserDraftUrl:
            detected && state.browserDraftUrl === "http://localhost:3000"
              ? detected
              : state.browserDraftUrl,
        };
      });
      return;
    }

    set((state) => ({
      terminalReady: false,
      terminalOutput: appendTerminalOutput(
        state.terminalOutput,
        `\n[terminal exited${event.exitCode != null ? `: ${event.exitCode}` : ""}]\n`,
      ),
    }));
  },
}));
