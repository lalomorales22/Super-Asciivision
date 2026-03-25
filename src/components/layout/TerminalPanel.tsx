import { FitAddon } from "@xterm/addon-fit";
import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { api } from "../../lib/tauri";
import { useAppStore } from "../../store/appStore";

export function TerminalPanel() {
  const terminalOutput = useAppStore((state) => state.terminalOutput);
  const terminalSessionId = useAppStore((state) => state.terminalSessionId);
  const writeTerminalData = useAppStore((state) => state.writeTerminalData);
  const resizeTerminal = useAppStore((state) => state.resizeTerminal);
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const outputCursorRef = useRef(0);

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) {
      return undefined;
    }

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

    if (terminalOutput) {
      terminal.write(terminalOutput);
      outputCursorRef.current = terminalOutput.length;
    }

    const dataSubscription = terminal.onData((value) => {
      void writeTerminalData(value);
    });

    const resize = () => {
      fitAddon.fit();
      if (terminal.cols > 0 && terminal.rows > 0) {
        void resizeTerminal(terminal.cols, terminal.rows);
      }
    };

    resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
    observer?.observe(host);

    return () => {
      observer?.disconnect();
      dataSubscription.dispose();
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      outputCursorRef.current = 0;
    };
  }, [resizeTerminal, writeTerminalData]);

  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) {
      return;
    }
    if (terminalOutput.length < outputCursorRef.current) {
      terminal.reset();
      outputCursorRef.current = 0;
    }
    const nextChunk = terminalOutput.slice(outputCursorRef.current);
    if (nextChunk) {
      terminal.write(nextChunk);
      outputCursorRef.current = terminalOutput.length;
    }
  }, [terminalOutput]);

  useEffect(() => {
    const terminal = xtermRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon || !terminalSessionId) {
      return;
    }
    fitAddon.fit();
    if (terminal.cols > 0 && terminal.rows > 0) {
      void resizeTerminal(terminal.cols, terminal.rows);
    }
    // Drain early output buffer — the store event listener may not have been
    // ready when the shell printed its first prompt. Send Ctrl+L to clear
    // and redraw a single clean prompt at the correct viewport size.
    const sid = terminalSessionId;
    void (async () => {
      try {
        await api.getTerminalBuffer(sid);
        if (xtermRef.current) {
          void api.writeTerminalInput(sid, "\x0c");
        }
      } catch {
        // Session may not exist — ignore
      }
    })();
  }, [resizeTerminal, terminalSessionId]);

  return (
    <section className="h-full min-h-0 bg-[linear-gradient(180deg,rgba(7,8,9,0.98),rgba(4,5,6,0.98))] px-3 py-3">
      <div className="min-h-0 h-full bg-[#070809]">
        <div
          ref={terminalHostRef}
          className="h-full w-full overflow-hidden rounded-[20px] border border-white/8 bg-[#070809] p-2"
        />
      </div>
    </section>
  );
}
