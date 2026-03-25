import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "xterm";
import { api } from "../../lib/tauri";

export function AsciiVisionPanel({ onClose }: { onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let disposed = false;
    let unlistenFn: (() => void) | null = null;

    const terminal = new XTerm({
      fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 11,
      lineHeight: 1.0,
      letterSpacing: 0,
      cursorBlink: true,
      convertEol: false,
      allowProposedApi: true,
      scrollback: 5000,
      theme: {
        background: "#000000",
        foreground: "#d6d3d1",
        cursor: "#00ffcc",
        cursorAccent: "#000000",
        selectionBackground: "rgba(0,255,204,0.18)",
        black: "#0a0b0d",
        red: "#ff5f57",
        green: "#4ade80",
        yellow: "#ffbd2f",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#d6d3d1",
        brightBlack: "#4b5563",
        brightRed: "#ff8a80",
        brightGreen: "#86efac",
        brightYellow: "#ffe082",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#fafaf9",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    const unicode11 = new Unicode11Addon();
    terminal.loadAddon(unicode11);
    terminal.unicode.activeVersion = '11';
    terminal.open(host);

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Forward keyboard input to the PTY
    const dataSubscription = terminal.onData((value) => {
      if (sessionIdRef.current) {
        void api.writeTerminalInput(sessionIdRef.current, value);
      }
    });

    // Initial fit (no PTY resize yet — session hasn't started)
    fitAddon.fit();

    // Launch asciivision
    // We buffer early terminal events and replay once we know our session ID,
    // so we don't miss the intro animation output.
    type TermEvent = { sessionId: string; kind: string; chunk?: string | null; exitCode?: number | null };
    const earlyBuffer: TermEvent[] = [];

    const launch = async () => {
      try {
        // Set up the event listener BEFORE launching
        const unlisten = await listen<TermEvent>("terminal://event", ({ payload }) => {
          if (disposed) return;
          const myId = sessionIdRef.current;
          if (!myId) {
            // Don't know our session ID yet — buffer everything
            earlyBuffer.push(payload);
            return;
          }
          if (payload.sessionId !== myId) return;
          if (payload.kind === "output" && payload.chunk) {
            terminal.write(payload.chunk);
          } else if (payload.kind === "exit") {
            onCloseRef.current();
          }
        });
        // If the component unmounted while listen() was pending, clean up immediately
        if (disposed) {
          unlisten();
          return;
        }
        unlistenFn = unlisten;

        if (disposed) return;

        // Fit xterm.js to its container so we know the correct viewport size
        // BEFORE creating the PTY — prevents scroll caused by PTY being larger
        // than the xterm.js viewport on macOS.
        fitAddon.fit();

        // Now launch the process with the correct initial PTY size
        const handle = await api.launchAsciivision(terminal.cols, terminal.rows);
        if (disposed) {
          void api.killTerminal(handle.sessionId);
          return;
        }
        sessionIdRef.current = handle.sessionId;

        // Replay any buffered events that belong to our session
        for (const evt of earlyBuffer) {
          if (evt.sessionId !== handle.sessionId) continue;
          if (evt.kind === "output" && evt.chunk) {
            terminal.write(evt.chunk);
          } else if (evt.kind === "exit") {
            onCloseRef.current();
            return;
          }
        }
        earlyBuffer.length = 0;

        setLoading(false);

        // Fit once after the loading overlay is removed and layout settles.
        // A single delayed fit avoids the resize feedback loop that can cause
        // layout oscillation on some macOS configurations.
        requestAnimationFrame(() => {
          if (disposed) return;
          terminal.focus();
          setTimeout(() => {
            if (disposed) return;
            fitAddon.fit();
            const { cols, rows } = terminal;
            if (cols > 0 && rows > 0) {
              void api.resizeTerminal(handle.sessionId, cols, rows);
            }
          }, 120);
        });
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    };

    void launch();

    // Resize handling — debounced and guarded against feedback loops.
    // Track last-sent dimensions to avoid redundant PTY resizes that can
    // cause layout oscillation on some macOS configurations (transparent +
    // undecorated windows).
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSentCols = 0;
    let lastSentRows = 0;
    const stableResize = () => {
      if (disposed) return;
      fitAddon.fit();
      const { cols, rows } = terminal;
      if (cols > 0 && rows > 0 && (cols !== lastSentCols || rows !== lastSentRows) && sessionIdRef.current) {
        lastSentCols = cols;
        lastSentRows = rows;
        void api.resizeTerminal(sessionIdRef.current, cols, rows);
      }
    };
    const resize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(stableResize, 80);
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
    observer?.observe(host);
    window.addEventListener("resize", resize);

    return () => {
      disposed = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      // Remove the event listener FIRST so no more events arrive
      unlistenFn?.();
      // Kill the PTY before disposing xterm so no final output can leak
      if (sessionIdRef.current) {
        void api.killTerminal(sessionIdRef.current);
        sessionIdRef.current = null;
      }
      dataSubscription.dispose();
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle Ctrl+Escape to close
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      {/* Terminal area - takes all space below TopBar */}
      <div className="relative flex-1 min-h-0 bg-black rounded-b-[33px] overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-400" />
              <span className="text-[11px] text-cyan-300/70">Launching ASCIIVision...</span>
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
            <div className="flex flex-col items-center gap-3 max-w-md text-center">
              <span className="text-[13px] text-rose-300">Failed to launch ASCIIVision</span>
              <span className="text-[11px] text-stone-400">{error}</span>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-stone-200 hover:bg-white/10"
              >
                Close
              </button>
            </div>
          </div>
        ) : null}
        <div ref={hostRef} className="absolute top-0.5 bottom-4 left-2 right-2 overflow-hidden" />
      </div>
    </div>
  );
}
