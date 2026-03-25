import { convertFileSrc } from "@tauri-apps/api/core";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import clsx from "clsx";
import {
  AudioLines,
  ChevronDown,
  Disc3,
  Files,
  FolderPlus,
  Globe,
  Hash,
  ImagePlus,
  ListMusic,
  MessageSquarePlus,
  Music,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCcw,
  Settings2,
  SkipBack,
  SkipForward,
  SquareTerminal,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import hljs from "highlight.js/lib/core";
import hljsBash from "highlight.js/lib/languages/bash";
import hljsGo from "highlight.js/lib/languages/go";
import hljsJava from "highlight.js/lib/languages/java";
import hljsJs from "highlight.js/lib/languages/javascript";
import hljsJson from "highlight.js/lib/languages/json";
import hljsMarkdown from "highlight.js/lib/languages/markdown";
import hljsPython from "highlight.js/lib/languages/python";
import hljsRust from "highlight.js/lib/languages/rust";
import hljsSql from "highlight.js/lib/languages/sql";
import hljsTs from "highlight.js/lib/languages/typescript";
import hljsXml from "highlight.js/lib/languages/xml";
import hljsYaml from "highlight.js/lib/languages/yaml";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { api } from "./lib/tauri";
import { useAppStore } from "./store/appStore";
import type { AppPage, OverlayClip, Settings, SubtitleClip, WorkspaceItem, WorkspaceMediaFile } from "./types";
import { CHAT_MODELS, IMAGE_MODELS, VIDEO_MODELS, XAI_VOICE_OPTIONS } from "./constants";
import { clamp, formatDuration } from "./utils/formatting";
import { leafName } from "./utils/paths";
import { normalizeVoiceId } from "./utils/audio";
import { createEditorClip } from "./utils/editor";
import type { EditorClip } from "./utils/editor";
import { shouldStartWindowDrag, isEditableTarget } from "./utils/dom";
import { AppMark } from "./components/AppMark";
import { BrowserPanel } from "./components/BrowserPanel";
import { EmptyPanel } from "./components/EmptyPanel";
import { NavTab } from "./components/NavTab";
import { ResizeHandle } from "./components/ResizeHandle";
import { ShellChromeContext } from "./components/ShellChromeContext";
import type { ShellChromeActions } from "./components/ShellChromeContext";
import { ChatPage } from "./pages/ChatPage";
import { EditorPage } from "./pages/EditorPage";
import { HandsPage } from "./pages/HandsPage";
import { IdePage } from "./pages/IdePage";
import { ImaginePage } from "./pages/ImaginePage";
import { MusicPage } from "./pages/MusicPage";
import { TilesPage } from "./pages/TilesPage";
import { VoiceAudioPage } from "./pages/VoiceAudioPage";
import { AsciiVisionPanel } from "./components/layout/AsciiVisionPanel";
import { TerminalPanel } from "./components/layout/TerminalPanel";

// Register highlight.js languages
hljs.registerLanguage("bash", hljsBash);
hljs.registerLanguage("sh", hljsBash);
hljs.registerLanguage("shell", hljsBash);
hljs.registerLanguage("go", hljsGo);
hljs.registerLanguage("java", hljsJava);
hljs.registerLanguage("javascript", hljsJs);
hljs.registerLanguage("js", hljsJs);
hljs.registerLanguage("json", hljsJson);
hljs.registerLanguage("markdown", hljsMarkdown);
hljs.registerLanguage("md", hljsMarkdown);
hljs.registerLanguage("python", hljsPython);
hljs.registerLanguage("py", hljsPython);
hljs.registerLanguage("rust", hljsRust);
hljs.registerLanguage("rs", hljsRust);
hljs.registerLanguage("sql", hljsSql);
hljs.registerLanguage("typescript", hljsTs);
hljs.registerLanguage("ts", hljsTs);
hljs.registerLanguage("tsx", hljsTs);
hljs.registerLanguage("xml", hljsXml);
hljs.registerLanguage("html", hljsXml);
hljs.registerLanguage("yaml", hljsYaml);
hljs.registerLanguage("yml", hljsYaml);

type RightPanelMode = "workspace" | "browser";
type DragMode = "left" | "right" | "footer";

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  startValue: number;
}


interface ConversationContextMenuState {
  conversation: {
    id: string;
    title: string;
    pinned: boolean;
  };
  x: number;
  y: number;
}

interface ConversationRenameState {
  id: string;
  title: string;
}

