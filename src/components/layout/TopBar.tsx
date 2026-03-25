import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { ChevronDown, Settings2, SquareTerminal } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { useAppStore } from "../../store/appStore";
import type { AppPage } from "../../types";
import { shouldStartWindowDrag } from "../../utils/dom";
import { AppMark } from "../AppMark";
import { NavTab } from "../NavTab";

export function TopBar({
  page,
  onSelectPage,
  asciivisionActive,
  controlsOpen,
  controlsRef,
  onToggleControls,
  onToggleRightPanel,
  onToggleTerminal,
  onToggleAsciivision,
}: {
  page: AppPage;
  onSelectPage: (page: AppPage) => void;
  asciivisionActive: boolean;
  controlsOpen: boolean;
  controlsRef: React.RefObject<HTMLDivElement | null>;
  onToggleControls: () => void;
  onToggleRightPanel: () => void;
  onToggleTerminal: () => void;
  onToggleAsciivision: () => void;
}) {
  const toggleSettings = useAppStore((state) => state.toggleSettings);
  const currentWindow = getCurrentWindow();
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const [navIndicator, setNavIndicator] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const nav = navRef.current;
      if (!nav) {
        return;
      }
      const activeTab = nav.querySelector<HTMLButtonElement>(`button[data-page="${page}"]`);
      if (!activeTab) {
        return;
      }
      setNavIndicator({
        left: activeTab.offsetLeft,
        width: activeTab.offsetWidth,
      });
    };

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [page]);

  const handleTopBarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !shouldStartWindowDrag(event.target)) {
      return;
    }

    event.preventDefault();
    void currentWindow.startDragging();
  };

  return (
    <div
      onPointerDown={handleTopBarPointerDown}
      className={clsx(
        "app-titlebar flex select-none items-center gap-3 border-b border-white/6 px-3 py-2",
        asciivisionActive
          ? "bg-black"
          : "bg-[linear-gradient(180deg,rgba(10,11,13,0.98),rgba(8,9,11,0.94))]",
      )}
    >
      <div className="flex items-center gap-2" data-no-drag="true">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setShowCloseConfirm(true);
          }}
          className="h-3 w-3 rounded-full bg-[#ff5f57] shadow-[0_0_0_1px_rgba(0,0,0,0.28)] transition hover:brightness-110"
          aria-label="Close window"
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void currentWindow.minimize();
          }}
          className="h-3 w-3 rounded-full bg-[#ffbd2f] shadow-[0_0_0_1px_rgba(0,0,0,0.28)] transition hover:brightness-110"
          aria-label="Minimize window"
        />
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2.5" data-tauri-drag-region>
        <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-xl border border-white/8 bg-white/5">
          <AppMark className="h-full w-full" />
        </div>
        <p className="app-logo-text truncate text-[13px] font-bold tracking-[0.14em]">Super ASCIIVision</p>
      </div>

      <nav
        ref={navRef}
        className={clsx(
          "relative hidden items-center gap-1 rounded-full border border-white/8 bg-white/[0.03] p-0.5 md:flex transition-opacity duration-200",
          asciivisionActive && "opacity-40 pointer-events-none",
        )}
        data-no-drag="true"
      >
        <div
          className="nav-indicator absolute inset-y-0.5 rounded-full transition-[left,width] duration-300 ease-out"
          style={{ left: navIndicator.left + 2, width: Math.max(navIndicator.width - 4, 0) }}
        />
        <NavTab pageId="chat" active={page === "chat"} onClick={() => onSelectPage("chat")}>
          CHAT
        </NavTab>
        <NavTab pageId="imagine" active={page === "imagine"} onClick={() => onSelectPage("imagine")}>
          IMAGE & VIDEO
        </NavTab>
        <NavTab pageId="voice" active={page === "voice"} onClick={() => onSelectPage("voice")}>
          VOICE & AUDIO
        </NavTab>
        <NavTab pageId="editor" active={page === "editor"} onClick={() => onSelectPage("editor")}>
          MEDIA EDITOR
        </NavTab>
        <NavTab pageId="ide" active={page === "ide"} onClick={() => onSelectPage("ide")}>
          IDE
        </NavTab>
        <NavTab pageId="tiles" active={page === "tiles"} onClick={() => onSelectPage("tiles")}>
          TILES
        </NavTab>
        <NavTab pageId="music" active={page === "music"} onClick={() => onSelectPage("music")}>
          MUSIC
        </NavTab>
        <NavTab pageId="hands" active={page === "hands"} onClick={() => onSelectPage("hands")}>
          HANDS
        </NavTab>
      </nav>

      <div ref={controlsRef} className="relative" data-no-drag="true">
        <button
          type="button"
          onClick={onToggleControls}
          className="inline-flex items-center gap-1 rounded-xl border border-white/8 bg-white/5 px-2 py-1 text-[10px] text-stone-300 transition hover:bg-white/10"
          aria-label="Toggle shell controls"
        >
          Shell
          <ChevronDown className="h-3 w-3" />
        </button>
        {controlsOpen ? (
          <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-48 rounded-[18px] border border-white/8 bg-[#0b0c0d] p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
            <button
              type="button"
              onClick={onToggleRightPanel}
              className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[11px] text-stone-200 transition hover:bg-white/7"
            >
              <span>Sidebar</span>
              <span className="font-['IBM_Plex_Mono'] text-[9px] text-stone-500">Ctrl+Shift+S</span>
            </button>
            <button
              type="button"
              onClick={onToggleTerminal}
              className="mt-1 flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[11px] text-stone-200 transition hover:bg-white/7"
            >
              <span>Terminal</span>
              <span className="font-['IBM_Plex_Mono'] text-[9px] text-stone-500">Ctrl+~</span>
            </button>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onToggleAsciivision}
        className="asciivision-btn group relative inline-flex items-center gap-1.5 overflow-hidden rounded-xl px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] transition"
        aria-label={asciivisionActive ? "Back to App" : "Launch ASCIIVision"}
        data-no-drag="true"
      >
        <span className="asciivision-btn-bg" />
        <SquareTerminal className="relative z-10 h-3.5 w-3.5 text-white drop-shadow-[0_0_4px_rgba(168,85,247,0.5)]" />
        <span className="relative z-10 asciivision-btn-text">{asciivisionActive ? "BACK TO APP" : "ASCIIVISION"}</span>
      </button>

      <button
        type="button"
        onClick={() => toggleSettings()}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/8 bg-white/5 text-stone-300 transition hover:bg-white/10 hover:text-stone-100"
        aria-label="Open settings"
        data-no-drag="true"
      >
        <Settings2 className="h-3.5 w-3.5" />
      </button>
      {showCloseConfirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onPointerDown={() => setShowCloseConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-[24px] border border-white/10 bg-[#0b0c0d] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <p className="text-[10px] uppercase tracking-[0.28em] text-[#84a09b]">Confirm</p>
            <h3 className="mt-2 text-[15px] font-semibold text-stone-100">Quit Super ASCIIVision?</h3>
            <p className="mt-2 text-[11px] text-stone-400">
              This will close all terminal sessions and unsaved work.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCloseConfirm(false)}
                className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-300 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void currentWindow.close()}
                className="rounded-xl border border-rose-400/20 bg-rose-500/12 px-3 py-2 text-[10px] font-semibold text-rose-50 transition hover:bg-rose-500/20"
              >
                Quit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
