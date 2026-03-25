import { FitAddon } from "@xterm/addon-fit";
import clsx from "clsx";
import { LayoutGrid } from "lucide-react";
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "xterm";
import { api } from "../lib/tauri";
import { useTileStore } from "../store/tileStore";

type TileLayout = 2 | 4 | 9;

export function TilesPage() {
  const layout = useTileStore((state) => state.tileLayout);
  const setLayout = useTileStore((state) => state.setTileLayout);
  const sessions = useTileStore((state) => state.tileSessionIds);
  const setSessions = useTileStore((state) => state.setTileSessionIds);

  // Spawn new terminals only when the layout needs more than we currently have.
  // Never kill terminals on downsize — they stay alive in the background so the
  // user can resize back up and find their sessions exactly as they left them.
  // Batch-spawn all needed terminals at once so the grid is at its final layout
  // before any TileTerminal mounts (prevents double-prompt from grid reflow).
  useEffect(() => {
    let cancelled = false;

    const allSessions = useTileStore.getState().tileSessionIds;

    if (allSessions.length < layout) {
      const needed = layout - allSessions.length;
      const spawnBatch = async () => {
        const handles = await Promise.all(
          Array.from({ length: needed }, () => api.createTerminal()),
        );
        if (cancelled) {
          for (const h of handles) void api.killTerminal(h.sessionId);
          return;
        }
        const latest = useTileStore.getState().tileSessionIds;
        setSessions([...latest, ...handles.map((h) => h.sessionId)]);
      };
      void spawnBatch();
    }

    return () => {
      cancelled = true;
    };
  }, [layout, setSessions]);

  // Only render terminals up to the current layout size.
  // Hidden terminals (beyond the layout) keep their PTY sessions alive in
  // the Rust backend — they simply don't have an xterm.js frontend attached.
  // When the user upsizes back, TileTerminal re-mounts and reconnects to
  // the existing PTY session, nudging the shell to redraw its prompt.
  const visibleSessions = sessions.slice(0, layout);

  const gridClass =
    layout === 2
      ? "grid-cols-2 grid-rows-1"
      : layout === 4
        ? "grid-cols-2 grid-rows-2"
        : "grid-cols-3 grid-rows-3";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 py-2">
        <LayoutGrid className="h-4 w-4 text-emerald-300/70" />
        <span className="text-[11px] font-semibold tracking-wide text-stone-300">Terminal Tiles</span>
        <span className="text-[9px] text-stone-600">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""} · {visibleSessions.length} visible
        </span>
        <div className="ml-auto flex items-center gap-1">
          {([2, 4, 9] as TileLayout[]).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setLayout(n)}
              className={clsx(
                "rounded-lg px-2.5 py-1 text-[10px] font-semibold tracking-wide transition",
                layout === n
                  ? "bg-emerald-400/15 text-emerald-200 border border-emerald-400/20"
                  : "text-stone-400 hover:text-stone-200 hover:bg-white/5 border border-transparent",
              )}
            >
              {n === 2 ? "1×2" : n === 4 ? "2×2" : "3×3"}
            </button>
          ))}
        </div>
      </div>
      <div className={clsx("grid flex-1 min-h-0 gap-1 p-1", gridClass)}>
        {visibleSessions.map((sessionId) => (
          <TileTerminal key={sessionId} sessionId={sessionId} />
        ))}
      </div>
    </div>
  );
}

function TileTerminal({ sessionId }: { sessionId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const outputCursorRef = useRef(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let disposed = false;

    const terminal = new XTerm({
      fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 11,
      cursorBlink: true,
      convertEol: false,
      theme: {
        background: "#070809",
        foreground: "#d6d3d1",
        cursor: "#a7f3d0",
        black: "#0f1115",
        brightBlack: "#4b5563",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();
    terminal.focus();

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const dataSubscription = terminal.onData((value) => {
      void api.writeTerminalInput(sessionId, value);
    });

    const resize = () => {
      fitAddon.fit();
      if (terminal.cols > 0 && terminal.rows > 0) {
        void api.resizeTerminal(sessionId, terminal.cols, terminal.rows);
      }
    };

    resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
    observer?.observe(host);

    let unlistenFn: (() => void) | null = null;
    const setupListener = async () => {
      const unlisten = await listen<{
        sessionId: string;
        kind: string;
        chunk?: string | null;
        stream?: string | null;
        exitCode?: number | null;
      }>("terminal://event", ({ payload }) => {
        if (disposed) return;
        if (payload.sessionId !== sessionId) return;
        const term = xtermRef.current;
        if (!term) return;

        if (payload.kind === "output") {
          const chunk = payload.chunk ?? "";
          term.write(chunk);
          outputCursorRef.current += chunk.length;
        } else if (payload.kind === "exit") {
          term.write(`\r\n[terminal exited${payload.exitCode != null ? `: ${payload.exitCode}` : ""}]\r\n`);
        }
      });
      // If the component unmounted while listen() was pending, clean up immediately
      if (disposed) {
        unlisten();
        return;
      }
      unlistenFn = unlisten;

      // Drain any early output that was buffered before the listener was ready.
      // Always use Ctrl+L to clear the screen and redraw a single clean prompt
      // at the correct viewport size — this works for both fresh sessions (early
      // buffer present) and re-mounts after navigation (early buffer drained).
      // Using \n instead would risk a double-prompt when a resize also fires.
      try {
        await api.getTerminalBuffer(sessionId);
        if (!disposed && xtermRef.current) {
          void api.writeTerminalInput(sessionId, "\x0c");
        }
      } catch {
        // Session may already be gone — ignore
      }
    };
    void setupListener();

    return () => {
      disposed = true;
      observer?.disconnect();
      dataSubscription.dispose();
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      outputCursorRef.current = 0;
      unlistenFn?.();
    };
  }, [sessionId]);

  return (
    <div className="min-h-0 min-w-0 overflow-hidden rounded-xl border border-white/8 bg-[#070809]">
      <div ref={hostRef} className="h-full w-full overflow-hidden p-1" />
    </div>
  );
}