function App() {
  const initialize = useAppStore((state) => state.initialize);
  const booting = useAppStore((state) => state.booting);
  const error = useAppStore((state) => state.error);
  const clearError = useAppStore((state) => state.clearError);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const suppress = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", suppress);
    return () => document.removeEventListener("contextmenu", suppress);
  }, []);

  useEffect(() => {
    if (!error) {
      return undefined;
    }
    const timer = window.setTimeout(() => clearError(), 5000);
    return () => window.clearTimeout(timer);
  }, [clearError, error]);

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent px-4 py-6 font-['Manrope'] text-stone-200">
        <div className="w-full max-w-3xl rounded-[30px] border border-white/8 bg-[#070809] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.62)]">
          <p className="text-[10px] uppercase tracking-[0.42em] text-[#7a9a96]">Super ASCIIVision</p>
          <h1 className="mt-4 text-[26px] font-semibold text-stone-100">Loading…</h1>
          <p className="mt-2 text-[12px] text-stone-500">
            Restoring chats, gallery, terminal session, and workspace state.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent p-1 font-['Manrope'] text-[11px] text-stone-100">
      <GrokShell />
      {error ? (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto w-fit rounded-full border border-rose-300/18 bg-rose-500/12 px-3 py-1.5 text-[11px] text-rose-100 shadow-lg backdrop-blur-xl">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function GrokShell() {
  const settingsOpen = useAppStore((state) => state.settingsOpen);
  const toggleSettings = useAppStore((state) => state.toggleSettings);
  const openBrowserPreviewInStore = useAppStore((state) => state.openBrowserPreview);
  const [page, setPage] = useState<AppPage>("chat");
  const [uiZoom, setUiZoom] = useState(100);
  const [asciivisionActive, setAsciivisionActive] = useState(false);
  const [miniPlayerHidden, setMiniPlayerHidden] = useState(false);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("workspace");
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [leftWidth, setLeftWidth] = useState(210);
  const [rightWidth, setRightWidth] = useState(340);
  const [footerHeight, setFooterHeight] = useState(220);
  const [editorClips, setEditorClips] = useState<EditorClip[]>([]);
  const [activeEditorClipId, setActiveEditorClipId] = useState<string>();
  const [subtitleClips, setSubtitleClips] = useState<SubtitleClip[]>([]);
  const [overlayClips, setOverlayClips] = useState<OverlayClip[]>([]);
  const [editorAspect, setEditorAspect] = useState<"landscape" | "vertical">("landscape");
  const editorClipboardRef = useRef<EditorClip | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!dragState) {
      return undefined;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (dragState.mode === "left") {
        setLeftWidth(dragState.startValue + (event.clientX - dragState.startX));
        return;
      }
      if (dragState.mode === "right") {
        setRightWidth(dragState.startValue - (event.clientX - dragState.startX));
        return;
      }
      setFooterHeight(dragState.startValue - (event.clientY - dragState.startY));
    };

    const onPointerUp = () => setDragState(null);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragState]);

  useEffect(() => {
    if (!controlsOpen) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) {
        setControlsOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [controlsOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.altKey && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        setUiZoom((z) => Math.min(z + 10, 150));
        return;
      }
      if (mod && !event.altKey && event.key === "-") {
        event.preventDefault();
        setUiZoom((z) => Math.max(z - 10, 60));
        return;
      }
      if (mod && !event.altKey && event.key === "0") {
        event.preventDefault();
        setUiZoom(100);
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "`" || event.key === "~")) {
        event.preventDefault();
        setTerminalVisible((value) => !value);
        setControlsOpen(false);
        return;
      }

      if (event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setRightPanelVisible((value) => !value);
        setControlsOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const clampedLeftWidth = clamp(leftWidth, 180, Math.max(180, Math.floor(viewport.width * 0.28)));
  const showHistoryRail = page === "chat" && !asciivisionActive;
  const showShellRightSidebar = page !== "tiles" && page !== "ide" && page !== "hands" && rightPanelVisible && !asciivisionActive;
  const clampedRightWidth = showShellRightSidebar
    ? clamp(rightWidth, 280, Math.max(280, Math.floor(viewport.width * 0.42)))
    : 0;
  const clampedFooterHeight = terminalVisible && !asciivisionActive
    ? clamp(footerHeight, 150, Math.max(150, Math.floor(viewport.height * 0.42)))
    : 0;
  const musicCurrentIndex = useAppStore((state) => state.musicCurrentIndex);
  const musicTracks = useAppStore((state) => state.musicTracks);
  const showMusicMiniPlayer = musicCurrentIndex >= 0 && musicCurrentIndex < musicTracks.length && !asciivisionActive && !miniPlayerHidden;
  const chromeActions = useMemo<ShellChromeActions>(
    () => ({
      openBrowserPreview: (html) => {
        openBrowserPreviewInStore(html);
        setRightPanelVisible(true);
        setRightPanelMode("browser");
      },
      openEditorAsset: (asset) => {
        // Images, videos, and audio all go into editorClips —
        // buildTimelineTrack routes them to Visual (image/video) or Audio (audio)
        const clip = createEditorClip(asset);
        setEditorClips((current) => [...current, clip]);
        setActiveEditorClipId(clip.id);
        setPage("editor");
      },
    }),
    [openBrowserPreviewInStore],
  );

  return (
    <ShellChromeContext.Provider value={chromeActions}>
      <main
        className="h-[calc(100vh-8px)] w-full bg-transparent p-1"
        style={uiZoom !== 100 ? { zoom: `${uiZoom}%` } : undefined}
      >
        <div
          className={clsx(
            "relative grid h-full min-h-0 overflow-hidden rounded-[34px] border border-white/[0.05] shadow-[0_32px_120px_rgba(0,0,0,0.72)]",
            asciivisionActive
              ? "bg-black"
              : "bg-[radial-gradient(circle_at_top_left,rgba(26,34,33,0.32),rgba(6,7,8,0.985)_42%)]",
          )}
          style={{
            gridTemplateColumns: showHistoryRail
              ? `${clampedLeftWidth}px 8px minmax(0,1fr) ${showShellRightSidebar ? 8 : 0}px ${clampedRightWidth}px`
              : `minmax(0,1fr) ${showShellRightSidebar ? 8 : 0}px ${clampedRightWidth}px`,
            gridTemplateRows: [
              "58px",
              "minmax(0,1fr)",
              showMusicMiniPlayer ? "48px" : "",
              terminalVisible && page !== "tiles" && !asciivisionActive ? `8px ${clampedFooterHeight}px` : "",
            ].filter(Boolean).join(" "),
          }}
        >
          <div className="col-[1/-1]">
            <TopBar
              page={page}
              onSelectPage={(p) => { setAsciivisionActive(false); setPage(p); if (p === "music") setMiniPlayerHidden(false); }}
              asciivisionActive={asciivisionActive}
              controlsOpen={controlsOpen}
              controlsRef={controlsRef}
              onToggleControls={() => setControlsOpen((value) => !value)}
              onToggleRightPanel={() => {
                setRightPanelVisible((value) => !value);
                setControlsOpen(false);
              }}
              onToggleAsciivision={() => setAsciivisionActive((v) => !v)}
              onToggleTerminal={() => {
                setTerminalVisible((value) => !value);
                setControlsOpen(false);
              }}
            />
          </div>

          {showHistoryRail ? <HistoryRail /> : null}
          {showHistoryRail ? (
            <ResizeHandle
              orientation="vertical"
              onPointerDown={(event) =>
                setDragState({
                  mode: "left",
                  startX: event.clientX,
                  startY: event.clientY,
                  startValue: clampedLeftWidth,
                })
              }
            />
          ) : null}

          <section className={clsx("flex min-h-0 flex-col overflow-hidden", asciivisionActive ? "bg-black" : "bg-[linear-gradient(180deg,rgba(10,11,13,0.98),rgba(7,8,10,0.97))]")}>
            {asciivisionActive ? (
              <AsciiVisionPanel onClose={() => setAsciivisionActive(false)} />
            ) : <CenterStage
              page={page}
              onNavigate={setPage}
              onShowBrowser={() => setRightPanelMode("browser")}
              editorClips={editorClips}
              activeEditorClipId={activeEditorClipId}
              onSelectEditorClip={setActiveEditorClipId}
              onUpdateEditorClip={(clipId, patch) =>
                setEditorClips((current) =>
                  current.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)),
                )
              }
              onRemoveEditorClip={(clipId) => {
                setEditorClips((current) => current.filter((clip) => clip.id !== clipId));
                setActiveEditorClipId((current) => (current === clipId ? undefined : current));
              }}
              onAddEditorClip={(clip: EditorClip) => {
                setEditorClips((current) => [...current, clip]);
                setActiveEditorClipId(clip.id);
              }}
              onReorderClips={(newClips: EditorClip[]) => setEditorClips(newClips)}
              onClearEditor={() => {
                setEditorClips([]);
                setActiveEditorClipId(undefined);
                setSubtitleClips([]);
                setOverlayClips([]);
              }}
              subtitleClips={subtitleClips}
              onAddSubtitle={(sub) => setSubtitleClips((c) => [...c, sub])}
              onUpdateSubtitle={(id, patch) => setSubtitleClips((c) => c.map((s) => (s.id === id ? { ...s, ...patch } : s)))}
              onRemoveSubtitle={(id) => setSubtitleClips((c) => c.filter((s) => s.id !== id))}
              overlayClips={overlayClips}
              onAddOverlay={(ov) => setOverlayClips((c) => [...c, ov])}
              onUpdateOverlay={(id, patch) => setOverlayClips((c) => c.map((o) => (o.id === id ? { ...o, ...patch } : o)))}
              onRemoveOverlay={(id) => setOverlayClips((c) => c.filter((o) => o.id !== id))}
              editorAspect={editorAspect}
              onSetEditorAspect={setEditorAspect}
              editorClipboardRef={editorClipboardRef}
            />}
          </section>

          {showShellRightSidebar ? (
            <ResizeHandle
              orientation="vertical"
              onPointerDown={(event) =>
                setDragState({
                  mode: "right",
                  startX: event.clientX,
                  startY: event.clientY,
                  startValue: clampedRightWidth,
                })
              }
            />
          ) : (
            <div />
          )}

          {showShellRightSidebar ? (
            <RightSidebar
              page={page}
              mode={rightPanelMode}
              onSelectMode={setRightPanelMode}
            />
          ) : (
            <div />
          )}

          {showMusicMiniPlayer ? (
            <div className="col-[1/-1] border-t border-white/6 bg-[linear-gradient(180deg,rgba(10,11,13,0.98),rgba(8,9,11,0.96))]">
              <MusicMiniPlayer onExpand={() => { setAsciivisionActive(false); setPage("music"); }} onHide={() => setMiniPlayerHidden(true)} />
            </div>
          ) : null}

          {terminalVisible && page !== "tiles" ? (
            <>
              <div className="col-[1/-1]">
                <ResizeHandle
                  orientation="horizontal"
                  onPointerDown={(event) =>
                    setDragState({
                      mode: "footer",
                      startX: event.clientX,
                      startY: event.clientY,
                      startValue: clampedFooterHeight,
                    })
                  }
                />
              </div>
              <div className="col-[1/-1] min-h-0 overflow-hidden">
                <TerminalPanel />
              </div>
            </>
          ) : null}
          {uiZoom !== 100 ? (
            <button
              type="button"
              onClick={() => setUiZoom(100)}
              className="absolute bottom-3 right-3 z-50 rounded-full border border-white/10 bg-black/70 px-2.5 py-1 font-['IBM_Plex_Mono'] text-[10px] text-stone-300 shadow-lg backdrop-blur-md transition hover:bg-white/10"
              title="Click to reset zoom (Cmd+0)"
            >
              {uiZoom}%
            </button>
          ) : null}
        </div>
      </main>
      {settingsOpen ? <SettingsSheet onClose={() => toggleSettings(false)} /> : null}
    </ShellChromeContext.Provider>
  );
}

function TopBar({
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

function HistoryRail() {
  const conversations = useAppStore((state) => state.conversations);
  const activeConversationId = useAppStore((state) => state.activeConversation?.conversation.id);
  const createConversation = useAppStore((state) => state.createConversation);
  const loadConversation = useAppStore((state) => state.loadConversation);
  const renameConversation = useAppStore((state) => state.renameConversation);
  const toggleConversationPin = useAppStore((state) => state.toggleConversationPin);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  const [contextMenu, setContextMenu] = useState<ConversationContextMenuState>();
  const [renameDialog, setRenameDialog] = useState<ConversationRenameState>();
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const dismiss = () => setContextMenu(undefined);
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [contextMenu]);

  const openRenameDialog = (conversationId: string, title: string) => {
    setRenameDraft(title);
    setRenameDialog({ id: conversationId, title });
  };

  const submitRename = async () => {
    if (!renameDialog) {
      return;
    }
    const nextTitle = renameDraft.trim();
    if (!nextTitle) {
      return;
    }
    await renameConversation(renameDialog.id, nextTitle);
    setRenameDialog(undefined);
  };

  return (
    <aside className="flex min-h-0 flex-col bg-[linear-gradient(180deg,rgba(8,9,11,0.98),rgba(5,6,8,0.95))]">
      <div className="border-b border-white/6 px-2.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">History</p>
            <h2 className="mt-1 text-[12px] font-semibold text-stone-100">Chats</h2>
          </div>
          <button
            type="button"
            onClick={() => void createConversation()}
            className="inline-flex items-center gap-1 rounded-xl border border-white/8 bg-white/5 px-2 py-1 text-[10px] text-stone-200 transition hover:bg-white/10"
          >
            <MessageSquarePlus className="h-3 w-3" />
            New
          </button>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 py-2">
        {conversations.length ? (
          conversations.map((conversation) => (
            <ConversationCard
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeConversationId}
              onOpen={() => void loadConversation(conversation.id)}
              onTogglePin={() => void toggleConversationPin(conversation.id, !conversation.pinned)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({
                  conversation: {
                    id: conversation.id,
                    title: conversation.title,
                    pinned: conversation.pinned,
                  },
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            />
          ))
        ) : (
          <EmptyPanel
            eyebrow="No chats"
            title="Start a new thread."
            body="Every chat is kept in this rail so you can jump back into older coding sessions."
          />
        )}
      </div>
      {contextMenu ? (
        <div
          className="fixed z-50 w-44 rounded-[18px] border border-white/8 bg-[#0b0c0d] p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.45)]"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 188),
            top: Math.min(contextMenu.y, window.innerHeight - 156),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setContextMenu(undefined);
              void toggleConversationPin(contextMenu.conversation.id, !contextMenu.conversation.pinned);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-stone-200 transition hover:bg-white/7"
          >
            <Pin className="h-3.5 w-3.5" />
            {contextMenu.conversation.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            onClick={() => {
              const { id, title } = contextMenu.conversation;
              setContextMenu(undefined);
              openRenameDialog(id, title);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-stone-200 transition hover:bg-white/7"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(undefined);
              void deleteConversation(contextMenu.conversation.id);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-rose-100 transition hover:bg-rose-500/15"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      ) : null}
      {renameDialog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onPointerDown={() => setRenameDialog(undefined)}
        >
          <div
            className="w-full max-w-sm rounded-[24px] border border-white/10 bg-[#0b0c0d] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <p className="text-[10px] uppercase tracking-[0.28em] text-[#84a09b]">Rename Chat</p>
            <h3 className="mt-2 text-[15px] font-semibold text-stone-100">Edit conversation title</h3>
            <input
              autoFocus
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitRename();
                }
                if (event.key === "Escape") {
                  setRenameDialog(undefined);
                }
              }}
              className="mt-4 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2.5 text-[12px] text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/35"
              placeholder="Conversation title"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameDialog(undefined)}
                className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-300 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitRename()}
                disabled={!renameDraft.trim()}
                className="rounded-xl border border-emerald-300/20 bg-emerald-300/12 px-3 py-2 text-[10px] font-semibold text-emerald-50 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/5 disabled:text-stone-500"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function ConversationCard({
  conversation,
  active,
  onOpen,
  onTogglePin,
  onContextMenu,
}: {
  conversation: { id: string; title: string; pinned: boolean; previewText?: string | null; modelId?: string | null };
  active: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className={clsx(
        "group w-full rounded-[16px] border px-2 py-2 text-left transition",
        active
          ? "border-emerald-200/18 bg-emerald-300/8"
          : "border-white/6 bg-white/[0.025] hover:bg-white/[0.05]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[11px] font-semibold text-stone-100">{conversation.title}</p>
            {conversation.pinned ? (
              <span className="rounded-full border border-amber-300/18 bg-amber-300/10 px-1.5 py-0.5 font-['IBM_Plex_Mono'] text-[8px] uppercase tracking-[0.18em] text-amber-100">
                Pinned
              </span>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-[10px] leading-[1.1rem] text-stone-500">
            {conversation.previewText ?? "No preview yet"}
          </p>
          <p className="mt-2 font-['IBM_Plex_Mono'] text-[9px] text-stone-600">
            {conversation.modelId ?? "awaiting model"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onTogglePin();
            }}
            className="rounded-lg border border-white/8 bg-black/30 p-1 text-stone-300 hover:bg-white/8"
            aria-label={conversation.pinned ? "Unpin conversation" : "Pin conversation"}
          >
            <Pin className="h-3 w-3" />
          </button>
        </div>
      </div>
    </button>
  );
}

function CenterStage({
  page,
  onNavigate,
  onShowBrowser,
  editorClips,
  activeEditorClipId,
  onSelectEditorClip,
  onUpdateEditorClip,
  onRemoveEditorClip,
  onAddEditorClip,
  onReorderClips,
  onClearEditor,
  subtitleClips,
  onAddSubtitle,
  onUpdateSubtitle,
  onRemoveSubtitle,
  overlayClips,
  onAddOverlay,
  onUpdateOverlay,
  onRemoveOverlay,
  editorAspect,
  onSetEditorAspect,
  editorClipboardRef,
}: {
  page: AppPage;
  onNavigate: (page: AppPage) => void;
  onShowBrowser: () => void;
  editorClips: EditorClip[];
  activeEditorClipId?: string;
  onSelectEditorClip: (clipId?: string) => void;
  onUpdateEditorClip: (clipId: string, patch: Partial<EditorClip>) => void;
  onRemoveEditorClip: (clipId: string) => void;
  onAddEditorClip: (clip: EditorClip) => void;
  onReorderClips: (clips: EditorClip[]) => void;
  onClearEditor: () => void;
  subtitleClips: SubtitleClip[];
  onAddSubtitle: (sub: SubtitleClip) => void;
  onUpdateSubtitle: (id: string, patch: Partial<SubtitleClip>) => void;
  onRemoveSubtitle: (id: string) => void;
  overlayClips: OverlayClip[];
  onAddOverlay: (ov: OverlayClip) => void;
  onUpdateOverlay: (id: string, patch: Partial<OverlayClip>) => void;
  onRemoveOverlay: (id: string) => void;
  editorAspect: "landscape" | "vertical";
  onSetEditorAspect: (aspect: "landscape" | "vertical") => void;
  editorClipboardRef: React.MutableRefObject<EditorClip | null>;
}) {
  let content: React.ReactNode;
  if (page === "tiles") {
    content = <TilesPage />;
  } else if (page === "imagine") {
    content = <ImaginePage onShowBrowser={onShowBrowser} />;
  } else if (page === "voice") {
    content = <VoiceAudioPage onShowBrowser={onShowBrowser} />;
  } else if (page === "editor") {
    content = (
      <EditorPage
        clips={editorClips}
        activeClipId={activeEditorClipId}
        onSelectClip={onSelectEditorClip}
        onUpdateClip={onUpdateEditorClip}
        onRemoveClip={onRemoveEditorClip}
        onAddClip={onAddEditorClip}
        onReorderClips={onReorderClips}
        onClear={onClearEditor}
        subtitleClips={subtitleClips}
        onAddSubtitle={onAddSubtitle}
        onUpdateSubtitle={onUpdateSubtitle}
        onRemoveSubtitle={onRemoveSubtitle}
        overlayClips={overlayClips}
        onAddOverlay={onAddOverlay}
        onUpdateOverlay={onUpdateOverlay}
        onRemoveOverlay={onRemoveOverlay}
        editorAspect={editorAspect}
        onSetEditorAspect={onSetEditorAspect}
        clipboardRef={editorClipboardRef}
      />
    );
  } else if (page === "ide") {
    content = <IdePage onShowBrowser={onShowBrowser} />;
  } else if (page === "music") {
    content = <MusicPage />;
  } else if (page === "hands") {
    content = <HandsPage onNavigate={onNavigate} />;
  } else {
    content = <ChatPage />;
  }
  return (
    <div key={page} className="flex h-full min-h-0 flex-col overflow-hidden [animation:page-swap_220ms_ease-out]">
      {content}
    </div>
  );
}

// VoiceAudioPage extracted to ./pages/VoiceAudioPage.tsx

// IdeCodeEditor + IdePage extracted to ./pages/IdePage.tsx

function MusicSidebar() {
  const musicCategories = useAppStore((s) => s.musicCategories);
  const musicTracks = useAppStore((s) => s.musicTracks);
  const activeMusicCategory = useAppStore((s) => s.activeMusicCategory);
  const setActiveMusicCategory = useAppStore((s) => s.setActiveMusicCategory);
  const refreshMusicCategories = useAppStore((s) => s.refreshMusicCategories);
  const createMusicCategory = useAppStore((s) => s.createMusicCategory);
  const deleteMusicCategory = useAppStore((s) => s.deleteMusicCategory);
  const importMusicFiles = useAppStore((s) => s.importMusicFiles);
  const refreshMusicLibrary = useAppStore((s) => s.refreshMusicLibrary);

  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Load categories on mount
  useEffect(() => {
    void refreshMusicCategories();
  }, []);

  const handleCreatePlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    try {
      await createMusicCategory(name);
      setNewPlaylistName("");
      setShowNewPlaylist(false);
    } catch (err) {
      console.error("Failed to create playlist:", err);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const audioExts = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "wma"]);
    const audioPaths = files
      .filter((f) => {
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
        return audioExts.has(ext);
      })
      .map((f) => (f as unknown as { path?: string }).path)
      .filter((p): p is string => !!p);

    if (audioPaths.length) {
      try {
        const count = await importMusicFiles(audioPaths, activeMusicCategory);
        if (count > 0) void refreshMusicLibrary();
      } catch (err) {
        console.error("Import failed:", err);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleImportClick = async () => {
    try {
      const selection = await openDialog({
        multiple: true,
        filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "wma"] }],
      });
      if (!selection) return;
      const paths = Array.isArray(selection) ? selection : [selection];
      const validPaths = paths.filter((p): p is string => typeof p === "string");
      if (validPaths.length) {
        const count = await importMusicFiles(validPaths, activeMusicCategory);
        if (count > 0) void refreshMusicLibrary();
      }
    } catch (err) {
      console.error("Import dialog failed:", err);
    }
  };

  const handleAddFolder = async () => {
    try {
      const selection = await openDialog({ directory: true, multiple: false });
      if (typeof selection === "string") {
        // Use the folder name as category name, import all audio files from it
        const folderName = selection.split("/").pop() ?? selection.split("\\").pop() ?? "Imported";
        // Create category first
        try { await createMusicCategory(folderName); } catch { /* may already exist */ }
        // Walk the folder and import files
        // We tell the backend to import from this source folder into the target category
        await importMusicFiles([selection], folderName);
      }
    } catch (err) {
      console.error("Add folder failed:", err);
    }
  };

  // Count tracks with no category (root level)
  const rootTrackCount = musicTracks.filter((t) => !t.category).length;

  return (
    <aside
      className="flex min-h-0 flex-col bg-[linear-gradient(180deg,rgba(10,11,13,0.98),rgba(7,8,10,0.95))]"
      onDrop={(e) => void handleDrop(e)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Header */}
      <div className="border-b border-white/6 px-3 py-3">
        <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">Music Library</p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleImportClick()}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-emerald-300/18 bg-emerald-300/10 px-3 py-2 text-[10px] text-emerald-50 transition hover:bg-emerald-300/16"
          >
            <Plus className="h-3 w-3" />
            Import Files
          </button>
          <button
            type="button"
            onClick={() => void handleAddFolder()}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-200 transition hover:bg-white/10"
          >
            <FolderPlus className="h-3 w-3" />
            Add Folder
          </button>
        </div>
      </div>

      {/* Library / categories list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* All Tracks */}
        <button
          type="button"
          onClick={() => setActiveMusicCategory(undefined)}
          className={clsx(
            "flex w-full items-center gap-3 px-4 py-2.5 text-left transition",
            !activeMusicCategory
              ? "bg-emerald-300/[0.08] border-r-2 border-emerald-400"
              : "hover:bg-white/[0.03]",
          )}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-emerald-500/15 to-sky-500/10">
            <Music className="h-3.5 w-3.5 text-emerald-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className={clsx("text-[11px] font-semibold", !activeMusicCategory ? "text-emerald-200" : "text-stone-200")}>
              All Tracks
            </p>
            <p className="text-[9px] text-stone-500">{musicTracks.length} track{musicTracks.length !== 1 ? "s" : ""}</p>
          </div>
        </button>

        {/* Uncategorized (root files) */}
        {rootTrackCount > 0 && rootTrackCount < musicTracks.length ? (
          <button
            type="button"
            onClick={() => setActiveMusicCategory("__uncategorized__")}
            className={clsx(
              "flex w-full items-center gap-3 px-4 py-2.5 text-left transition",
              activeMusicCategory === "__uncategorized__"
                ? "bg-emerald-300/[0.08] border-r-2 border-emerald-400"
                : "hover:bg-white/[0.03]",
            )}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
              <ListMusic className="h-3.5 w-3.5 text-stone-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className={clsx("text-[11px] font-medium", activeMusicCategory === "__uncategorized__" ? "text-emerald-200" : "text-stone-300")}>
                Uncategorized
              </p>
              <p className="text-[9px] text-stone-500">{rootTrackCount} track{rootTrackCount !== 1 ? "s" : ""}</p>
            </div>
          </button>
        ) : null}

        {/* Divider + Categories heading */}
        {musicCategories.length > 0 || showNewPlaylist ? (
          <div className="flex items-center justify-between border-t border-white/6 px-4 py-2">
            <span className="text-[9px] uppercase tracking-[0.3em] text-stone-500">Playlists & Folders</span>
            <button
              type="button"
              onClick={() => setShowNewPlaylist(true)}
              className="rounded p-0.5 text-stone-400 transition hover:bg-white/8 hover:text-stone-200"
              title="New Playlist"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between border-t border-white/6 px-4 py-2">
            <span className="text-[9px] uppercase tracking-[0.3em] text-stone-500">Playlists & Folders</span>
            <button
              type="button"
              onClick={() => setShowNewPlaylist(true)}
              className="rounded p-0.5 text-stone-400 transition hover:bg-white/8 hover:text-stone-200"
              title="New Playlist"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* New playlist input */}
        {showNewPlaylist ? (
          <div className="flex items-center gap-2 px-4 py-2">
            <input
              autoFocus
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreatePlaylist();
                if (e.key === "Escape") { setShowNewPlaylist(false); setNewPlaylistName(""); }
              }}
              placeholder="Playlist name..."
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/30"
            />
            <button
              type="button"
              onClick={() => void handleCreatePlaylist()}
              disabled={!newPlaylistName.trim()}
              className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-2 py-1.5 text-[10px] text-emerald-50 transition hover:bg-emerald-300/16 disabled:opacity-40"
            >
              Create
            </button>
          </div>
        ) : null}

        {/* Category list */}
        {musicCategories.map((cat) => (
          <div key={cat.path} className="group relative">
            <button
              type="button"
              onClick={() => setActiveMusicCategory(cat.name)}
              className={clsx(
                "flex w-full items-center gap-3 px-4 py-2 text-left transition",
                activeMusicCategory === cat.name
                  ? "bg-emerald-300/[0.08] border-r-2 border-emerald-400"
                  : "hover:bg-white/[0.03]",
              )}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-purple-500/12 to-pink-500/10">
                <Hash className="h-3.5 w-3.5 text-purple-300" />
              </div>
              <div className="min-w-0 flex-1">
                <p className={clsx("truncate text-[11px] font-medium", activeMusicCategory === cat.name ? "text-emerald-200" : "text-stone-200")}>
                  {cat.name}
                </p>
                <p className="text-[9px] text-stone-500">{cat.trackCount} track{cat.trackCount !== 1 ? "s" : ""}</p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteMusicCategory(cat.path);
                  if (activeMusicCategory === cat.name) setActiveMusicCategory(undefined);
                }}
                className="rounded p-1 text-stone-600 opacity-0 transition hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </button>
          </div>
        ))}

        {/* Empty state for categories */}
        {musicCategories.length === 0 && !showNewPlaylist ? (
          <div className="px-4 py-4 text-center">
            <p className="text-[10px] text-stone-500 leading-4">
              Add folders of music or create playlists to organize your library.
            </p>
          </div>
        ) : null}
      </div>

      {/* Drop zone overlay */}
      {dragOver ? (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-400/50 bg-emerald-400/[0.06] backdrop-blur-sm">
          <Music className="h-8 w-8 text-emerald-300 mb-2" />
          <p className="text-[12px] font-semibold text-emerald-200">Drop audio files here</p>
          <p className="text-[10px] text-emerald-300/60 mt-1">
            {activeMusicCategory ? `Adding to "${activeMusicCategory}"` : "Adding to library"}
          </p>
        </div>
      ) : null}
    </aside>
  );
}

function RightSidebar({
  page,
  mode,
  onSelectMode,
}: {
  page: AppPage;
  mode: RightPanelMode;
  onSelectMode: (mode: RightPanelMode) => void;
}) {
  if (page === "music") return <MusicSidebar />;

  return (
    <aside className="flex min-h-0 flex-col bg-[linear-gradient(180deg,rgba(10,11,13,0.98),rgba(7,8,10,0.95))]">
      <div className="border-b border-white/6 px-3 py-3">
        <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">Right Sidebar</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onSelectMode("workspace")}
            className={clsx(
              "inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[11px] transition",
              mode === "workspace"
                ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/10",
            )}
          >
            <Files className="h-3.5 w-3.5" />
            Workspace
          </button>
          <button
            type="button"
            onClick={() => onSelectMode("browser")}
            className={clsx(
              "inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[11px] transition",
              mode === "browser"
                ? "border-sky-300/20 bg-sky-300/12 text-sky-50"
                : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/10",
            )}
          >
            <Globe className="h-3.5 w-3.5" />
            Browser
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {mode === "workspace" ? <WorkspaceDrawer page={page} /> : <BrowserPanel />}
      </div>
    </aside>
  );
}

function WorkspaceDrawer({ page }: { page: AppPage }) {
  const chrome = useContext(ShellChromeContext);
  const workspaces = useAppStore((state) => state.workspaces);
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
  const workspaceItemsMap = useAppStore((state) => state.workspaceItems);
  const workspaceSelection = useAppStore((state) => state.workspaceSelection);
  const scanningWorkspaceId = useAppStore((state) => state.scanningWorkspaceId);
  const addFilesToWorkspace = useAppStore((state) => state.addFilesToWorkspace);
  const removeWorkspaceFile = useAppStore((state) => state.removeWorkspaceFile);
  const deleteWorkspace = useAppStore((state) => state.deleteWorkspace);
  const scanWorkspace = useAppStore((state) => state.scanWorkspace);
  const toggleWorkspaceItem = useAppStore((state) => state.toggleWorkspaceItem);
  const importLocalMediaAsset = useAppStore((state) => state.importLocalMediaAsset);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const workspaceItems = activeWorkspaceId ? workspaceItemsMap[activeWorkspaceId] ?? [] : [];
  const [, setWorkspaceMedia] = useState<WorkspaceMediaFile[]>([]);
  const [, setWorkspaceMediaLoading] = useState(false);
  const [importingPath, setImportingPath] = useState<string>();
  const [dragOver, setDragOver] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<{ path: string; name: string }[]>([]);
  const workspaceMediaKinds =
    page === "voice" ? ["audio"] : page === "imagine" ? ["image", "video"] : ["image", "video", "audio"];
  const isTextWorkspace = page === "chat" || page === "ide";
  const isMediaWorkspace = page === "imagine" || page === "voice" || page === "editor";

  useEffect(() => {
    if (isTextWorkspace || !activeWorkspaceId) {
      setWorkspaceMedia([]);
      return;
    }

    let cancelled = false;
    setWorkspaceMediaLoading(true);
    void api
      .listWorkspaceMedia(activeWorkspaceId)
      .then((items) => {
        if (!cancelled) {
          setWorkspaceMedia(items.filter((item) => workspaceMediaKinds.includes(item.kind)));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceMedia([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWorkspaceMediaLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.lastScannedAt, activeWorkspace?.roots, activeWorkspaceId, isTextWorkspace, page]);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const unlisten = currentWindow.onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setDragOver(true);
      } else if (event.payload.type === "drop") {
        setDragOver(false);
        const paths = (event.payload as { type: string; paths: string[] }).paths;
        if (paths?.length) {
          if (isMediaWorkspace) {
            setStagedFiles((prev) => {
              const existing = new Set(prev.map((f) => f.path));
              const next = [...prev];
              for (const p of paths) {
                if (!existing.has(p)) {
                  next.push({ path: p, name: p.split("/").pop() ?? p });
                }
              }
              return next;
            });
          } else {
            void addFilesToWorkspace(paths);
          }
        }
      } else {
        setDragOver(false);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [addFilesToWorkspace, importLocalMediaAsset, isMediaWorkspace]);

  const workspaceHeading =
    page === "imagine"
      ? "Import Media"
      : page === "voice"
        ? "Import Audio"
        : page === "ide"
          ? "Workspace"
        : page === "editor"
          ? "Editor Sources"
          : "Workspace";
  const workspaceBody =
    page === "imagine"
      ? "Drop images or videos here to add them to your gallery, or use the + button."
      : page === "voice"
        ? "Drop audio files here to add them to your gallery, or use the + button."
        : page === "ide"
          ? "Select or rescan a workspace here, then use the IDE page to browse and edit its indexed text files."
        : page === "editor"
          ? "Pull image, video, and audio files from the active workspace into the media editor."
          : "Drop files or folders to add as prompt context.";

  const handleAddFiles = async () => {
    const selection = await openDialog({ directory: false, multiple: true });
    const paths =
      typeof selection === "string"
        ? [selection]
        : Array.isArray(selection)
          ? selection.filter((value): value is string => typeof value === "string")
          : [];
    if (!paths.length) return;
    if (isMediaWorkspace) {
      setStagedFiles((prev) => {
        const existing = new Set(prev.map((f) => f.path));
        const next = [...prev];
        for (const p of paths) {
          if (!existing.has(p)) {
            next.push({ path: p, name: p.split("/").pop() ?? p });
          }
        }
        return next;
      });
    } else {
      void addFilesToWorkspace(paths);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/6 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold text-stone-100">{workspaceHeading}</h2>
            <p className="mt-1 text-[10px] text-stone-500">{workspaceBody}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleAddFiles()}
            className="rounded-xl border border-white/8 bg-white/5 p-2 text-stone-200 transition hover:bg-white/10"
            aria-label="Add files"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {activeWorkspaceId && isTextWorkspace ? (
        <div className="flex items-center justify-between border-b border-white/6 px-4 py-2">
          <p className="truncate text-[10px] text-stone-400">{activeWorkspace?.name ?? "Workspace"}</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void scanWorkspace(activeWorkspaceId)}
              className="rounded-lg p-1.5 text-stone-400 transition hover:bg-white/8 hover:text-stone-200"
              aria-label="Rescan"
            >
              <RefreshCcw className={clsx("h-3.5 w-3.5", scanningWorkspaceId === activeWorkspaceId && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={() => void deleteWorkspace(activeWorkspaceId)}
              className="rounded-lg p-1.5 text-stone-400 transition hover:bg-rose-500/15 hover:text-rose-200"
              aria-label="Remove workspace"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {isMediaWorkspace ? (
          <>
            <div
              className={clsx(
                "flex flex-col items-center justify-center rounded-[18px] border-2 border-dashed px-4 py-8 text-center transition",
                dragOver
                  ? "border-emerald-400/40 bg-emerald-400/8"
                  : "border-white/10 bg-white/[0.02]",
              )}
            >
              {page === "voice"
                ? <AudioLines className={clsx("mb-2 h-6 w-6", dragOver ? "text-emerald-300" : "text-stone-500")} />
                : <ImagePlus className={clsx("mb-2 h-6 w-6", dragOver ? "text-emerald-300" : "text-stone-500")} />
              }
              <p className={clsx("text-[11px]", dragOver ? "text-emerald-200" : "text-stone-400")}>
                {dragOver
                  ? "Drop to add"
                  : page === "voice"
                    ? "Drop audio files here"
                    : "Drop images or videos here"}
              </p>
              <p className="mt-1 text-[10px] text-stone-600">or use the + button above</p>
            </div>
            {stagedFiles.map((file) => (
              <div
                key={file.path}
                className="group w-full rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.06]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-white/8 bg-white/5 px-2 py-0.5 font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.18em] text-stone-400">
                      {file.name.split(".").pop() ?? "file"}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-[11px] font-medium text-stone-100">{file.name}</p>
                  <p className="mt-1 truncate font-['IBM_Plex_Mono'] text-[10px] text-stone-600">{file.path}</p>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setImportingPath(file.path);
                      importLocalMediaAsset(file.path, undefined, file.name.replace(/\.[^.]+$/, "")).then(() => {
                        setStagedFiles((prev) => prev.filter((f) => f.path !== file.path));
                        setImportingPath((c) => (c === file.path ? undefined : c));
                      });
                    }}
                    className="rounded-xl border border-emerald-300/18 bg-emerald-300/10 px-2.5 py-1 text-[10px] text-emerald-50 transition hover:bg-emerald-300/18"
                  >
                    {importingPath === file.path ? "Adding…" : page === "voice" ? "Add to Audio Gallery" : "Add to Gallery"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportingPath(file.path);
                      importLocalMediaAsset(file.path, undefined, file.name.replace(/\.[^.]+$/, "")).then((asset) => {
                        if (asset) chrome?.openEditorAsset(asset);
                        setStagedFiles((prev) => prev.filter((f) => f.path !== file.path));
                        setImportingPath((c) => (c === file.path ? undefined : c));
                      });
                    }}
                    className="rounded-xl border border-amber-300/18 bg-amber-300/10 px-2.5 py-1 text-[10px] text-amber-50 transition hover:bg-amber-300/18"
                  >
                    Add to Editor
                  </button>
                  <button
                    type="button"
                    onClick={() => setStagedFiles((prev) => prev.filter((f) => f.path !== file.path))}
                    className="rounded-xl border border-white/8 bg-white/5 px-2.5 py-1 text-[10px] text-rose-200 transition hover:bg-rose-500/15"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </>
        ) : isTextWorkspace ? (
          <>
            <div
              className={clsx(
                "flex flex-col items-center justify-center rounded-[18px] border-2 border-dashed px-4 py-6 text-center transition",
                dragOver
                  ? "border-emerald-400/40 bg-emerald-400/8"
                  : "border-white/10 bg-white/[0.02]",
              )}
            >
              <Files className={clsx("mb-2 h-6 w-6", dragOver ? "text-emerald-300" : "text-stone-500")} />
              <p className={clsx("text-[11px]", dragOver ? "text-emerald-200" : "text-stone-400")}>
                {dragOver ? "Drop to add files" : "Drop files here"}
              </p>
              <p className="mt-1 text-[10px] text-stone-600">or use the + button above</p>
            </div>
            {workspaceItems.length ? (
              workspaceItems.map((item) => (
                <WorkspaceItemRow
                  key={item.id}
                  item={item}
                  selected={workspaceSelection[item.id] ?? false}
                  onToggle={() => toggleWorkspaceItem(item.id)}
                  onRemove={() => void removeWorkspaceFile(item.path)}
                />
              ))
            ) : !activeWorkspaceId ? null : (
              <p className="text-center text-[10px] text-stone-600">No indexed files yet.</p>
            )}
          </>
        ) : (
          <EmptyPanel
            eyebrow="No workspace"
            title="Drop files or folders to get started."
            body="Pick a workspace first, then this panel will surface local media files that match the current page."
          />
        )}
      </div>
    </div>
  );
}

function WorkspaceItemRow({
  item,
  selected,
  onToggle,
  onRemove,
}: {
  item: WorkspaceItem;
  selected: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={clsx(
        "group w-full rounded-[18px] border px-3 py-3 text-left transition",
        selected ? "border-emerald-200/16 bg-emerald-300/8" : "border-white/8 bg-white/[0.03] hover:bg-white/[0.06]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[11px] text-stone-100">{leafName(item.path)}</p>
          <p className="mt-1 truncate font-['IBM_Plex_Mono'] text-[10px] text-stone-600">{item.path}</p>
        </button>
        <div className="flex items-center gap-2">
          <div className="text-right text-[10px] text-stone-500">
            <p>{Math.round(item.byteSize / 1024)} KB</p>
            <p>{item.chunkCount} chunks</p>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="rounded-lg p-1 text-stone-600 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/15 hover:text-rose-300"
            aria-label="Remove file"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MusicMiniPlayer({ onExpand, onHide }: { onExpand: () => void; onHide: () => void }) {
  const musicTracks = useAppStore((state) => state.musicTracks);
  const currentIndex = useAppStore((state) => state.musicCurrentIndex);
  const playing = useAppStore((state) => state.musicPlaying);
  const setPlaying = useAppStore((state) => state.setMusicPlaying);
  const musicNext = useAppStore((state) => state.musicNext);
  const musicPrevious = useAppStore((state) => state.musicPrevious);
  const volume = useAppStore((state) => state.musicVolume);
  const setVolume = useAppStore((state) => state.setMusicVolume);
  const repeatMode = useAppStore((state) => state.musicRepeatMode);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const track = currentIndex >= 0 && currentIndex < musicTracks.length ? musicTracks[currentIndex] : null;

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !track) return;
    const src = convertFileSrc(track.filePath);
    if (el.src !== src) {
      el.src = src;
    }
    if (playing) {
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [track?.filePath, playing]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.volume = volume;
  }, [volume]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;
    const onTime = () => setProgress(el.currentTime);
    const onDur = () => setDuration(el.duration);
    const onEnd = () => {
      if (repeatMode === "one") {
        el.currentTime = 0;
        void el.play();
      } else {
        musicNext();
      }
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("durationchange", onDur);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("durationchange", onDur);
      el.removeEventListener("ended", onEnd);
    };
  }, [repeatMode, musicNext]);

  if (!track) return null;

  return (
    <div className="flex h-full items-center gap-3 px-3">
      <audio ref={audioRef} preload="auto" />
      {/* Cover art / icon */}
      <button type="button" onClick={onExpand} className="flex-shrink-0">
        {track.coverArtDataUrl ? (
          <img src={track.coverArtDataUrl} alt="" className="h-9 w-9 rounded-lg object-cover shadow-md" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-emerald-500/20 to-purple-500/20">
            <Disc3 className={clsx("h-4 w-4 text-emerald-200", playing && "animate-spin")} style={{ animationDuration: "3s" }} />
          </div>
        )}
      </button>

      {/* Track info */}
      <button type="button" onClick={onExpand} className="min-w-0 flex-shrink text-left">
        <p className="truncate text-[11px] font-semibold text-stone-100">{track.title ?? track.fileName}</p>
        <p className="truncate text-[9px] text-stone-500">{track.artist ?? "Unknown artist"}</p>
      </button>

      {/* Transport controls */}
      <div className="ml-auto flex items-center gap-1">
        <button type="button" onClick={musicPrevious} className="rounded-lg p-1.5 text-stone-300 transition hover:bg-white/8 hover:text-white">
          <SkipBack className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => setPlaying(!playing)}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-300/12 text-emerald-50 transition hover:bg-emerald-300/20"
        >
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 ml-0.5" />}
        </button>
        <button type="button" onClick={musicNext} className="rounded-lg p-1.5 text-stone-300 transition hover:bg-white/8 hover:text-white">
          <SkipForward className="h-3 w-3" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="hidden w-32 items-center gap-2 sm:flex">
        <span className="font-['IBM_Plex_Mono'] text-[8px] text-stone-500">{formatDuration(progress)}</span>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={progress}
          onChange={(e) => {
            const t = parseFloat(e.target.value);
            setProgress(t);
            if (audioRef.current) audioRef.current.currentTime = t;
          }}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-400 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-300"
        />
        <span className="font-['IBM_Plex_Mono'] text-[8px] text-stone-500">{formatDuration(duration)}</span>
      </div>

      {/* Volume */}
      <div className="hidden items-center gap-1 lg:flex">
        <button type="button" onClick={() => setVolume(volume > 0 ? 0 : 0.8)} className="rounded-lg p-1 text-stone-400 transition hover:text-stone-200">
          {volume === 0 ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-400 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-300"
        />
      </div>

      {/* Hide mini player */}
      <button type="button" onClick={onHide} className="ml-1 rounded-lg p-1 text-stone-500 transition hover:bg-white/8 hover:text-stone-200" aria-label="Hide mini player">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}


/* TilesPage and TileTerminal extracted to src/pages/TilesPage.tsx */

/* AsciiVisionPanel extracted to src/components/layout/AsciiVisionPanel.tsx */

/* TerminalPanel extracted to src/components/layout/TerminalPanel.tsx */

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useAppStore((state) => state.settings);
  const providerStatuses = useAppStore((state) => state.providerStatuses);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const saveApiKey = useAppStore((state) => state.saveApiKey);
  const deleteApiKey = useAppStore((state) => state.deleteApiKey);
  const ollamaModels = useAppStore((state) => state.models.ollama);
  const refreshModels = useAppStore((state) => state.refreshModels);
  const [draft, setDraft] = useState<Settings | undefined>(settings);
  const [xAiKey, setXAiKey] = useState("");
  const [avEnv, setAvEnv] = useState<Record<string, string>>({});
  const [avEnvSaved, setAvEnvSaved] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  useEffect(() => {
    setDraft(settings);
    void api.readAsciivisionEnv().then(setAvEnv).catch(() => {});
    void refreshModels();
  }, [settings]);

  if (!draft) {
    return null;
  }

  const xAiConfigured = providerStatuses.find((status) => status.providerId === "xai")?.configured;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden rounded-[34px] bg-black/60 px-6 py-8 backdrop-blur-xl">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,#0b0b0d_0%,#090a0c_100%)] shadow-[0_28px_100px_rgba(0,0,0,0.6)]">
        <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-white/6 px-6 pb-5 pt-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">Settings</p>
            <h2 className="mt-2 text-xl font-semibold text-stone-100">Shell preferences</h2>
            <p className="mt-2 max-w-xl text-[11px] leading-5 text-stone-500">
              Tune the default models, voice behavior, and shell controls from one place.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.12)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:my-3 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 hover:[&::-webkit-scrollbar-thumb]:bg-white/20">

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
            <p className="text-[10px] uppercase tracking-[0.3em] text-[#84a09b]">Shell</p>
            <div className="mt-4 grid gap-4">
              <label className="space-y-2 text-[11px] text-stone-300">
                <span>Summon hotkey</span>
                <input
                  value={draft.hotkey}
                  onChange={(event) => setDraft({ ...draft, hotkey: event.target.value })}
                  className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-stone-100 outline-none transition focus:border-emerald-300/40"
                />
              </label>

              <label className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/25 px-4 py-3 text-[11px] text-stone-300">
                <input
                  type="checkbox"
                  checked={draft.alwaysOnTop}
                  onChange={(event) => setDraft({ ...draft, alwaysOnTop: event.target.checked })}
                  className="h-4 w-4 rounded border-white/20 bg-transparent"
                />
                Keep Super ASCIIVision above other windows
              </label>

              <div className="space-y-2 text-[11px] text-stone-300">
                <span>Theme</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(["", "ocean", "sunset", "violet", "golden", "crimson"] as const).map((themeId) => {
                    const label = themeId || "Emerald";
                    const active = (draft.theme ?? "") === themeId;
                    const dot = { "": "#6ee7b7", ocean: "#60a5fa", sunset: "#fb923c", violet: "#c084fc", golden: "#fbbf24", crimson: "#f87171" }[themeId];
                    return (
                      <button
                        key={themeId}
                        type="button"
                        onClick={() => {
                          setDraft({ ...draft, theme: themeId });
                          document.documentElement.setAttribute("data-theme", themeId);
                        }}
                        className={clsx(
                          "flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-medium transition",
                          active
                            ? "border-white/20 bg-white/10 text-stone-100"
                            : "border-white/8 bg-black/25 text-stone-400 hover:bg-white/7 hover:text-stone-200",
                        )}
                      >
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: dot }} />
                        {label.charAt(0).toUpperCase() + label.slice(1)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[#84a09b]">Models</p>
                <p className="mt-1 text-[11px] text-stone-500">Default engines for chat, media, and live voice.</p>
              </div>
              <div className="rounded-full border border-emerald-300/18 bg-emerald-300/10 px-3 py-1 font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.2em] text-emerald-100">
                xAI
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="rounded-2xl border border-white/8 bg-black/25 p-3 text-[11px] text-stone-300">
                <span className="block text-[10px] uppercase tracking-[0.18em] text-stone-500">Chat model</span>
                <select
                  value={draft.xaiModel ?? CHAT_MODELS[2]}
                  onChange={(event) => setDraft({ ...draft, xaiModel: event.target.value })}
                  className="mt-3 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none transition focus:border-emerald-300/40"
                >
                  {CHAT_MODELS.map((modelId) => (
                    <option key={modelId} value={modelId}>
                      {modelId}
                    </option>
                  ))}
                </select>
              </label>

              <label className="rounded-2xl border border-white/8 bg-black/25 p-3 text-[11px] text-stone-300">
                <span className="block text-[10px] uppercase tracking-[0.18em] text-stone-500">Image model</span>
                <select
                  value={draft.xaiImageModel ?? IMAGE_MODELS[1]}
                  onChange={(event) => setDraft({ ...draft, xaiImageModel: event.target.value })}
                  className="mt-3 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none transition focus:border-emerald-300/40"
                >
                  {IMAGE_MODELS.map((modelId) => (
                    <option key={modelId} value={modelId}>
                      {modelId}
                    </option>
                  ))}
                </select>
              </label>

              <label className="rounded-2xl border border-white/8 bg-black/25 p-3 text-[11px] text-stone-300">
                <span className="block text-[10px] uppercase tracking-[0.18em] text-stone-500">Video model</span>
                <select
                  value={draft.xaiVideoModel ?? VIDEO_MODELS[0]}
                  onChange={(event) => setDraft({ ...draft, xaiVideoModel: event.target.value })}
                  className="mt-3 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none transition focus:border-emerald-300/40"
                >
                  {VIDEO_MODELS.map((modelId) => (
                    <option key={modelId} value={modelId}>
                      {modelId}
                    </option>
                  ))}
                </select>
              </label>

              <label className="rounded-2xl border border-white/8 bg-black/25 p-3 text-[11px] text-stone-300">
                <span className="block text-[10px] uppercase tracking-[0.18em] text-stone-500">Realtime model</span>
                <input
                  value={draft.xaiRealtimeModel ?? "grok-realtime"}
                  onChange={(event) => setDraft({ ...draft, xaiRealtimeModel: event.target.value })}
                  className="mt-3 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none transition focus:border-emerald-300/40"
                />
              </label>

              <label className="rounded-2xl border border-white/8 bg-black/25 p-3 text-[11px] text-stone-300">
                <span className="block text-[10px] uppercase tracking-[0.18em] text-stone-500">TTS model</span>
                <input
                  value={draft.xaiTtsModel ?? "xai-tts"}
                  onChange={(event) => setDraft({ ...draft, xaiTtsModel: event.target.value })}
                  className="mt-3 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none transition focus:border-emerald-300/40"
                />
              </label>

              <label className="rounded-2xl border border-white/8 bg-black/25 p-3 text-[11px] text-stone-300">
                <span className="block text-[10px] uppercase tracking-[0.18em] text-stone-500">Default voice</span>
                <select
                  value={normalizeVoiceId(draft.xaiVoiceName)}
                  onChange={(event) => setDraft({ ...draft, xaiVoiceName: event.target.value })}
                  className="mt-3 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none transition focus:border-emerald-300/40"
                >
                  {XAI_VOICE_OPTIONS.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Ollama default model */}
            <div className="mt-4 rounded-2xl border border-white/8 bg-black/25 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.18em] text-stone-500">Default Ollama model</span>
                <span className="rounded-full border border-sky-300/18 bg-sky-300/10 px-2 py-0.5 font-['IBM_Plex_Mono'] text-[8px] uppercase tracking-[0.2em] text-sky-200">
                  Ollama
                </span>
              </div>
              <select
                value={draft.ollamaModel ?? ""}
                onChange={(event) => setDraft({ ...draft, ollamaModel: event.target.value || undefined })}
                className="mt-3 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none transition focus:border-sky-300/40"
              >
                <option value="">Auto (first available)</option>
                {ollamaModels.map((m) => (
                  <option key={m.modelId} value={m.modelId}>
                    {m.modelId}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-[9px] text-stone-500">
                {ollamaModels.length ? `${ollamaModels.length} model${ollamaModels.length !== 1 ? "s" : ""} detected` : "Run 'ollama serve' to detect models"}
              </p>
            </div>
          </section>
        </div>

        <div className="mt-5 rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-stone-500">xAI API key</p>
              <p className="mt-1 text-[11px] text-stone-500">Stored locally for Super ASCIIVision requests.</p>
            </div>
            <div className="rounded-full border border-white/8 bg-black/25 px-3 py-1 font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.2em] text-stone-400">
              {xAiConfigured ? "configured" : "missing"}
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <input
              type="password"
              value={xAiKey}
              onChange={(event) => setXAiKey(event.target.value)}
              placeholder="Paste xAI API key"
              className="rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none focus:border-emerald-300/40"
            />
            <button
              type="button"
              onClick={() => void saveApiKey("xai", xAiKey)}
              className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-white/10"
            >
              Save key
            </button>
            {xAiConfigured ? (
              <button
                type="button"
                onClick={() => void deleteApiKey("xai")}
                className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-rose-500/15"
              >
                Delete key
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-[10px] text-stone-500">{xAiConfigured ? "Key configured." : "No key stored."}</p>
        </div>

        {/* ASCIIVision API Keys */}
        <div className="mt-5 rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-stone-500">ASCIIVision API keys</p>
              <p className="mt-1 text-[11px] text-stone-500">Saved to asciivision-core/.env for multi-provider AI chat. Your xAI key is shared automatically.</p>
            </div>
            <div className="rounded-full border border-purple-300/18 bg-purple-300/10 px-3 py-1 font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.2em] text-purple-200">
              Terminal
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {(
              [
                ["CLAUDE_API_KEY", "Claude (Anthropic)"],
                ["OPENAI_API_KEY", "GPT (OpenAI)"],
                ["GEMINI_API_KEY", "Gemini (Google)"],
              ] as const
            ).map(([envKey, label]) => (
              <label key={envKey} className="space-y-1.5 text-[11px] text-stone-300">
                <span className="text-[9px] text-stone-500">{label}</span>
                <input
                  type="password"
                  value={avEnv[envKey] ?? ""}
                  onChange={(e) => { setAvEnv((prev) => ({ ...prev, [envKey]: e.target.value })); setAvEnvSaved(false); }}
                  placeholder={`Paste ${label.split(" ")[0]} key`}
                  className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none focus:border-purple-300/40"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                await api.writeAsciivisionEnv(avEnv);
                setAvEnvSaved(true);
              }}
              className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-white/10"
            >
              Save ASCIIVision keys
            </button>
            {avEnvSaved ? <span className="text-[10px] text-emerald-400">Saved</span> : null}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={async () => {
              await api.clearAllMedia();
              useAppStore.setState({ mediaAssets: [], mediaCategories: [], mediaLoaded: false });
            }}
            className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-400 transition hover:bg-rose-500/15 hover:text-rose-200"
          >
            Clear media library
          </button>
          <div className="flex items-center gap-3">
            {prefsSaved ? <span className="text-[10px] text-emerald-400 animate-pulse">Preferences saved</span> : null}
            <button
              type="button"
              onClick={async () => {
                await saveSettings(draft);
                setPrefsSaved(true);
                setTimeout(() => setPrefsSaved(false), 2500);
              }}
              className="rounded-xl border border-emerald-300/20 bg-emerald-300/12 px-4 py-2 text-[11px] text-emerald-50 transition hover:bg-emerald-300/20"
            >
              Save preferences
            </button>
          </div>
        </div>

        </div>{/* end scroll wrapper */}
      </div>
    </div>
  );
}

export default App;
