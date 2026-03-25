import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import clsx from "clsx";
import QRCode from "qrcode";
import {
  AudioLines,
  Bot,
  Captions,
  ChevronRight,
  ChevronDown,
  Code2,
  Copy,
  Disc3,
  Download,
  Eye,
  FastForward,
  Files,
  Folder,
  FolderPlus,
  FolderOpen,
  Gauge,
  Globe,
  ImagePlus,
  Hash,
  ListMusic,
  MessageSquarePlus,
  Mic,
  Music,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Scissors,
  Send,
  Settings2,
  SkipBack,
  SkipForward,
  Square,
  SquareTerminal,
  Trash2,
  Video,
  Volume2,
  VolumeX,
  Wifi,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import hljs from "highlight.js/lib/core";
import hljsBash from "highlight.js/lib/languages/bash";
import hljsCss from "highlight.js/lib/languages/css";
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
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Terminal as XTerm } from "xterm";
import { api, events } from "./lib/tauri";
import { useAppStore } from "./store/appStore";
import type { AppPage, MediaAsset, Settings, StreamEvent, WorkspaceItem, WorkspaceMediaFile } from "./types";
import {
  CHAT_MODELS,
  IMAGE_MODELS,
  REALTIME_AUDIO_RATE,
  VIDEO_MODELS,
  XAI_VOICE_OPTIONS,
} from "./constants";
import { clamp, formatDuration, formatEditableDuration, formatFileSize, formatTimestamp, formatTimelineSeconds, parseSecondsInput } from "./utils/formatting";
import { extensionForLanguage, leafName, relativeWorkspacePath, renamedPath, replacePathPrefix } from "./utils/paths";
import { buildPreviewDocument } from "./utils/html";
import { decodeBase64Bytes, encodePcm16Base64, normalizeVoiceId, pcm16BytesToFloat32, requestMicrophoneStream } from "./utils/audio";
import { buildClipTrimPatch, buildTimelineTrack, createEditorClip, findClipAtTime, getEditorClipDuration, getEditorClipSpeed } from "./utils/editor";
import type { EditorClip, TimelineTrackItem } from "./utils/editor";
import { shouldStartWindowDrag, isEditableTarget } from "./utils/dom";
import { buildIdeTree } from "./utils/tree";
import type { IdeTreeNode } from "./utils/tree";
import { AppMark } from "./components/AppMark";
import { EmptyPanel } from "./components/EmptyPanel";
import { NavTab } from "./components/NavTab";
import { ResizeHandle } from "./components/ResizeHandle";
import { ShellChromeContext } from "./components/ShellChromeContext";
import type { ShellChromeActions } from "./components/ShellChromeContext";
import { TypingIndicator } from "./components/TypingIndicator";
import { ChatPage } from "./pages/ChatPage";
import { ImaginePage, MediaAssetCard } from "./pages/ImaginePage";
import { MusicPage } from "./pages/MusicPage";
import { TilesPage } from "./pages/TilesPage";

// Register highlight.js languages
hljs.registerLanguage("bash", hljsBash);
hljs.registerLanguage("sh", hljsBash);
hljs.registerLanguage("shell", hljsBash);
hljs.registerLanguage("css", hljsCss);
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

interface SubtitleClip {
  id: string;
  text: string;
  start: number;
  end: number;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  fontSize: number; // pixels
}

interface OverlayClip {
  id: string;
  assetId: string;
  filePath: string;
  start: number;
  end: number;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  width: number; // percentage 0-100
  height: number; // percentage 0-100
}

interface EditorContextMenu {
  clipId: string;
  trackType: "visual" | "audio" | "subtitle" | "overlay";
  x: number;
  y: number;
}

interface IdeContextMenuState {
  node: IdeTreeNode;
  x: number;
  y: number;
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

function VoiceAudioPage({ onShowBrowser }: { onShowBrowser: () => void }) {
  const settings = useAppStore((state) => state.settings);
  const mediaCategories = useAppStore((state) => state.mediaCategories);
  const mediaAssets = useAppStore((state) => state.mediaAssets);
  const createMediaCategory = useAppStore((state) => state.createMediaCategory);
  const renameMediaCategory = useAppStore((state) => state.renameMediaCategory);
  const deleteMediaCategory = useAppStore((state) => state.deleteMediaCategory);
  const generatingSpeech = useAppStore((state) => state.generatingSpeech);
  const createRealtimeSession = useAppStore((state) => state.createRealtimeSession);
  const clearRealtimeSession = useAppStore((state) => state.clearRealtimeSession);
  const generatingRealtimeSession = useAppStore((state) => state.creatingRealtimeSession);
  const realtimeSession = useAppStore((state) => state.realtimeSession);
  const generateSpeech = useAppStore((state) => state.generateSpeech);
  const ensureMediaLoaded = useAppStore((state) => state.ensureMediaLoaded);
  const [mode, setMode] = useState<"speech" | "realtime">("speech");
  const [speechError, setSpeechError] = useState<string>();

  useEffect(() => { void ensureMediaLoaded(); }, [ensureMediaLoaded]);
  const [speechInput, setSpeechInput] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [selectedAudioCategoryId, setSelectedAudioCategoryId] = useState<string>();
  const [galleryDensity, setGalleryDensity] = useState<4 | 5 | 6>(6);
  const [catMenu, setCatMenu] = useState<{ id: string; name: string; x: number; y: number }>();
  const [catRename, setCatRename] = useState<{ id: string; draft: string }>();

  useEffect(() => {
    if (!catMenu) return undefined;
    const dismiss = () => setCatMenu(undefined);
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [catMenu]);
  const [voiceName, setVoiceName] = useState(normalizeVoiceId(settings?.xaiVoiceName));
  const [ttsModel, setTtsModel] = useState(settings?.xaiTtsModel ?? "xai-tts");
  const [realtimeModel, setRealtimeModel] = useState(settings?.xaiRealtimeModel ?? "grok-3-mini-fast");
  const [realtimeInstructions, setRealtimeInstructions] = useState(
    "You are the voice assistant inside Super ASCIIVision. Keep responses concise and useful.",
  );
  const [realtimeStatus, setRealtimeStatus] = useState("Idle");
  const [voiceActive, setVoiceActive] = useState(false);
  const [realtimeTalkMode, setRealtimeTalkMode] = useState<"push" | "auto">("push");
  const [pushing, setPushing] = useState(false);
  const talkModeRef = useRef(realtimeTalkMode);
  talkModeRef.current = realtimeTalkMode;
  const pushingRef = useRef(pushing);
  pushingRef.current = pushing;
  const websocketRef = useRef<WebSocket | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackCursorRef = useRef(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const partialAssistantTranscriptRef = useRef("");

  useEffect(() => {
    if (settings?.xaiVoiceName) {
      setVoiceName(normalizeVoiceId(settings.xaiVoiceName));
    }
    if (settings?.xaiTtsModel) {
      setTtsModel(settings.xaiTtsModel);
    }
    if (settings?.xaiRealtimeModel) {
      setRealtimeModel(settings.xaiRealtimeModel);
    }
  }, [settings?.xaiRealtimeModel, settings?.xaiTtsModel, settings?.xaiVoiceName]);

  const audioAssets = useMemo(
    () =>
      mediaAssets.filter(
        (asset) => asset.kind === "audio" && (!selectedAudioCategoryId || asset.categoryId === selectedAudioCategoryId),
      ),
    [mediaAssets, selectedAudioCategoryId],
  );
  const audioCategories = useMemo(
    () => mediaCategories.filter((c) => !c.kind || c.kind === "audio"),
    [mediaCategories],
  );
  const audioCategoryCounts = useMemo(
    () =>
      Object.fromEntries(
        audioCategories.map((category) => [
          category.id,
          mediaAssets.filter((asset) => asset.kind === "audio" && asset.categoryId === category.id).length,
        ]),
      ),
    [mediaAssets, audioCategories],
  );
  const audioAllCount = useMemo(() => mediaAssets.filter((asset) => asset.kind === "audio").length, [mediaAssets]);

  const stopRealtimeConversation = async () => {
    processorNodeRef.current?.disconnect();
    processorNodeRef.current = null;
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    silentGainRef.current?.disconnect();
    silentGainRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    if (captureContextRef.current) {
      await captureContextRef.current.close().catch(() => undefined);
      captureContextRef.current = null;
    }
    if (playbackContextRef.current) {
      await playbackContextRef.current.close().catch(() => undefined);
      playbackContextRef.current = null;
      playbackCursorRef.current = 0;
    }
    websocketRef.current?.close();
    websocketRef.current = null;
    partialAssistantTranscriptRef.current = "";
    clearRealtimeSession();
    setVoiceActive(false);
    setRealtimeStatus("Idle");
  };

  useEffect(() => {
    return () => {
      void stopRealtimeConversation();
    };
  }, []);

  const queueAssistantAudio = async (base64Audio: string) => {
    const bytes = decodeBase64Bytes(base64Audio);
    const samples = pcm16BytesToFloat32(bytes);
    if (!samples.length) {
      return;
    }

    let context = playbackContextRef.current;
    if (!context) {
      context = new AudioContext({ sampleRate: REALTIME_AUDIO_RATE });
      playbackContextRef.current = context;
    }
    if (context.state === "suspended") {
      await context.resume();
    }

    const buffer = context.createBuffer(1, samples.length, REALTIME_AUDIO_RATE);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const startAt = Math.max(context.currentTime + 0.02, playbackCursorRef.current || context.currentTime);
    source.start(startAt);
    playbackCursorRef.current = startAt + buffer.duration;
  };

  const beginPushToTalk = () => {
    if (!websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) return;
    pushingRef.current = true;
    setPushing(true);
    setRealtimeStatus("Listening");
    websocketRef.current.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
  };

  const endPushToTalk = () => {
    if (!pushingRef.current) return;
    pushingRef.current = false;
    setPushing(false);
    setRealtimeStatus("Thinking");
    const ws = websocketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      ws.send(JSON.stringify({ type: "response.create" }));
    }
  };

  const startRealtimeConversation = async () => {
    if (voiceActive || generatingRealtimeSession) {
      return;
    }

    setRealtimeStatus("Starting");
    setVoiceActive(true);

    try {
      await createRealtimeSession(realtimeModel, normalizeVoiceId(voiceName), realtimeInstructions);
      const session = useAppStore.getState().realtimeSession ?? realtimeSession;
      if (!session) {
        throw new Error("Realtime session was not created.");
      }

      // Connect via local WebSocket proxy (handles xAI auth headers server-side)
      const socket = session.proxyPort
        ? new WebSocket(`ws://127.0.0.1:${session.proxyPort}/ws`)
        : new WebSocket(session.websocketUrl, [`openai-insecure-api-key.${session.clientSecret}`]);
      websocketRef.current = socket;

      const sessionConfiguredRef2 = { current: false };

      const sendSessionUpdate = () => {
        const sessionConfig: Record<string, unknown> = {
          instructions: realtimeInstructions,
          voice: normalizeVoiceId(voiceName),
          audio: {
            input: { format: { type: "audio/pcm", rate: REALTIME_AUDIO_RATE } },
            output: { format: { type: "audio/pcm", rate: REALTIME_AUDIO_RATE } },
          },
        };
        if (talkModeRef.current === "auto") {
          sessionConfig.turn_detection = {
            type: "server_vad",
            threshold: 0.85,
            silence_duration_ms: 800,
            prefix_padding_ms: 333,
          };
        } else {
          sessionConfig.turn_detection = null;
        }
        socket.send(
          JSON.stringify({
            type: "session.update",
            session: sessionConfig,
          }),
        );
      };

      const startAudioCapture = async () => {
        const captureContext = new AudioContext({ sampleRate: REALTIME_AUDIO_RATE });
        captureContextRef.current = captureContext;
        if (captureContext.state === "suspended") {
          await captureContext.resume();
        }

        const stream = await requestMicrophoneStream();
        mediaStreamRef.current = stream;

        const source = captureContext.createMediaStreamSource(stream);
        const processor = captureContext.createScriptProcessor(4096, 1, 1);
        const silentGain = captureContext.createGain();
        silentGain.gain.value = 0;

        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(captureContext.destination);

        sourceNodeRef.current = source;
        processorNodeRef.current = processor;
        silentGainRef.current = silentGain;

        processor.onaudioprocess = (event) => {
          if (socket.readyState !== WebSocket.OPEN || !sessionConfiguredRef2.current) {
            return;
          }
          // In push-to-talk mode, only send audio while the button is held
          if (talkModeRef.current === "push" && !pushingRef.current) {
            return;
          }
          const channelData = event.inputBuffer.getChannelData(0);
          socket.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: encodePcm16Base64(channelData),
            }),
          );
        };
      };

      socket.onopen = () => {
        setRealtimeStatus("Connecting…");
        // Send session config immediately — xAI accepts it on open
        sendSessionUpdate();
      };

      socket.onmessage = (event) => {
        const payload = typeof event.data === "string" ? event.data : "";
        if (!payload) {
          return;
        }

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          return;
        }

        const type = typeof data.type === "string" ? data.type : "";
        if (type === "conversation.created") {
          // xAI sends this first — if we haven't configured yet, send session.update now
          return;
        }
        if (type === "session.created") {
          // Some xAI flows send session.created — send config if not already sent
          return;
        }
        if (type === "session.updated") {
          sessionConfiguredRef2.current = true;
          setRealtimeStatus(talkModeRef.current === "push" ? "Hold mic to talk" : "Listening");
          void startAudioCapture();
          return;
        }
        if (type === "input_audio_buffer.speech_started") {
          setRealtimeStatus("Listening");
          return;
        }
        if (type === "input_audio_buffer.speech_stopped") {
          setRealtimeStatus("Thinking");
          return;
        }
        if (type === "response.created") {
          partialAssistantTranscriptRef.current = "";
          setRealtimeStatus("Responding");
          return;
        }
        if (type === "response.output_audio_transcript.delta") {
          partialAssistantTranscriptRef.current += typeof data.delta === "string" ? data.delta : "";
          return;
        }
        if (type === "response.output_audio_transcript.done") {
          partialAssistantTranscriptRef.current = "";
          return;
        }
        if (type === "response.output_audio.delta") {
          const delta = typeof data.delta === "string" ? data.delta : "";
          if (delta) {
            void queueAssistantAudio(delta);
          }
          return;
        }
        if (type === "response.done") {
          setRealtimeStatus(talkModeRef.current === "push" ? "Hold mic to talk" : "Listening");
          return;
        }
        if (type === "error") {
          const message =
            typeof data.error === "string"
              ? data.error
              : typeof (data.error as Record<string, unknown> | undefined)?.message === "string"
                ? ((data.error as Record<string, unknown>).message as string)
                : "Realtime session error.";
          setRealtimeStatus(message);
        }
      };

      socket.onerror = () => {
        setRealtimeStatus("WebSocket error — check API key and network");
      };

      socket.onclose = (closeEvent) => {
        setVoiceActive(false);
        if (closeEvent.code !== 1000 && closeEvent.code !== 1005) {
          setRealtimeStatus(
            closeEvent.reason
              ? `Disconnected: ${closeEvent.reason}`
              : "Disconnected",
          );
        } else {
          setRealtimeStatus("Idle");
        }
      };
    } catch (error) {
      setVoiceActive(false);
      setRealtimeStatus(
        error instanceof Error
          ? error.message
          : "Failed to start realtime voice.",
      );
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-white/6 px-3 py-3">
        <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">Voice & Audio</p>
        <h2 className="mt-2 text-[18px] font-semibold text-stone-100">Speech files and live voice</h2>
        <p className="mt-1 text-[11px] text-stone-500">
          Switch between file generation and a live back-and-forth realtime voice session from one panel.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 overflow-hidden px-3 py-3 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
        <section className="min-h-0 overflow-y-auto rounded-[24px] border border-white/8 bg-white/[0.03] p-3.5">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-white/8 bg-white/5 p-2 text-stone-100">
              {mode === "speech" ? <Volume2 className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-[#84a09b]">Voice</p>
              <h3 className="mt-2 text-[14px] font-semibold text-stone-100">One panel for files and live chat</h3>
              <p className="mt-1 text-[11px] leading-5 text-stone-500">
                Generate a saved speech file or switch to a live realtime session with a single voice button.
              </p>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setMode("speech")}
              className={clsx(
                "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] transition",
                mode === "speech"
                  ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                  : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/10",
              )}
            >
              <AudioLines className="h-3.5 w-3.5" />
              Speech File
            </button>
            <button
              type="button"
              onClick={() => setMode("realtime")}
              className={clsx(
                "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] transition",
                mode === "realtime"
                  ? "border-sky-300/20 bg-sky-300/12 text-sky-50"
                  : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/10",
              )}
            >
              <Wifi className="h-3.5 w-3.5" />
              Realtime Voice
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            <div className="rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-400">
              Model: {mode === "speech" ? ttsModel : realtimeModel}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {XAI_VOICE_OPTIONS.map((voice) => (
                <button
                  key={voice.id}
                  type="button"
                  onClick={() => setVoiceName(voice.id)}
                  className={clsx(
                    "rounded-xl border px-3 py-1.5 text-[10px] transition",
                    normalizeVoiceId(voiceName) === voice.id
                      ? "border-sky-300/20 bg-sky-300/12 text-sky-50"
                      : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/8",
                  )}
                >
                  {voice.label}
                </button>
              ))}
            </div>

            {mode === "speech" ? (
              <>
                <textarea
                  value={speechInput}
                  onChange={(event) => setSpeechInput(event.target.value)}
                  placeholder="Type the text for speech synthesis…"
                  className="min-h-36 rounded-[18px] border border-white/8 bg-black/30 px-3 py-3 text-[12px] leading-5 text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/30"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSpeechError(undefined);
                    generateSpeech(speechInput, ttsModel, normalizeVoiceId(voiceName), "mp3", selectedAudioCategoryId)
                      .then(() => {
                        const err = useAppStore.getState().error;
                        if (err) setSpeechError(err);
                      });
                  }}
                  disabled={generatingSpeech}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/12 px-3 py-2 text-[10px] font-semibold text-emerald-50 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-stone-500"
                >
                  <AudioLines className="h-3.5 w-3.5" />
                  {generatingSpeech ? "Synthesizing…" : "Generate Speech"}
                </button>
                {speechError ? (
                  <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-200">
                    {speechError}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <textarea
                  value={realtimeInstructions}
                  onChange={(event) => setRealtimeInstructions(event.target.value)}
                  placeholder="Realtime instructions"
                  className="min-h-24 rounded-[18px] border border-white/8 bg-black/30 px-3 py-3 text-[11px] leading-5 text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/30"
                />
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRealtimeTalkMode("push")}
                    className={clsx(
                      "rounded-xl border px-3 py-1.5 text-[10px] transition",
                      realtimeTalkMode === "push"
                        ? "border-sky-300/20 bg-sky-300/12 text-sky-50"
                        : "border-white/8 bg-white/5 text-stone-400 hover:bg-white/8",
                    )}
                  >
                    Push to Talk
                  </button>
                  <button
                    type="button"
                    onClick={() => setRealtimeTalkMode("auto")}
                    className={clsx(
                      "rounded-xl border px-3 py-1.5 text-[10px] transition",
                      realtimeTalkMode === "auto"
                        ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                        : "border-white/8 bg-white/5 text-stone-400 hover:bg-white/8",
                    )}
                  >
                    Auto (back & forth)
                  </button>
                </div>

                <div className="rounded-[22px] border border-white/8 bg-black/30 px-4 py-5">
                  <div className="flex flex-col items-center text-center">
                    {!voiceActive ? (
                      <button
                        type="button"
                        onClick={() => void startRealtimeConversation()}
                        disabled={generatingRealtimeSession}
                        className="flex h-28 w-28 items-center justify-center rounded-full border border-sky-300/24 bg-sky-300/12 text-sky-50 shadow-[0_0_0_10px_rgba(56,189,248,0.08)] transition hover:bg-sky-300/18"
                      >
                        <Mic className="h-9 w-9" />
                      </button>
                    ) : realtimeTalkMode === "push" ? (
                      <button
                        type="button"
                        onPointerDown={(e) => { e.preventDefault(); beginPushToTalk(); }}
                        onPointerUp={() => endPushToTalk()}
                        onPointerLeave={() => { if (pushing) endPushToTalk(); }}
                        className={clsx(
                          "flex h-28 w-28 select-none items-center justify-center rounded-full border transition",
                          pushing
                            ? "animate-pulse border-emerald-300/30 bg-emerald-400/20 text-emerald-50 shadow-[0_0_0_14px_rgba(52,211,153,0.12)]"
                            : "border-sky-300/24 bg-sky-300/12 text-sky-50 shadow-[0_0_0_10px_rgba(56,189,248,0.08)]",
                        )}
                      >
                        <Mic className="h-9 w-9" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void stopRealtimeConversation()}
                        className="animate-pulse flex h-28 w-28 items-center justify-center rounded-full border border-rose-300/30 bg-rose-400/15 text-rose-50 shadow-[0_0_0_10px_rgba(251,113,133,0.12)] transition"
                      >
                        <Square className="h-8 w-8" />
                      </button>
                    )}
                    <p className="mt-4 text-[12px] font-semibold text-stone-100">
                      {!voiceActive
                        ? "Tap to connect"
                        : realtimeTalkMode === "push"
                          ? pushing ? "Release to send" : "Hold to talk"
                          : "Tap to disconnect"}
                    </p>
                    <p className={clsx(
                      "mt-1 text-[11px]",
                      realtimeStatus === "Listening" || realtimeStatus === "Hold mic to talk" ? "text-emerald-300" :
                      realtimeStatus === "Responding" ? "text-sky-300" :
                      realtimeStatus === "Thinking" ? "text-amber-300" :
                      realtimeStatus.includes("error") || realtimeStatus.includes("Error") || realtimeStatus.includes("Disconnected") ? "text-rose-300" :
                      "text-stone-500",
                    )}>
                      {generatingRealtimeSession ? "Creating secure session…" : realtimeStatus}
                    </p>
                    {voiceActive ? (
                      <button
                        type="button"
                        onClick={() => void stopRealtimeConversation()}
                        className="mt-3 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-[10px] text-rose-200 transition hover:bg-rose-500/15"
                      >
                        Disconnect
                      </button>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-hidden rounded-[24px] border border-white/8 bg-white/[0.03]">
          <div className="grid h-full min-h-0 overflow-hidden xl:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b border-white/6 px-3 py-3 xl:border-b-0 xl:border-r">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.3em] text-[#84a09b]">Audio Categories</p>
                <div className="hidden items-center gap-1 rounded-full border border-white/8 bg-white/[0.03] p-0.5 xl:flex">
                  {[4, 5, 6].map((density) => (
                    <button
                      key={density}
                      type="button"
                      onClick={() => setGalleryDensity(density as 4 | 5 | 6)}
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-[9px] transition",
                        galleryDensity === density ? "bg-emerald-300/14 text-emerald-50" : "text-stone-400 hover:text-stone-100",
                      )}
                    >
                      {density}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newCategoryName.trim()) {
                      event.preventDefault();
                      void createMediaCategory(newCategoryName.trim(), "audio");
                      setNewCategoryName("");
                    }
                  }}
                  placeholder="New category"
                  className="min-w-0 flex-1 rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-[11px] text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/30"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newCategoryName.trim()) {
                      void createMediaCategory(newCategoryName.trim(), "audio");
                      setNewCategoryName("");
                    }
                  }}
                  className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-200 transition hover:bg-white/10"
                >
                  Add
                </button>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedAudioCategoryId(undefined)}
                  className={clsx(
                    "rounded-[14px] border px-3 py-2 text-left text-[11px] transition",
                    !selectedAudioCategoryId
                      ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                      : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/10",
                  )}
                >
                  <span className="block truncate">All audio</span>
                  <span className="mt-1 block text-[10px] text-stone-500">{audioAllCount} items</span>
                </button>
                {audioCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedAudioCategoryId(category.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCatMenu({ id: category.id, name: category.name, x: e.clientX, y: e.clientY });
                    }}
                    className={clsx(
                      "rounded-[14px] border px-3 py-2 text-left text-[11px] transition",
                      category.id === selectedAudioCategoryId
                        ? "border-sky-300/20 bg-sky-300/12 text-sky-50"
                        : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/10",
                    )}
                  >
                    <span className="block truncate">{category.name}</span>
                    <span className="mt-1 block text-[10px] text-stone-500">{audioCategoryCounts[category.id] ?? 0} items</span>
                  </button>
                ))}
              </div>
            </aside>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="border-b border-white/6 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-[#84a09b]">Audio Gallery</p>
                    <p className="mt-1 text-[11px] text-stone-500">Compact audio tiles with hover controls</p>
                  </div>
                </div>
              </div>
              <div
                className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-4"
                style={{ gridTemplateColumns: `repeat(${galleryDensity}, minmax(0, 1fr))` }}
              >
                {audioAssets.length ? (
                  audioAssets.map((asset) => <MediaAssetCard key={asset.id} asset={asset} onShowBrowser={onShowBrowser} />)
                ) : (
                  <div className="col-[1/-1]">
                    <EmptyPanel
                      eyebrow="Audio"
                      title="Speech files will appear here."
                      body="Generate a TTS clip and it will be kept in the audio gallery without mixing it into the visual gallery."
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
      {catMenu ? (
        <div
          className="fixed z-50 w-40 rounded-[18px] border border-white/8 bg-[#0b0c0d] p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.45)]"
          style={{ left: Math.min(catMenu.x, window.innerWidth - 172), top: Math.min(catMenu.y, window.innerHeight - 100) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => { setCatRename({ id: catMenu.id, draft: catMenu.name }); setCatMenu(undefined); }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-stone-200 transition hover:bg-white/7"
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </button>
          <button
            type="button"
            onClick={() => { void deleteMediaCategory(catMenu.id); setCatMenu(undefined); if (selectedAudioCategoryId === catMenu.id) setSelectedAudioCategoryId(undefined); }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-rose-100 transition hover:bg-rose-500/15"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      ) : null}
      {catRename ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onPointerDown={() => setCatRename(undefined)}>
          <div className="w-full max-w-sm rounded-[24px] border border-white/10 bg-[#0b0c0d] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.5)]" onPointerDown={(e) => e.stopPropagation()}>
            <p className="text-[10px] uppercase tracking-[0.28em] text-[#84a09b]">Rename Category</p>
            <input
              autoFocus
              value={catRename.draft}
              onChange={(e) => setCatRename({ ...catRename, draft: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && catRename.draft.trim()) { void renameMediaCategory(catRename.id, catRename.draft.trim()); setCatRename(undefined); }
                if (e.key === "Escape") setCatRename(undefined);
              }}
              className="mt-3 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2.5 text-[12px] text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/35"
              placeholder="Category name"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setCatRename(undefined)} className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-300 transition hover:bg-white/10">Cancel</button>
              <button
                type="button"
                onClick={() => { if (catRename.draft.trim()) { void renameMediaCategory(catRename.id, catRename.draft.trim()); setCatRename(undefined); } }}
                disabled={!catRename.draft.trim()}
                className="rounded-xl border border-emerald-300/20 bg-emerald-300/12 px-3 py-2 text-[10px] font-semibold text-emerald-50 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/5 disabled:text-stone-500"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function IdeCodeEditor({
  content,
  language,
  onChange,
}: {
  content: string;
  language?: string;
  onChange: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lines = content.split("\n");
  const lineCount = lines.length;

  const highlighted = useMemo(() => {
    const lang = (language ?? "").toLowerCase();
    const aliases: Record<string, string> = {
      js: "javascript", mjs: "javascript", ts: "typescript", tsx: "typescript",
      rs: "rust", py: "python", md: "markdown", yml: "yaml", htm: "html",
    };
    const resolved = aliases[lang] ?? lang;
    try {
      if (resolved && hljs.getLanguage(resolved)) {
        return hljs.highlight(content, { language: resolved }).value;
      }
    } catch {
      // fallback
    }
    try {
      return hljs.highlightAuto(content).value;
    } catch {
      return content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  }, [content, language]);

  const syncScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Handle Tab key for indentation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = `${content.substring(0, start)}  ${content.substring(end)}`;
      onChange(newValue);
      requestAnimationFrame(() => {
        ta.selectionStart = start + 2;
        ta.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div className="relative flex h-full overflow-hidden rounded-[14px] border border-white/6 bg-[#050607]">
      {/* Line numbers gutter */}
      <div
        ref={gutterRef}
        className="flex-none select-none overflow-hidden border-r border-white/6 bg-[#060708] py-3 pr-2 text-right font-['IBM_Plex_Mono'] text-[10px] leading-[20px] text-stone-600"
        style={{ width: `${Math.max(36, String(lineCount).length * 8 + 20)}px` }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="px-2">{i + 1}</div>
        ))}
      </div>

      {/* Code display area */}
      <div className="relative min-w-0 flex-1">
        {/* Highlighted code layer */}
        <pre
          ref={preRef}
          className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-4 py-3 font-['IBM_Plex_Mono'] text-[11px] leading-[20px] text-stone-100"
          aria-hidden="true"
        >
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>

        {/* Editable textarea layer (transparent text, visible caret) */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="relative z-10 h-full w-full resize-none whitespace-pre bg-transparent px-4 py-3 font-['IBM_Plex_Mono'] text-[11px] leading-[20px] text-transparent caret-emerald-300 outline-none"
          style={{ caretColor: "#6ee7b7" }}
        />
      </div>
    </div>
  );
}

function IdePage({ onShowBrowser }: { onShowBrowser: () => void }) {
  const chrome = useContext(ShellChromeContext);
  const settings = useAppStore((state) => state.settings);
  const workspaces = useAppStore((state) => state.workspaces);
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
  const workspaceItemsMap = useAppStore((state) => state.workspaceItems);
  const scanningWorkspaceId = useAppStore((state) => state.scanningWorkspaceId);
  const selectWorkspace = useAppStore((state) => state.selectWorkspace);
  const scanWorkspace = useAppStore((state) => state.scanWorkspace);
  const createWorkspaceFromFolder = useAppStore((state) => state.createWorkspaceFromFolder);
  const deleteWorkspace = useAppStore((state) => state.deleteWorkspace);
  const [leftMode, setLeftMode] = useState<"explorer" | "workspace">("explorer");
  const [query, setQuery] = useState("");
  const [activeFilePath, setActiveFilePath] = useState<string>();
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [tabContents, setTabContents] = useState<Record<string, { content: string; saved: string }>>({});
  const fileContent = activeFilePath ? tabContents[activeFilePath]?.content ?? "" : "";
  const savedContent = activeFilePath ? tabContents[activeFilePath]?.saved ?? "" : "";
  const setFileContent = (content: string) => {
    if (!activeFilePath) return;
    setTabContents((prev) => ({ ...prev, [activeFilePath]: { ...prev[activeFilePath]!, content } }));
  };
  const [loadingFile, setLoadingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [previewMode, setPreviewMode] = useState<"code" | "preview">("code");
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [ideRightMode, setIdeRightMode] = useState<"assistant" | "browser">("assistant");
  const models = useAppStore((state) => state.models);
  const [assistantProvider, setAssistantProvider] = useState<"xai" | "ollama">("xai");
  const [assistantModel, setAssistantModel] = useState(settings?.xaiModel ?? "grok-code-fast-1");
  const [assistantComposer, setAssistantComposer] = useState("");
  const [assistantConversationId, setAssistantConversationId] = useState<string>();
  const [assistantSending, setAssistantSending] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<
    Array<{ id: string; role: "user" | "assistant"; content: string; status: string }>
  >([]);
  const [contextMenu, setContextMenu] = useState<IdeContextMenuState>();
  const [ideLeftWidth, setIdeLeftWidth] = useState(240);
  const [ideRightWidth, setIdeRightWidth] = useState(340);
  const [ideViewportWidth, setIdeViewportWidth] = useState(() => window.innerWidth);
  const [ideDragPane, setIdeDragPane] = useState<{ side: "left" | "right"; startX: number; startValue: number }>();

  const workspaceItems = activeWorkspaceId ? workspaceItemsMap[activeWorkspaceId] ?? [] : [];
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return workspaceItems;
    }
    return workspaceItems.filter((item) => item.path.toLowerCase().includes(normalizedQuery));
  }, [query, workspaceItems]);
  const visibleTreeItems = query.trim() ? filteredItems : workspaceItems;
  const tree = useMemo(
    () => buildIdeTree(visibleTreeItems, activeWorkspace?.roots ?? []),
    [activeWorkspace?.roots, visibleTreeItems],
  );
  const activeItem =
    workspaceItems.find((item) => item.path === activeFilePath) ??
    filteredItems.find((item) => item.path === activeFilePath);
  const dirty = fileContent !== savedContent;
  const clampedIdeLeftWidth = clamp(ideLeftWidth, 210, Math.max(210, Math.floor(ideViewportWidth * 0.34)));
  const clampedIdeRightWidth = clamp(ideRightWidth, 280, Math.max(280, Math.floor(ideViewportWidth * 0.36)));

  useEffect(() => {
    if (settings?.xaiModel) {
      setAssistantModel(settings.xaiModel);
    }
  }, [settings?.xaiModel]);

  useEffect(() => {
    const onResize = () => setIdeViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!ideDragPane) {
      return undefined;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (ideDragPane.side === "left") {
        setIdeLeftWidth(ideDragPane.startValue + (event.clientX - ideDragPane.startX));
        return;
      }
      setIdeRightWidth(ideDragPane.startValue - (event.clientX - ideDragPane.startX));
    };

    const onPointerUp = () => setIdeDragPane(undefined);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [ideDragPane]);

  useEffect(() => {
    setQuery("");
    setOpenFolders({});
    setContextMenu(undefined);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!filteredItems.length && !openTabs.length) {
      setActiveFilePath(undefined);
      return;
    }
    if (!activeFilePath || !workspaceItems.some((item) => item.path === activeFilePath)) {
      if (openTabs.length) {
        setActiveFilePath(openTabs[openTabs.length - 1]);
      } else if (filteredItems[0]) {
        handleSelectFile(filteredItems[0].path);
      }
    }
  }, [activeFilePath, filteredItems, workspaceItems, openTabs]);

  useEffect(() => {
    if (!tree.length) {
      return;
    }
    setOpenFolders((current) => {
      const next = { ...current };
      tree.forEach((node) => {
        if (next[node.id] == null) {
          next[node.id] = true;
        }
      });
      return next;
    });
  }, [tree]);

  useEffect(() => {
    if (!activeFilePath) {
      return;
    }
    // If we already have content for this tab, don't reload
    if (tabContents[activeFilePath]) {
      setLoadingFile(false);
      return;
    }
    let cancelled = false;
    setLoadingFile(true);
    void api
      .readWorkspaceTextFile(activeFilePath)
      .then((content) => {
        if (!cancelled) {
          setTabContents((prev) => ({ ...prev, [activeFilePath]: { content, saved: content } }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTabContents((prev) => ({ ...prev, [activeFilePath]: { content: "", saved: "" } }));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingFile(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeFilePath]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    void events.onStream((event: StreamEvent) => {
      setAssistantMessages((current) =>
        current.map((message) => {
          if (message.id !== event.messageId) {
            return message;
          }
          if (event.kind === "delta") {
            return {
              ...message,
              content: `${message.content}${event.textDelta ?? ""}`,
              status: "streaming",
            };
          }
          if (event.kind === "completed") {
            return { ...message, status: "complete" };
          }
          if (event.kind === "cancelled") {
            return { ...message, status: "cancelled" };
          }
          if (event.kind === "error") {
            return { ...message, status: "error", content: event.error ?? message.content };
          }
          return message;
        }),
      );
      if (event.kind === "completed" || event.kind === "cancelled" || event.kind === "error") {
        setAssistantSending(false);
      }
    }).then((unlisten: () => void) => {
      dispose = unlisten;
    });

    return () => dispose?.();
  }, []);

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

  // Keyboard shortcuts: Cmd+S save, Cmd+P quick open
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenIndex, setQuickOpenIndex] = useState(0);
  const quickOpenResults = useMemo(() => {
    const q = quickOpenQuery.trim().toLowerCase();
    if (!q) return workspaceItems.slice(0, 30);
    return workspaceItems
      .filter((item) => item.path.toLowerCase().includes(q) || leafName(item.path).toLowerCase().includes(q))
      .slice(0, 30);
  }, [quickOpenQuery, workspaceItems]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (activeFilePath && fileContent !== savedContent) {
          void handleSave();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setQuickOpenVisible((v) => !v);
        setQuickOpenQuery("");
        setQuickOpenIndex(0);
      }
      if (e.key === "Escape" && quickOpenVisible) {
        setQuickOpenVisible(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeFilePath, fileContent, savedContent, quickOpenVisible]);

  const handleSelectFile = (path: string) => {
    setActiveFilePath(path);
    setOpenTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path]));
  };

  const handleCloseTab = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const tabEntry = tabContents[path];
    if (tabEntry && tabEntry.content !== tabEntry.saved && !window.confirm("Discard unsaved changes?")) {
      return;
    }
    setOpenTabs((tabs) => {
      const next = tabs.filter((t) => t !== path);
      if (activeFilePath === path) {
        const idx = tabs.indexOf(path);
        const nextActive = next[Math.min(idx, next.length - 1)];
        setActiveFilePath(nextActive);
      }
      return next;
    });
    setTabContents((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
  };

  const handleSave = async () => {
    if (!activeFilePath) {
      return;
    }
    const currentContent = tabContents[activeFilePath]?.content ?? "";
    setSavingFile(true);
    try {
      await api.writeWorkspaceTextFile(activeFilePath, currentContent);
      setTabContents((prev) => ({
        ...prev,
        [activeFilePath]: { content: currentContent, saved: currentContent },
      }));
      if (activeWorkspaceId) {
        await selectWorkspace(activeWorkspaceId);
      }
    } finally {
      setSavingFile(false);
    }
  };

  const refreshWorkspaceAfterMutation = async (
    workspaceId: string,
    nextActivePath?: string,
    roots?: string[],
  ) => {
    if (roots) {
      await api.updateWorkspace(workspaceId, { roots });
    }
    await scanWorkspace(workspaceId);
    await selectWorkspace(workspaceId);
    setActiveFilePath(nextActivePath);
  };

  const handleCreateFile = async (node: IdeTreeNode) => {
    if (node.kind !== "folder" || !activeWorkspaceId) {
      return;
    }

    const nextName = window.prompt("New file name", "new-file.ts")?.trim();
    if (!nextName) {
      return;
    }
    if (nextName.includes("/") || nextName.includes("\\")) {
      window.alert("Use a file name only, not a full path.");
      return;
    }

    const nextPath = `${node.path.replace(/\/+$/, "")}/${nextName}`;
    await api.createWorkspaceTextFile(nextPath, "");
    setOpenFolders((current) => ({ ...current, [node.id]: true }));
    setPreviewMode("code");
    setTabContents((prev) => ({ ...prev, [nextPath]: { content: "", saved: "" } }));
    setOpenTabs((tabs) => (tabs.includes(nextPath) ? tabs : [...tabs, nextPath]));
    setActiveFilePath(nextPath);
    await refreshWorkspaceAfterMutation(activeWorkspaceId, nextPath);
  };

  const handleRenameNode = async (node: IdeTreeNode) => {
    if (!activeWorkspaceId || !activeWorkspace) {
      return;
    }

    const nextName = window.prompt(`Rename ${node.kind}`, node.name)?.trim();
    if (!nextName || nextName === node.name) {
      return;
    }

    const nextPath = renamedPath(node.path, nextName);
    await api.renameWorkspacePath(node.path, nextName);

    const nextRoots = activeWorkspace.roots.includes(node.path)
      ? activeWorkspace.roots.map((root) => (root === node.path ? nextPath : root))
      : undefined;
    const nextActivePath = activeFilePath ? replacePathPrefix(activeFilePath, node.path, nextPath) : undefined;
    await refreshWorkspaceAfterMutation(activeWorkspaceId, nextActivePath, nextRoots);
  };

  const cleanupTabsForPath = (deletedPath: string) => {
    setOpenTabs((tabs) => tabs.filter((t) => t !== deletedPath && !t.startsWith(`${deletedPath}/`)));
    setTabContents((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key === deletedPath || key.startsWith(`${deletedPath}/`)) {
          delete next[key];
        }
      }
      return next;
    });
  };

  const handleDeleteNode = async (node: IdeTreeNode) => {
    if (!activeWorkspaceId || !activeWorkspace) {
      return;
    }

    const confirmed = window.confirm(`Delete this ${node.kind}: ${node.name}?`);
    if (!confirmed) {
      return;
    }

    const deletingWorkspaceRoot = activeWorkspace.roots.includes(node.path);
    if (deletingWorkspaceRoot) {
      await api.deleteWorkspacePath(node.path);
      cleanupTabsForPath(node.path);
      if (activeWorkspace.roots.length <= 1) {
        await deleteWorkspace(activeWorkspaceId);
        setActiveFilePath(undefined);
        return;
      }

      const nextRoots = activeWorkspace.roots.filter((root) => root !== node.path);
      const nextActivePath =
        activeFilePath && (activeFilePath === node.path || activeFilePath.startsWith(`${node.path}/`))
          ? undefined
          : activeFilePath;
      await refreshWorkspaceAfterMutation(activeWorkspaceId, nextActivePath || undefined, nextRoots);
      return;
    }

    await api.deleteWorkspacePath(node.path);
    cleanupTabsForPath(node.path);
    const nextActivePath =
      activeFilePath && (activeFilePath === node.path || activeFilePath.startsWith(`${node.path}/`))
        ? undefined
        : activeFilePath;
    await refreshWorkspaceAfterMutation(activeWorkspaceId, nextActivePath);
  };

  const writeTerminalData = useAppStore((state) => state.writeTerminalData);

  const handleOpenInTerminal = async (node: IdeTreeNode) => {
    if (node.kind !== "folder") {
      return;
    }
    const escapedPath = node.path.replace(/'/g, "'\\''");
    await writeTerminalData(`cd '${escapedPath}'\n`);
  };

  const handleApplyCode = (code: string) => {
    if (!activeFilePath) {
      window.alert("Open a file first to apply code.");
      return;
    }
    setPreviewMode("code");
    setTabContents((prev) => ({
      ...prev,
      [activeFilePath]: { ...prev[activeFilePath]!, content: code },
    }));
  };

  const handleCreateFileFromAssistant = async (code: string) => {
    if (!activeWorkspaceId || !activeWorkspace) {
      window.alert("Open a workspace first.");
      return;
    }
    const fileName = window.prompt("New file name", "new-file.ts")?.trim();
    if (!fileName) return;
    const root = activeWorkspace.roots[0];
    if (!root) return;
    const newPath = `${root.replace(/\/+$/, "")}/${fileName}`;
    await api.createWorkspaceTextFile(newPath, code);
    setTabContents((prev) => ({ ...prev, [newPath]: { content: code, saved: code } }));
    setOpenTabs((tabs) => (tabs.includes(newPath) ? tabs : [...tabs, newPath]));
    setActiveFilePath(newPath);
    await refreshWorkspaceAfterMutation(activeWorkspaceId, newPath);
  };

  const handleRunInTerminal = async (command: string) => {
    await writeTerminalData(`${command}\n`);
  };

  const sendAssistantMessage = async () => {
    const trimmed = assistantComposer.trim();
    if (!trimmed || assistantSending) {
      return;
    }
    setAssistantSending(true);
    let conversationId = assistantConversationId;
    if (!conversationId) {
      const conversation = await api.createConversation({
        title: activeItem ? `IDE • ${leafName(activeItem.path)}` : "IDE Assistant",
      });
      conversationId = conversation.id;
      setAssistantConversationId(conversation.id);
    }

    const systemParts = [
      "You are an agentic coding assistant inside Super ASCIIVision IDE.",
      "When the user asks you to write or modify code, respond with the COMPLETE file contents in a fenced code block.",
      "When suggesting terminal commands, wrap them in a ```bash code block.",
      "Be concise and focused. Prefer showing code over explaining it.",
    ];
    if (activeItem) {
      systemParts.push(
        `Current file: ${activeItem.path}`,
        `Language: ${activeItem.languageHint ?? "text"}`,
        `\nCurrent file contents:\n\`\`\`${extensionForLanguage(activeItem.languageHint ?? undefined)}\n${fileContent}\n\`\`\``,
      );
    }
    const prompt = `${systemParts.join("\n")}\n\nUser request:\n${trimmed}`;

    setAssistantMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content: trimmed, status: "complete" },
    ]);
    setAssistantComposer("");

    const handle = await api.sendMessage({
      conversationId,
      providerId: assistantProvider,
      modelId: assistantModel,
      userText: prompt,
      selectedWorkspaceItems: activeItem ? [activeItem.id] : [],
    });
    setAssistantMessages((current) => [
      ...current,
      { id: handle.messageId, role: "assistant", content: "", status: "streaming" },
    ]);
  };

  const renderTreeNode = (node: IdeTreeNode, depth = 0): React.ReactNode => {
    const isFolder = node.kind === "folder";
    const isOpen = openFolders[node.id] ?? false;

    return (
      <div key={node.id}>
        <button
          type="button"
          onClick={() => {
            if (isFolder) {
              setOpenFolders((current) => ({ ...current, [node.id]: !isOpen }));
            } else {
              handleSelectFile(node.path);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({ node, x: event.clientX, y: event.clientY });
          }}
          className={clsx(
            "flex w-full items-center gap-1.5 px-2 py-1 text-left text-[10px] transition",
            !isFolder && node.path === activeFilePath
              ? "bg-sky-300/10 text-sky-50"
              : "text-stone-300 hover:bg-white/[0.04]",
          )}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          {isFolder ? (
            <>
              <span className="flex h-3.5 w-3.5 items-center justify-center text-stone-500">
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </span>
              {isOpen ? <FolderOpen className="h-3.5 w-3.5 text-stone-400" /> : <Folder className="h-3.5 w-3.5 text-stone-400" />}
            </>
          ) : (
            <>
              <span className="w-3.5" />
              <Code2 className="h-3.5 w-3.5 text-stone-500" />
            </>
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isFolder && isOpen ? node.children?.map((child) => renderTreeNode(child, depth + 1)) : null}
      </div>
    );
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/6 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">IDE</p>
          <p className="mt-1 truncate text-[12px] text-stone-400">
            {activeWorkspace ? `${activeWorkspace.name} workspace` : "Open a workspace to start editing"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void createWorkspaceFromFolder()}
            className="inline-flex items-center gap-1 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-200 transition hover:bg-white/10"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Open Folder
          </button>
          <select
            value={activeWorkspaceId ?? ""}
            onChange={(event) => {
              if (event.target.value) {
                void selectWorkspace(event.target.value);
              }
            }}
            className="min-w-[180px] rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none focus:border-emerald-300/35"
          >
            <option value="" disabled>
              Select workspace
            </option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
          {activeWorkspaceId ? (
            <button
              type="button"
              onClick={() => void scanWorkspace(activeWorkspaceId)}
              className="inline-flex items-center gap-1 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-200 transition hover:bg-white/10"
            >
              <RefreshCcw className={clsx("h-3 w-3", scanningWorkspaceId === activeWorkspaceId && "animate-spin")} />
              Rescan
            </button>
          ) : null}
        </div>
      </div>

      <div
        className="grid min-h-0 flex-1 overflow-hidden"
        style={{
          gridTemplateColumns: `54px ${clampedIdeLeftWidth}px 8px minmax(0,1fr) 8px ${clampedIdeRightWidth}px`,
        }}
      >
          <aside className="flex min-h-0 flex-col items-center gap-2 border-r border-white/6 bg-[rgba(8,9,11,0.96)] px-2 py-3">
            {(
              [
                ["explorer", Files, "Files"],
                ["workspace", FolderPlus, "Workspace"],
              ] as const
            ).map(([mode, Icon, label]) => (
              <button
                key={mode}
                type="button"
                title={label}
                onClick={() => setLeftMode(mode as "explorer" | "workspace")}
                className={clsx(
                  "inline-flex h-10 w-10 items-center justify-center rounded-2xl border transition",
                  leftMode === mode
                    ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50 shadow-[0_10px_30px_rgba(0,0,0,0.22)]"
                    : "border-transparent bg-white/[0.03] text-stone-500 hover:border-white/8 hover:bg-white/[0.06] hover:text-stone-100",
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </aside>

          <aside className="flex min-h-0 flex-col overflow-hidden border-r border-white/6 bg-[rgba(10,11,13,0.96)]">
            <div className="border-b border-white/6 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.28em] text-[#84a09b]">
                  {leftMode === "explorer" ? "Explorer" : "Workspaces"}
                </p>
                {leftMode === "explorer" ? (
                  <button
                    type="button"
                    onClick={() => void createWorkspaceFromFolder()}
                    title="Add Folder"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-stone-400 transition hover:bg-white/8 hover:text-stone-100"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-stone-500">
                {leftMode === "explorer"
                  ? `${workspaceItems.length} indexed files`
                  : "Switch active project roots"}
              </p>
              {leftMode === "explorer" ? (
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter files · ⌘P quick open"
                  className="mt-3 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/35"
                />
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {leftMode === "explorer" ? (
                tree.length ? (
                  tree.map((node) => renderTreeNode(node))
                ) : (
                  <EmptyPanel
                    eyebrow="Files"
                    title="No indexed files."
                    body="Rescan the workspace or choose a different folder to populate the IDE explorer."
                  />
                )
              ) : (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => void createWorkspaceFromFolder()}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-emerald-300/20 bg-emerald-300/12 px-3 py-2 text-[10px] text-emerald-50 transition hover:bg-emerald-300/20"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    Add Folder
                  </button>
                  <div className="space-y-1.5">
                  {workspaces.map((workspace) => (
                    <div
                      key={workspace.id}
                      className="group relative"
                    >
                      <button
                        type="button"
                        onClick={() => void selectWorkspace(workspace.id)}
                        className={clsx(
                          "w-full rounded-xl border px-3 py-2 text-left transition",
                          workspace.id === activeWorkspaceId
                            ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-50"
                            : "border-transparent bg-white/[0.03] text-stone-300 hover:border-white/8 hover:bg-white/[0.05]",
                        )}
                      >
                        <p className="truncate text-[11px] font-medium text-stone-100">{workspace.name}</p>
                        <p className="mt-1 text-[9px] text-stone-500">{workspace.itemCount} indexed files</p>
                      </button>
                      <button
                        type="button"
                        title="Remove workspace"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Remove workspace "${workspace.name}"?`)) {
                            void deleteWorkspace(workspace.id);
                          }
                        }}
                        className="absolute right-2 top-2 hidden h-5 w-5 items-center justify-center rounded-lg text-stone-500 transition hover:bg-rose-500/15 hover:text-rose-300 group-hover:flex"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  </div>
                </div>
              )}
            </div>
          </aside>

          <ResizeHandle
            orientation="vertical"
            onPointerDown={(event) =>
              setIdeDragPane({ side: "left", startX: event.clientX, startValue: clampedIdeLeftWidth })
            }
          />

          <section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-[linear-gradient(180deg,rgba(8,9,11,0.99),rgba(6,7,9,0.98))]">
            {/* Tab bar */}
            <div className="flex items-center gap-0 overflow-x-auto border-b border-white/6 bg-[rgba(6,7,9,0.98)]" style={{ scrollbarWidth: "none" }}>
              {openTabs.map((tabPath) => {
                const isActive = tabPath === activeFilePath;
                const tabEntry = tabContents[tabPath];
                const tabDirty = tabEntry ? tabEntry.content !== tabEntry.saved : false;
                return (
                  <button
                    key={tabPath}
                    type="button"
                    onClick={() => setActiveFilePath(tabPath)}
                    className={clsx(
                      "group relative flex min-w-0 max-w-[180px] items-center gap-1.5 border-r border-white/4 px-3 py-2 text-[10px] transition",
                      isActive
                        ? "bg-[#0d0e10] text-stone-100"
                        : "bg-transparent text-stone-500 hover:bg-white/[0.03] hover:text-stone-300",
                    )}
                  >
                    {isActive ? <div className="absolute inset-x-0 top-0 h-[2px] bg-emerald-400/60" /> : null}
                    <Code2 className="h-3 w-3 shrink-0 text-stone-500" />
                    <span className="truncate">{leafName(tabPath)}</span>
                    {tabDirty ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" /> : null}
                    <span
                      onClick={(e) => handleCloseTab(tabPath, e)}
                      className="ml-auto hidden h-4 w-4 shrink-0 items-center justify-center rounded text-stone-500 hover:bg-white/10 hover:text-stone-200 group-hover:flex"
                    >
                      <X className="h-2.5 w-2.5" />
                    </span>
                  </button>
                );
              })}
              {!openTabs.length ? (
                <p className="px-3 py-2 text-[10px] text-stone-600">No files open</p>
              ) : null}
            </div>

            {/* Breadcrumbs + toolbar */}
            <div className="flex items-center justify-between gap-3 border-b border-white/6 px-3 py-1.5">
              <div className="flex min-w-0 items-center gap-1 text-[10px] text-stone-500">
                {activeItem ? (
                  relativeWorkspacePath(activeItem.path, activeWorkspace?.roots ?? [])
                    .split("/")
                    .map((segment, i, arr) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 ? <ChevronRight className="h-2.5 w-2.5 text-stone-600" /> : null}
                        <span className={i === arr.length - 1 ? "text-stone-300" : ""}>{segment}</span>
                      </span>
                    ))
                ) : (
                  <span>Select a file from the explorer</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(activeItem?.path ?? "")}
                  disabled={!activeItem}
                  title="Copy path"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-stone-400 transition hover:bg-white/8 hover:text-stone-100 disabled:text-stone-600"
                >
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode((current) => (current === "preview" ? "code" : "preview"))}
                  disabled={!activeItem}
                  title={previewMode === "preview" ? "Show code" : "Show preview"}
                  className={clsx(
                    "inline-flex h-6 w-6 items-center justify-center rounded-lg transition disabled:text-stone-600",
                    previewMode === "preview" ? "bg-sky-300/15 text-sky-300" : "text-stone-400 hover:bg-white/8 hover:text-stone-100",
                  )}
                >
                  <Eye className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!activeItem || !dirty || savingFile}
                  title="Save (⌘S)"
                  className={clsx(
                    "inline-flex h-6 items-center gap-1 rounded-lg px-2 text-[10px] transition",
                    dirty
                      ? "bg-emerald-300/15 text-emerald-300 hover:bg-emerald-300/20"
                      : "text-stone-500",
                    (!activeItem || savingFile) && "cursor-not-allowed opacity-40",
                  )}
                >
                  <Save className="h-3 w-3" />
                  {savingFile ? "Saving…" : dirty ? "Save" : "Saved"}
                </button>
              </div>
            </div>

            {/* Editor area */}
            <div className="min-h-0 bg-[#070809]">
              {activeItem ? (
                loadingFile ? (
                  <div className="flex h-full items-center justify-center text-[11px] text-stone-500">Loading file…</div>
                ) : previewMode === "preview" ? (
                  <iframe
                    title="IDE preview"
                    srcDoc={buildPreviewDocument(fileContent, activeItem?.languageHint ?? undefined)}
                    sandbox="allow-scripts allow-same-origin"
                    className="h-full w-full border-0 bg-[#050607]"
                  />
                ) : (
                  <IdeCodeEditor
                    content={fileContent}
                    language={activeItem.languageHint ?? undefined}
                    onChange={setFileContent}
                  />
                )
              ) : (
                <EmptyPanel
                  eyebrow="IDE"
                  title={activeWorkspaceId ? "Select a file from the explorer." : "Open a folder to get started."}
                  body={activeWorkspaceId
                    ? "Use the left rail to switch between project files and workspace roots. Press ⌘P for quick open."
                    : "Click \"Open Folder\" above or use the left sidebar to add a workspace. Your files will appear in the explorer."}
                />
              )}
            </div>

            {/* Status bar */}
            <div className="flex items-center justify-between gap-3 border-t border-white/6 px-3 py-1.5 text-[9px] text-stone-500">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5">
                  {activeItem?.languageHint ?? "text"}
                </span>
                <span>{activeItem ? formatFileSize(activeItem.byteSize) : "No file"}</span>
                <span>{fileContent.split("\n").length} lines</span>
                {dirty ? <span className="text-amber-300">Modified</span> : <span className="text-stone-600">Saved</span>}
              </div>
              <div className="flex items-center gap-3">
                <span>UTF-8</span>
                <span>{openTabs.length} open</span>
                <button
                  type="button"
                  onClick={() => {
                    chrome?.openBrowserPreview(buildPreviewDocument(fileContent, activeItem?.languageHint ?? undefined));
                    onShowBrowser();
                  }}
                  disabled={!activeItem}
                  className="inline-flex items-center gap-1 text-stone-400 transition hover:text-stone-100 disabled:text-stone-600"
                >
                  <Globe className="h-2.5 w-2.5" />
                  Preview
                </button>
              </div>
            </div>
          </section>

          <ResizeHandle
            orientation="vertical"
            onPointerDown={(event) =>
              setIdeDragPane({ side: "right", startX: event.clientX, startValue: clampedIdeRightWidth })
            }
          />

          <aside className="flex min-h-0 flex-col overflow-hidden border-l border-white/6 bg-[rgba(10,11,13,0.97)]">
            <div className="flex items-center gap-1 border-b border-white/6 px-3 py-2">
              <button
                type="button"
                onClick={() => setIdeRightMode("assistant")}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[10px] transition",
                  ideRightMode === "assistant"
                    ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                    : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/10",
                )}
              >
                <Bot className="h-3 w-3" />
                Assistant
              </button>
              <button
                type="button"
                onClick={() => setIdeRightMode("browser")}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[10px] transition",
                  ideRightMode === "browser"
                    ? "border-sky-300/20 bg-sky-300/12 text-sky-50"
                    : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/10",
                )}
              >
                <Globe className="h-3 w-3" />
                Browser
              </button>
            </div>

            {ideRightMode === "browser" ? (
              <BrowserPanel />
            ) : (
              <>
                {/* Model selector row */}
                <div className="border-b border-white/6 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Bot className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#84a09b]">Agent</span>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setAssistantProvider("xai");
                          setAssistantModel(settings?.xaiModel ?? "grok-code-fast-1");
                        }}
                        className={clsx(
                          "rounded-lg border px-2 py-1 text-[9px] font-semibold transition",
                          assistantProvider === "xai"
                            ? "border-sky-300/30 bg-sky-300/15 text-sky-200"
                            : "border-white/6 text-stone-500 hover:text-stone-300",
                        )}
                      >
                        xAI
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAssistantProvider("ollama");
                          const ollamaDefault = settings?.ollamaModel;
                          setAssistantModel(
                            ollamaDefault && models.ollama.some((m) => m.modelId === ollamaDefault)
                              ? ollamaDefault
                              : models.ollama[0]?.modelId ?? "qwen3.5:2b",
                          );
                        }}
                        className={clsx(
                          "rounded-lg border px-2 py-1 text-[9px] font-semibold transition",
                          assistantProvider === "ollama"
                            ? "border-orange-300/30 bg-orange-300/15 text-orange-200"
                            : "border-white/6 text-stone-500 hover:text-stone-300",
                        )}
                      >
                        Ollama
                      </button>
                    </div>
                  </div>
                  <select
                    value={assistantModel}
                    onChange={(event) => setAssistantModel(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-white/6 bg-black/30 px-2 py-1.5 font-['IBM_Plex_Mono'] text-[9px] text-stone-200 outline-none focus:border-emerald-300/35"
                  >
                    {assistantProvider === "ollama" ? (
                      models.ollama.length ? (
                        models.ollama.map((m) => (
                          <option key={m.modelId} value={m.modelId}>{m.label}</option>
                        ))
                      ) : (
                        <option value="">No Ollama models</option>
                      )
                    ) : (
                      CHAT_MODELS.map((modelId) => (
                        <option key={modelId} value={modelId}>{modelId}</option>
                      ))
                    )}
                  </select>
                </div>

                {/* Messages area */}
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
                  {assistantMessages.length ? (
                    assistantMessages.map((message) => (
                      <article
                        key={message.id}
                        className={clsx(
                          "rounded-2xl border",
                          message.role === "assistant"
                            ? "border-white/6 bg-white/[0.02]"
                            : "border-emerald-300/12 bg-emerald-300/5",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 px-3 pt-2">
                          <p className={clsx("text-[9px] font-semibold uppercase tracking-[0.15em]", message.role === "assistant" ? "text-stone-500" : "text-emerald-400/70")}>
                            {message.role === "assistant" ? "Agent" : "You"}
                          </p>
                          {message.status === "streaming" ? (
                            <span className="flex items-center gap-1 text-[9px] text-emerald-400/60">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                              Generating
                            </span>
                          ) : null}
                        </div>
                        <div className="px-3 pb-2.5 pt-1.5">
                          {message.content ? (
                            <div className="ide-assistant-md text-[11px] leading-5 text-stone-200">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  code({ className, children, ...props }) {
                                    const match = /language-(\w+)/.exec(className ?? "");
                                    const codeString = String(children).replace(/\n$/, "");
                                    const isBash = match?.[1] === "bash" || match?.[1] === "sh" || match?.[1] === "shell";
                                    const isBlock = codeString.includes("\n") || match;
                                    if (!isBlock) {
                                      return <code className="rounded bg-white/8 px-1 py-0.5 text-[10px] text-emerald-200" {...props}>{children}</code>;
                                    }
                                    let highlighted: string;
                                    try {
                                      highlighted = match?.[1] && hljs.getLanguage(match[1])
                                        ? hljs.highlight(codeString, { language: match[1] }).value
                                        : hljs.highlightAuto(codeString).value;
                                    } catch {
                                      highlighted = codeString.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                                    }
                                    return (
                                      <div className="my-2 overflow-hidden rounded-xl border border-white/6 bg-[#060708]">
                                        <div className="flex items-center justify-between gap-2 border-b border-white/6 px-3 py-1.5">
                                          <span className="text-[9px] text-stone-500">{match?.[1] ?? "code"}</span>
                                          <div className="flex items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => void navigator.clipboard.writeText(codeString)}
                                              className="rounded px-1.5 py-0.5 text-[9px] text-stone-500 transition hover:bg-white/8 hover:text-stone-300"
                                            >
                                              Copy
                                            </button>
                                            {isBash ? (
                                              <button
                                                type="button"
                                                onClick={() => void handleRunInTerminal(codeString)}
                                                className="rounded bg-amber-300/10 px-1.5 py-0.5 text-[9px] text-amber-200 transition hover:bg-amber-300/20"
                                              >
                                                Run
                                              </button>
                                            ) : (
                                              <>
                                                <button
                                                  type="button"
                                                  onClick={() => handleApplyCode(codeString)}
                                                  className="rounded bg-emerald-300/10 px-1.5 py-0.5 text-[9px] text-emerald-200 transition hover:bg-emerald-300/20"
                                                >
                                                  Apply
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => void handleCreateFileFromAssistant(codeString)}
                                                  className="rounded bg-sky-300/10 px-1.5 py-0.5 text-[9px] text-sky-200 transition hover:bg-sky-300/20"
                                                >
                                                  New File
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                        <pre className="overflow-x-auto px-3 py-2.5 text-[10px] leading-[18px]">
                                          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
                                        </pre>
                                      </div>
                                    );
                                  },
                                  p({ children }) {
                                    return <p className="my-1.5">{children}</p>;
                                  },
                                  ul({ children }) {
                                    return <ul className="my-1.5 list-disc pl-4 space-y-0.5">{children}</ul>;
                                  },
                                  ol({ children }) {
                                    return <ol className="my-1.5 list-decimal pl-4 space-y-0.5">{children}</ol>;
                                  },
                                  h1({ children }) { return <h1 className="mt-3 mb-1 text-[13px] font-bold text-stone-100">{children}</h1>; },
                                  h2({ children }) { return <h2 className="mt-3 mb-1 text-[12px] font-bold text-stone-100">{children}</h2>; },
                                  h3({ children }) { return <h3 className="mt-2 mb-1 text-[11px] font-semibold text-stone-200">{children}</h3>; },
                                  strong({ children }) { return <strong className="font-semibold text-stone-100">{children}</strong>; },
                                }}
                              />
                            </div>
                          ) : message.status === "streaming" ? (
                            <TypingIndicator />
                          ) : (
                            <p className="text-[11px] text-stone-500">…</p>
                          )}
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="flex flex-col items-center gap-3 py-12 text-center">
                      <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
                        <Bot className="h-6 w-6 text-emerald-400/50" />
                      </div>
                      <div>
                        <p className="text-[11px] font-medium text-stone-300">Agentic Copilot</p>
                        <p className="mt-1 text-[10px] leading-5 text-stone-600">
                          Ask to explain, refactor, write tests, or rewrite code. Code blocks have Apply, Run, and New File actions.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Composer */}
                <div className="border-t border-white/6 px-3 py-2.5">
                  {activeItem ? (
                    <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1">
                      <Code2 className="h-3 w-3 text-stone-500" />
                      <span className="truncate text-[9px] text-stone-500">{leafName(activeItem.path)}</span>
                      <span className="ml-auto text-[9px] text-stone-600">{activeItem.languageHint ?? "text"}</span>
                    </div>
                  ) : null}
                  <textarea
                    value={assistantComposer}
                    onChange={(event) => setAssistantComposer(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendAssistantMessage();
                      }
                    }}
                    placeholder={activeItem ? "Refactor this, add types, explain…" : "Ask anything…"}
                    className="min-h-20 w-full resize-none rounded-xl border border-white/6 bg-black/30 px-3 py-2.5 text-[11px] leading-5 text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/30"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void sendAssistantMessage()}
                      disabled={!assistantComposer.trim() || assistantSending}
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-emerald-300/20 bg-emerald-300/12 px-3 py-2 text-[10px] text-emerald-50 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:border-white/6 disabled:bg-white/[0.03] disabled:text-stone-600"
                    >
                      <Send className="h-3 w-3" />
                      {assistantSending ? "Generating…" : "Send"}
                    </button>
                    {assistantMessages.length ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAssistantMessages([]);
                          setAssistantConversationId(undefined);
                        }}
                        title="Clear conversation"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/6 text-stone-500 transition hover:bg-white/[0.05] hover:text-stone-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </aside>
      </div>
      {/* Quick Open modal (Cmd+P) */}
      {quickOpenVisible ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]" onClick={() => setQuickOpenVisible(false)}>
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0c0d0f] shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
              <Files className="h-4 w-4 text-stone-400" />
              <input
                autoFocus
                value={quickOpenQuery}
                onChange={(e) => { setQuickOpenQuery(e.target.value); setQuickOpenIndex(0); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setQuickOpenVisible(false); return; }
                  if (e.key === "ArrowDown") { e.preventDefault(); setQuickOpenIndex((i) => Math.min(i + 1, quickOpenResults.length - 1)); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setQuickOpenIndex((i) => Math.max(i - 1, 0)); return; }
                  if (e.key === "Enter" && quickOpenResults[quickOpenIndex]) {
                    e.preventDefault();
                    handleSelectFile(quickOpenResults[quickOpenIndex].path);
                    setQuickOpenVisible(false);
                  }
                }}
                placeholder="Search files by name…"
                className="min-w-0 flex-1 bg-transparent font-['IBM_Plex_Mono'] text-[12px] text-stone-100 outline-none placeholder:text-stone-600"
              />
              <kbd className="rounded border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-stone-500">ESC</kbd>
            </div>
            <div className="max-h-[320px] overflow-y-auto py-1">
              {quickOpenResults.length ? (
                quickOpenResults.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { handleSelectFile(item.path); setQuickOpenVisible(false); }}
                    className={clsx(
                      "flex w-full items-center gap-2 px-4 py-2 text-left transition",
                      i === quickOpenIndex
                        ? "bg-emerald-300/10 text-stone-100"
                        : "text-stone-400 hover:bg-white/[0.04]",
                    )}
                  >
                    <Code2 className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium">{leafName(item.path)}</p>
                      <p className="truncate text-[9px] text-stone-600">
                        {relativeWorkspacePath(item.path, activeWorkspace?.roots ?? [])}
                      </p>
                    </div>
                    <span className="shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-stone-600">
                      {item.languageHint ?? "text"}
                    </span>
                  </button>
                ))
              ) : (
                <p className="px-4 py-6 text-center text-[11px] text-stone-600">No matching files</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="fixed z-50 w-44 rounded-[18px] border border-white/8 bg-[#0b0c0d] p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.45)]"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 188),
            top: Math.min(contextMenu.y, window.innerHeight - 156),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextMenu.node.kind === "folder" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(undefined);
                  void handleCreateFile(contextMenu.node);
                }}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-stone-200 transition hover:bg-white/7"
              >
                <Code2 className="h-3.5 w-3.5" />
                New File
              </button>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(undefined);
                  void handleOpenInTerminal(contextMenu.node);
                }}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-stone-200 transition hover:bg-white/7"
              >
                <SquareTerminal className="h-3.5 w-3.5" />
                Open in Terminal
              </button>
            </>
          ) : null}
          {contextMenu.node.kind === "file" ? (
            <button
              type="button"
              onClick={() => {
                handleSelectFile(contextMenu.node.path);
                setContextMenu(undefined);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-stone-200 transition hover:bg-white/7"
            >
              <Code2 className="h-3.5 w-3.5" />
              Edit File
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setContextMenu(undefined);
              void handleRenameNode(contextMenu.node);
            }}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-stone-200 transition hover:bg-white/7"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit Name
        </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(undefined);
              void handleDeleteNode(contextMenu.node);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-rose-100 transition hover:bg-rose-500/15"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      ) : null}
    </section>
  );
}

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

function HandsPage({ onNavigate }: { onNavigate: (page: AppPage) => void }) {
  const settings = useAppStore((state) => state.settings);
  const handsStatus = useAppStore((state) => state.handsStatus);
  const handsBusy = useAppStore((state) => state.handsBusy);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const refreshHandsStatus = useAppStore((state) => state.refreshHandsStatus);
  const startHandsService = useAppStore((state) => state.startHandsService);
  const stopHandsService = useAppStore((state) => state.stopHandsService);
  const [provider, setProvider] = useState(settings?.handsTunnelProvider ?? "relay");
  const [tunnelExecutable, setTunnelExecutable] = useState(settings?.handsTunnelExecutable ?? "");
  const [relayUrl, setRelayUrl] = useState(settings?.handsRelayUrl ?? "");
  const [savingSetup, setSavingSetup] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [sidebarDragState, setSidebarDragState] = useState<{ startX: number; startValue: number } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>();

  useEffect(() => {
    setProvider(settings?.handsTunnelProvider ?? "relay");
    setTunnelExecutable(settings?.handsTunnelExecutable ?? "");
    setRelayUrl(settings?.handsRelayUrl ?? "");
  }, [settings?.handsTunnelExecutable, settings?.handsTunnelProvider, settings?.handsRelayUrl]);

  useEffect(() => {
    void refreshHandsStatus();
  }, [refreshHandsStatus]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!sidebarDragState) {
      return undefined;
    }

    const onPointerMove = (event: PointerEvent) => {
      setSidebarWidth(sidebarDragState.startValue - (event.clientX - sidebarDragState.startX));
    };
    const onPointerUp = () => setSidebarDragState(null);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [sidebarDragState]);

  const isRunning = handsStatus?.state === "running";
  const publicUrl = handsStatus?.publicUrl ?? "";
  const localUrl = handsStatus?.localUrl ?? "";
  const pairingCode = handsStatus?.pairingCode ?? "";
  const executableChanged = tunnelExecutable !== (settings?.handsTunnelExecutable ?? "");
  const relayChanged = relayUrl !== (settings?.handsRelayUrl ?? "");
  const providerChanged = provider !== (settings?.handsTunnelProvider ?? "relay");
  const activityItems = handsStatus?.activity ?? [];
  const messageItems = activityItems.filter((item) => ["message", "assistant", "connection", "system"].includes(item.kind));
  const taskItems = activityItems.filter((item) => ["image", "video", "audio", "system"].includes(item.kind));
  const activeTaskCount = taskItems.filter((item) => item.status === "pending").length;
  const recentGeneratedAssets = handsStatus?.assets ?? [];
  const clampedSidebarWidth =
    viewportWidth >= 1024 ? clamp(sidebarWidth, 300, Math.max(300, Math.floor(viewportWidth * 0.38))) : 0;
  const capabilities = [
    "Chat from your phone",
    "Generate images, video, and audio remotely",
    "Keep working against your local workspace and media library",
    "Operate the machine through the same shell and agent surface the desktop app has locally",
  ];

  useEffect(() => {
    let cancelled = false;
    if (!publicUrl) {
      setQrCodeUrl(undefined);
      return undefined;
    }

    void QRCode.toDataURL(publicUrl, {
      margin: 1,
      width: 320,
      color: {
        dark: "#f4f5f4",
        light: "#0000",
      },
    })
      .then((value) => {
        if (!cancelled) {
          setQrCodeUrl(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrCodeUrl(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [publicUrl]);

  const saveTunnelSetup = async () => {
    setSavingSetup(true);
    try {
      await saveSettings({
        handsTunnelProvider: provider,
        handsTunnelExecutable: tunnelExecutable.trim(),
        handsRelayUrl: relayUrl.trim(),
      });
      await refreshHandsStatus();
    } finally {
      setSavingSetup(false);
    }
  };

  const copyValue = async (value?: string | null) => {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can fail in some contexts; the raw value stays visible.
    }
  };

  return (
    <section
      className="grid h-full min-h-0 overflow-hidden p-3"
      style={{
        gridTemplateColumns:
          viewportWidth >= 1024 ? `minmax(0,1fr) 8px ${clampedSidebarWidth}px` : "minmax(0,1fr)",
      }}
    >
      <div className="min-h-0 overflow-y-auto pr-0 lg:pr-3">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(87,180,140,0.14),rgba(12,14,16,0.98)_42%),linear-gradient(180deg,rgba(15,17,19,0.98),rgba(7,8,10,0.98))] shadow-[0_28px_90px_rgba(0,0,0,0.38)]">
            <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
              <div>
                <p className="text-[10px] uppercase tracking-[0.4em] text-[#84a09b]">Hands Agent Console</p>
                <h2 className="mt-3 max-w-3xl text-[27px] font-semibold leading-tight text-stone-100">
                  Your off-site operator page for Super ASCIIVision.
                </h2>
                <p className="mt-3 max-w-3xl text-[12px] leading-6 text-stone-300">
                  Hands is the remote agent surface. When you leave the machine, this page keeps Super ASCIIVision reachable
                  from your phone so you can continue using chat, imaging, voice, audio, local files, and the same
                  machine-level controls that make the desktop shell useful.
                </p>
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {capabilities.map((capability) => (
                    <div
                      key={capability}
                      className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3 text-[11px] leading-5 text-stone-300"
                    >
                      {capability}
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void startHandsService()}
                    disabled={handsBusy || isRunning}
                    className="rounded-2xl border border-emerald-300/18 bg-emerald-300/12 px-4 py-2 text-[11px] font-semibold text-emerald-50 transition hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {handsBusy && !isRunning ? "Starting..." : isRunning ? "Hands live" : "Start secure link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void stopHandsService()}
                    disabled={handsBusy || !isRunning}
                    className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2 text-[11px] font-semibold text-stone-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {handsBusy && isRunning ? "Stopping..." : "Stop Hands"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void refreshHandsStatus()}
                    className="rounded-2xl border border-white/8 bg-transparent px-4 py-2 text-[11px] text-stone-300 transition hover:border-white/12 hover:bg-white/5"
                  >
                    Refresh status
                  </button>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="rounded-[24px] border border-emerald-300/14 bg-emerald-300/8 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.28em] text-emerald-100/80">Link State</p>
                      <p className="mt-2 text-[20px] font-semibold text-stone-100">
                        {publicUrl ? "Secure remote URL live" : isRunning ? "Local bridge online" : "Hands offline"}
                      </p>
                    </div>
                    <div
                      className={clsx(
                        "h-3.5 w-3.5 rounded-full",
                        publicUrl
                          ? "bg-emerald-300 shadow-[0_0_24px_rgba(110,231,183,0.6)]"
                          : isRunning
                            ? "bg-amber-300 shadow-[0_0_24px_rgba(252,211,77,0.35)]"
                            : "bg-stone-600",
                      )}
                    />
                  </div>
                  <p className="mt-3 text-[11px] leading-5 text-stone-200/90">
                    {handsStatus?.tunnelStatus ?? "Hands bridge is offline."}
                  </p>
                  {handsStatus?.lastError ? (
                    <p className="mt-3 rounded-2xl border border-amber-200/18 bg-amber-300/10 px-3 py-2 text-[10px] text-amber-100">
                      {handsStatus.lastError}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[22px] border border-white/8 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Paired Phones</p>
                    <p className="mt-3 text-[28px] font-semibold text-stone-100">{handsStatus?.connections.length ?? 0}</p>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Active Tasks</p>
                    <p className="mt-3 text-[28px] font-semibold text-stone-100">{activeTaskCount}</p>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Generated Files</p>
                    <p className="mt-3 text-[28px] font-semibold text-stone-100">{recentGeneratedAssets.length}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.12fr)_minmax(340px,0.88fr)]">
            <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(12,14,16,0.98),rgba(7,8,10,0.98))] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.32em] text-[#84a09b]">Secure Entry</p>
                  <h3 className="mt-2 text-[16px] font-semibold text-stone-100">Scan or open the mobile link</h3>
                </div>
                {publicUrl ? (
                  <button
                    type="button"
                    onClick={() => void copyValue(publicUrl)}
                    className="rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-[10px] text-stone-200 transition hover:bg-white/10"
                  >
                    Copy link
                  </button>
                ) : null}
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="space-y-3">
                  <div className="rounded-[20px] border border-emerald-300/14 bg-emerald-300/8 p-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-emerald-100/80">Public URL</p>
                    <p className="mt-2 break-all font-['IBM_Plex_Mono'] text-[11px] text-emerald-50">
                      {publicUrl || "Waiting for secure tunnel startup..."}
                    </p>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Pairing Code</p>
                        <p className="mt-2 font-['IBM_Plex_Mono'] text-[18px] tracking-[0.28em] text-stone-100">
                          {pairingCode || "--------"}
                        </p>
                      </div>
                      {pairingCode ? (
                        <button
                          type="button"
                          onClick={() => void copyValue(pairingCode)}
                          className="rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-[10px] text-stone-200 transition hover:bg-white/10"
                        >
                          Copy code
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-stone-400">
                      The QR code or URL only gets the phone to the page. The pairing code is the second gate that
                      grants the session.
                    </p>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Local Bridge</p>
                    <p className="mt-2 break-all font-['IBM_Plex_Mono'] text-[11px] text-stone-200">{localUrl || "Not running"}</p>
                  </div>
                </div>

                <div className="flex flex-col rounded-[22px] border border-white/8 bg-black/20 p-3">
                  <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">QR Access</p>
                  <div className="mt-3 flex flex-1 items-center justify-center rounded-[20px] border border-dashed border-white/8 bg-white/[0.03] p-3">
                    {qrCodeUrl ? (
                      <img src={qrCodeUrl} alt="Hands secure link QR code" className="h-full max-h-[190px] w-full rounded-[16px] object-contain" />
                    ) : (
                      <p className="text-center text-[11px] leading-5 text-stone-500">
                        Start Hands and wait for the secure URL. The QR code will appear here automatically.
                      </p>
                    )}
                  </div>
                  <p className="mt-3 text-[10px] leading-5 text-stone-500">
                    Scan this from your phone, enter the pairing code, then the session can continue while you are away.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(12,14,16,0.98),rgba(7,8,10,0.98))] p-4">
              <p className="text-[10px] uppercase tracking-[0.32em] text-[#84a09b]">Agent Identity</p>
              <h3 className="mt-2 text-[16px] font-semibold text-stone-100">Hands is the page for off-site machine work</h3>
              <div className="mt-4 space-y-3 text-[11px] leading-6 text-stone-300">
                <p>
                  Treat Hands as the remote operator surface for the whole app, not a separate feature silo. From the
                  phone, it should be obvious that Hands can reach chat, imaging, voice, audio, files, generated media,
                  and local command execution.
                </p>
                <p>
                  It is the closest thing in this app to an OpenClaw or Claude Code style machine agent: a remote page
                  for staying attached to the desktop while you are away.
                </p>
                <div className="rounded-[20px] border border-white/8 bg-black/20 p-3">
                  <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Integrated surfaces</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["Chat", "Image & Video", "Voice & Audio", "Media", "Workspace", "Shell", "Files"].map((surface) => (
                      <span
                        key={surface}
                        className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[10px] text-stone-300"
                      >
                        {surface}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.92fr)]">
            <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(11,12,14,0.98),rgba(7,8,10,0.98))] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.32em] text-[#84a09b]">Remote Activity</p>
                  <h3 className="mt-2 text-[16px] font-semibold text-stone-100">Phone conversations and agent events</h3>
                </div>
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 font-['IBM_Plex_Mono'] text-[10px] text-stone-400">
                  {messageItems.length} events
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {messageItems.length ? (
                  messageItems.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 transition hover:bg-white/[0.05]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={clsx(
                              "rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.22em]",
                              item.kind === "assistant"
                                ? "bg-sky-300/12 text-sky-100"
                                : item.kind === "message"
                                  ? "bg-emerald-300/12 text-emerald-100"
                                  : "bg-white/[0.06] text-stone-300",
                            )}
                          >
                            {item.kind}
                          </span>
                          <p className="text-[12px] font-semibold text-stone-100">{item.title}</p>
                        </div>
                        <p className="text-[10px] text-stone-500">{formatTimestamp(item.createdAt)}</p>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-stone-300">{item.body}</p>
                    </article>
                  ))
                ) : (
                  <EmptyPanel
                    eyebrow="Hands"
                    title="Waiting for the first remote event."
                    body="Once a phone pairs, this feed will show mobile prompts, AI replies, tunnel events, and remote work traces."
                  />
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(11,12,14,0.98),rgba(7,8,10,0.98))] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.32em] text-[#84a09b]">Hands Workspace</p>
                  <h3 className="mt-2 text-[16px] font-semibold text-stone-100">Generated files and machine traces</h3>
                </div>
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 font-['IBM_Plex_Mono'] text-[10px] text-stone-400">
                  {recentGeneratedAssets.length} files
                </span>
              </div>
              <p className="mt-2 break-all font-['IBM_Plex_Mono'] text-[10px] text-stone-500">
                {handsStatus?.workspaceDir ?? "hands-workspace"}
              </p>
              <div className="mt-4 space-y-2">
                {recentGeneratedAssets.length ? (
                  recentGeneratedAssets.map((asset) => (
                    <article key={asset.id} className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[12px] font-semibold text-stone-100">{asset.fileName}</p>
                          <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-stone-500">{asset.kind}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {asset.kind !== "audio" ? (
                            <button
                              type="button"
                              onClick={() => onNavigate("imagine")}
                              className="rounded-xl border border-sky-300/18 bg-sky-300/10 px-3 py-1.5 text-[10px] text-sky-100 transition hover:bg-sky-300/16"
                            >
                              Open in Image & Video
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void copyValue(asset.filePath)}
                            className="rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-[10px] text-stone-200 transition hover:bg-white/10"
                          >
                            Copy path
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-stone-300">{asset.prompt}</p>
                      <p className="mt-2 break-all font-['IBM_Plex_Mono'] text-[10px] text-stone-500">{asset.filePath}</p>
                    </article>
                  ))
                ) : (
                  <p className="rounded-[18px] border border-dashed border-white/8 px-3 py-4 text-[11px] leading-5 text-stone-500">
                    Remote image, video, and audio outputs will land here with their on-disk locations.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(12,14,16,0.98),rgba(7,8,10,0.98))] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.32em] text-[#84a09b]">Tunnel Setup</p>
                <h3 className="mt-2 text-[16px] font-semibold text-stone-100">Transport provider and relay setup</h3>
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.75fr)]">
              <div>
                <label className="block">
                  <span className="mb-2 block text-[10px] uppercase tracking-[0.28em] text-stone-500">Provider</span>
                  <select
                    value={provider}
                    onChange={(event) => setProvider(event.target.value)}
                    className="w-full rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2 text-[11px] text-stone-100 outline-none transition focus:border-emerald-300/30"
                  >
                    <option value="relay">Hands Relay</option>
                    <option value="cloudflare">Cloudflare tunnel</option>
                  </select>
                </label>
                <label className="mt-4 block">
                  <span className="mb-2 block text-[10px] uppercase tracking-[0.28em] text-stone-500">Your Relay URL</span>
                  <input
                    value={relayUrl}
                    onChange={(event) => setRelayUrl(event.target.value)}
                    placeholder="https://your-hands-relay.onrender.com"
                    className="w-full rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2 font-['IBM_Plex_Mono'] text-[11px] text-stone-100 outline-none transition focus:border-emerald-300/30"
                  />
                  <span className="mt-1.5 block text-[10px] leading-[1.5] text-amber-300/70">
                    You must deploy your own relay. All Hands traffic (messages, generated files) passes through this server.
                    Never use someone else's relay URL — they could see your data. Deploy the hands-relay folder to Render
                    (free tier) or any HTTPS host you control. See the README for setup steps.
                  </span>
                </label>
                <label className="block">
                  <span className="mb-2 block text-[10px] uppercase tracking-[0.28em] text-stone-500">Tunnel Executable</span>
                  <input
                    value={tunnelExecutable}
                    onChange={(event) => setTunnelExecutable(event.target.value)}
                    placeholder="cloudflared"
                    className="w-full rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2 font-['IBM_Plex_Mono'] text-[11px] text-stone-100 outline-none transition focus:border-emerald-300/30"
                  />
                </label>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void saveTunnelSetup()}
                    disabled={savingSetup || (!executableChanged && !relayChanged && !providerChanged)}
                    className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2 text-[11px] font-semibold text-stone-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {savingSetup ? "Saving..." : "Save setup"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProvider(settings?.handsTunnelProvider ?? "relay");
                      setTunnelExecutable(settings?.handsTunnelExecutable ?? "");
                      setRelayUrl(settings?.handsRelayUrl ?? "");
                    }}
                    disabled={savingSetup || (!executableChanged && !relayChanged && !providerChanged)}
                    className="rounded-2xl border border-white/8 bg-transparent px-4 py-2 text-[11px] text-stone-400 transition hover:border-white/14 hover:text-stone-100 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Reset
                  </button>
                </div>
              </div>
              <div className="rounded-[20px] border border-white/8 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Short-term recommendation</p>
                <ol className="mt-3 space-y-2 text-[11px] leading-5 text-stone-400">
                  <li>1. Use `Hands Relay` when you control a deployed relay host and want your own public URL layer.</li>
                  <li>2. Use `Cloudflare tunnel` only as a fallback if you still want the binary-based route.</li>
                  <li>3. QR plus pairing code remains the primary phone onboarding flow for both providers.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>

      {viewportWidth >= 1024 ? (
        <>
          <ResizeHandle
            orientation="vertical"
            onPointerDown={(event) =>
              setSidebarDragState({
                startX: event.clientX,
                startValue: clampedSidebarWidth,
              })
            }
          />
          <aside className="min-h-0 overflow-y-auto">
            <div className="space-y-3 rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,11,13,0.99),rgba(7,8,10,0.98))] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
              <div>
                <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">Task Monitor</p>
                <h3 className="mt-2 text-[17px] font-semibold text-stone-100">Live agents and jobs</h3>
                <p className="mt-2 text-[11px] leading-5 text-stone-400">
                  This rail is the operations view for Hands: queued media work, tunnel status, paired devices, and the
                  most recent machine-side events.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">Running Now</p>
                  <p className="mt-2 text-[24px] font-semibold text-stone-100">{activeTaskCount}</p>
                </div>
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">Last Activity</p>
                  <p className="mt-2 text-[11px] leading-5 text-stone-300">{formatTimestamp(handsStatus?.lastActivityAt)}</p>
                </div>
              </div>

              <div className="rounded-[20px] border border-white/8 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">Recent Tasks</p>
                  <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 font-['IBM_Plex_Mono'] text-[9px] text-stone-400">
                    {taskItems.length}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {taskItems.length ? (
                    taskItems.map((item) => (
                      <div key={item.id} className="rounded-[16px] border border-white/8 bg-white/[0.03] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={clsx(
                              "rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.22em]",
                              item.status === "pending"
                                ? "bg-amber-300/12 text-amber-100"
                                : item.status === "error"
                                  ? "bg-rose-300/12 text-rose-100"
                                  : "bg-emerald-300/12 text-emerald-100",
                            )}
                          >
                            {item.status}
                          </span>
                          <p className="text-[10px] text-stone-500">{formatTimestamp(item.createdAt)}</p>
                        </div>
                        <p className="mt-2 text-[11px] font-semibold text-stone-100">{item.title}</p>
                        <p className="mt-1 text-[10px] leading-5 text-stone-400">{item.body}</p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-[16px] border border-dashed border-white/8 px-3 py-4 text-[11px] leading-5 text-stone-500">
                      No remote tasks yet. Start Hands and send work from the phone.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-[20px] border border-white/8 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">Connected Phones</p>
                <div className="mt-3 space-y-2">
                  {handsStatus?.connections.length ? (
                    handsStatus.connections.map((connection) => (
                      <div key={connection.id} className="rounded-[16px] border border-white/8 bg-white/[0.03] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[12px] font-semibold text-stone-100">{connection.label}</p>
                          <Wifi className="h-4 w-4 text-emerald-200" />
                        </div>
                        <p className="mt-2 text-[10px] text-stone-500">Connected {formatTimestamp(connection.connectedAt)}</p>
                        <p className="mt-1 text-[10px] text-stone-500">Last seen {formatTimestamp(connection.lastSeenAt)}</p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-[16px] border border-dashed border-white/8 px-3 py-4 text-[11px] leading-5 text-stone-500">
                      No paired sessions yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </>
      ) : null}
    </section>
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

function EditorPage({
  clips,
  activeClipId,
  onSelectClip,
  onUpdateClip,
  onRemoveClip,
  onAddClip,
  onReorderClips,
  onClear,
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
  clipboardRef,
}: {
  clips: EditorClip[];
  activeClipId?: string;
  onSelectClip: (clipId?: string) => void;
  onUpdateClip: (clipId: string, patch: Partial<EditorClip>) => void;
  onRemoveClip: (clipId: string) => void;
  onAddClip: (clip: EditorClip) => void;
  onReorderClips: (clips: EditorClip[]) => void;
  onClear: () => void;
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
  clipboardRef: React.MutableRefObject<EditorClip | null>;
}) {
  const chrome = useContext(ShellChromeContext);
  const mediaCategories = useAppStore((state) => state.mediaCategories);
  const selectedMediaCategoryId = useAppStore((state) => state.selectedMediaCategoryId);
  const exportingEditor = useAppStore((state) => state.exportingEditor);
  const exportEditorTimeline = useAppStore((state) => state.exportEditorTimeline);
  const importLocalMediaAsset = useAppStore((state) => state.importLocalMediaAsset);
  const ensureMediaLoaded = useAppStore((state) => state.ensureMediaLoaded);
  const [exportTitle, setExportTitle] = useState("Editor Export");
  const [exportCategoryId, setExportCategoryId] = useState<string>(selectedMediaCategoryId ?? "");
  const [importing, setImporting] = useState(false);
  const [previewSources, setPreviewSources] = useState<Record<string, string>>({});
  const [exportOpen, setExportOpen] = useState(false);
  const [exportToast, setExportToast] = useState<string>();
  const exportDropRef = useRef<HTMLDivElement>(null);

  // Playback state
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const lastFrameRef = useRef<number | undefined>(undefined);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const audioPreviewRef = useRef<HTMLAudioElement>(null);

  // Timeline zoom
  const [timelineZoom, setTimelineZoom] = useState(100);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<EditorContextMenu>();

  // Subtitle editing
  const [editingSubId, setEditingSubId] = useState<string>();
  const [editingSubText, setEditingSubText] = useState("");

  // Overlay state
  const [activeOverlayId, setActiveOverlayId] = useState<string>();
  const overlayClipboardRef = useRef<OverlayClip | null>(null);

  // Preview drag state for subtitles and overlays
  const [previewDrag, setPreviewDrag] = useState<{ type: "subtitle" | "overlay"; id: string; startX: number; startY: number; origX: number; origY: number }>();
  const [resizeDrag, setResizeDrag] = useState<{ id: string; startX: number; startY: number; origW: number; origH: number }>();
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // Drag-to-reorder
  const [clipDrag, setClipDrag] = useState<{ clipId: string; startX: number; currentX: number; track: "visual" | "audio" }>();

  // Subtitle timeline drag
  const [subDrag, setSubDrag] = useState<{ id: string; startX: number; origStart: number; origEnd: number }>();

  // Overlay timeline trim drag
  const [ovTrimDrag, setOvTrimDrag] = useState<{ id: string; side: "start" | "end"; startX: number; origStart: number; origEnd: number }>();

  // Trim drag
  const [trimDrag, setTrimDrag] = useState<{ clip: EditorClip; side: "start" | "end"; startX: number; frozenDuration: number }>();
  const tracksLaneRef = useRef<HTMLDivElement>(null);

  const visualTrack = useMemo(() => buildTimelineTrack(clips, "visual"), [clips]);
  const audioTrack = useMemo(() => buildTimelineTrack(clips, "audio"), [clips]);
  const timelineDuration = Math.max(visualTrack.duration, audioTrack.duration,
    subtitleClips.length ? Math.max(...subtitleClips.map((s) => s.end)) : 0,
    overlayClips.length ? Math.max(...overlayClips.map((o) => o.end)) : 0, 1);

  // Determine which clip is at playhead for preview
  const playheadVisualItem = useMemo(() => findClipAtTime(visualTrack.items, currentTime), [visualTrack.items, currentTime]);
  const playheadAudioItem = useMemo(() => findClipAtTime(audioTrack.items, currentTime), [audioTrack.items, currentTime]);
  const previewClip = playheadVisualItem?.clip ?? playheadAudioItem?.clip ?? clips[clips.length - 1];
  const previewSrc = previewClip ? previewSources[previewClip.asset.id] : undefined;

  useEffect(() => { void ensureMediaLoaded(); }, [ensureMediaLoaded]);

  useEffect(() => {
    if (!exportCategoryId && selectedMediaCategoryId) {
      setExportCategoryId(selectedMediaCategoryId);
    }
  }, [exportCategoryId, selectedMediaCategoryId]);

  // Preview source loading (clips + overlays)
  useEffect(() => {
    let cancelled = false;
    const missingClips = clips.filter((clip) => !previewSources[clip.asset.id]).map((c) => ({ id: c.asset.id, path: c.asset.filePath }));
    const missingOverlays = overlayClips.filter((ov) => !previewSources[ov.assetId]).map((o) => ({ id: o.assetId, path: o.filePath }));
    const allMissing = [...missingClips, ...missingOverlays];
    if (!allMissing.length) return undefined;
    void Promise.all(
      allMissing.map(async (m) => ({ assetId: m.id, src: await api.readMediaDataUrl(m.path) })),
    )
      .then((entries) => {
        if (cancelled) return;
        setPreviewSources((current) => ({ ...current, ...Object.fromEntries(entries.map((e) => [e.assetId, e.src])) }));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [clips, overlayClips, previewSources]);

  // Probe actual media duration for clips that don't have one yet
  useEffect(() => {
    const needDuration = clips.filter((c) => c.mediaDuration === undefined && c.asset.kind !== "image" && previewSources[c.asset.id]);
    if (!needDuration.length) return;
    needDuration.forEach((clip) => {
      const src = previewSources[clip.asset.id];
      const el = clip.asset.kind === "video" ? document.createElement("video") : document.createElement("audio");
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        if (Number.isFinite(el.duration) && el.duration > 0) {
          onUpdateClip(clip.id, { mediaDuration: el.duration } as Partial<EditorClip>);
        }
        el.src = "";
      };
      el.src = src;
    });
  }, [clips, previewSources, onUpdateClip]);

  // Auto-select latest clip
  useEffect(() => {
    if (!clips.length) { if (activeClipId) onSelectClip(undefined); return; }
    if (!activeClipId || !clips.some((c) => c.id === activeClipId)) onSelectClip(clips[clips.length - 1]?.id);
  }, [activeClipId, clips, onSelectClip]);

  // Dismiss export dropdown
  useEffect(() => {
    if (!exportOpen) return undefined;
    const dismiss = (e: PointerEvent) => { if (!exportDropRef.current?.contains(e.target as Node)) setExportOpen(false); };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [exportOpen]);

  // Dismiss context menu
  useEffect(() => {
    if (!ctxMenu) return undefined;
    const dismiss = () => setCtxMenu(undefined);
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") dismiss(); });
    return () => { window.removeEventListener("pointerdown", dismiss); };
  }, [ctxMenu]);

  // Audio elements map for playback
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  // Keep audio element pool in sync with audio track items
  useEffect(() => {
    const map = audioElementsRef.current;
    for (const item of audioTrack.items) {
      const src = previewSources[item.clip.asset.id];
      if (!src) continue;
      let el = map.get(item.clip.id);
      if (!el) {
        el = document.createElement("audio");
        el.preload = "auto";
        el.src = src;
        map.set(item.clip.id, el);
      } else if (!el.src.includes(item.clip.asset.id)) {
        el.src = src;
      }
    }
    const activeIds = new Set(audioTrack.items.map((i) => i.clip.id));
    for (const [id, el] of map) {
      if (!activeIds.has(id)) { el.pause(); el.src = ""; map.delete(id); }
    }
  }, [audioTrack.items, previewSources]);

  // Refs for data the RAF loop needs (avoids stale closures)
  const audioTrackItemsRef = useRef(audioTrack.items);
  audioTrackItemsRef.current = audioTrack.items;
  const visualTrackItemsRef = useRef(visualTrack.items);
  visualTrackItemsRef.current = visualTrack.items;

  // Sync media helper — called from RAF loop, NOT from an effect
  const syncMedia = useCallback((time: number) => {
    // Audio sync
    const map = audioElementsRef.current;
    for (const item of audioTrackItemsRef.current) {
      const el = map.get(item.clip.id);
      if (!el) continue;
      const trimStart = parseSecondsInput(item.clip.trimStart, 0) ?? 0;
      const speed = getEditorClipSpeed(item.clip);
      if (time >= item.start && time < item.end) {
        const offset = trimStart + (time - item.start) * speed;
        if (Math.abs(el.currentTime - offset) > 0.5) {
          el.currentTime = offset;
        }
        el.playbackRate = speed;
        if (el.paused) void el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
      }
    }
    // Video sync
    const vid = videoPreviewRef.current;
    if (vid) {
      const visItem = findClipAtTime(visualTrackItemsRef.current, time);
      if (visItem && visItem.clip.asset.kind === "video") {
        const trimStart = parseSecondsInput(visItem.clip.trimStart, 0) ?? 0;
        const speed = getEditorClipSpeed(visItem.clip);
        const offset = trimStart + (time - visItem.start) * speed;
        if (Math.abs(vid.currentTime - offset) > 0.5) {
          vid.currentTime = offset;
        }
        vid.playbackRate = speed;
        if (vid.paused) void vid.play().catch(() => {});
      } else {
        if (!vid.paused) vid.pause();
      }
    }
  }, []);

  // Playback RAF loop — advances time AND syncs media in one place
  useEffect(() => {
    if (!playing) {
      lastFrameRef.current = undefined;
      // Pause all audio
      for (const el of audioElementsRef.current.values()) el.pause();
      // Pause video
      const vid = videoPreviewRef.current;
      if (vid && !vid.paused) vid.pause();
      return undefined;
    }
    // Initial sync at play start
    syncMedia(currentTimeRef.current);
    let lastSyncTime = performance.now();
    const tick = (now: number) => {
      if (lastFrameRef.current !== undefined) {
        const dt = (now - lastFrameRef.current) / 1000;
        setCurrentTime((t) => {
          const next = t + dt;
          if (next >= timelineDuration) { setPlaying(false); return timelineDuration; }
          currentTimeRef.current = next;
          return next;
        });
        // Throttle media sync to every ~200ms to avoid constant play/pause churn
        if (now - lastSyncTime > 200) {
          syncMedia(currentTimeRef.current);
          lastSyncTime = now;
        }
      }
      lastFrameRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, timelineDuration, syncMedia]);

  // Cleanup audio elements on unmount
  useEffect(() => {
    const map = audioElementsRef.current;
    return () => { for (const el of map.values()) { el.pause(); el.src = ""; } map.clear(); };
  }, []);

  // Spacebar play/pause
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isEditableTarget(e.target)) {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Trim drag global handlers
  useEffect(() => {
    if (!trimDrag) return undefined;
    const onPointerMove = (e: PointerEvent) => {
      const width = tracksLaneRef.current?.getBoundingClientRect().width;
      if (!width || width <= 0) return;
      const deltaRatio = (e.clientX - trimDrag.startX) / width;
      // Use frozen duration from drag start so rescaling doesn't cause drift
      const deltaSeconds = deltaRatio * trimDrag.frozenDuration;
      onUpdateClip(trimDrag.clip.id, buildClipTrimPatch(trimDrag.clip, trimDrag.side, deltaSeconds));
    };
    const onPointerUp = () => setTrimDrag(undefined);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => { window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp); };
  }, [onUpdateClip, trimDrag]);

  // Preview drag for subtitles and overlays
  useEffect(() => {
    if (!previewDrag) return undefined;
    const onPointerMove = (e: PointerEvent) => {
      const rect = previewContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = ((e.clientX - previewDrag.startX) / rect.width) * 100;
      const dy = ((e.clientY - previewDrag.startY) / rect.height) * 100;
      const nx = Math.max(0, Math.min(100, previewDrag.origX + dx));
      const ny = Math.max(0, Math.min(100, previewDrag.origY + dy));
      if (previewDrag.type === "subtitle") onUpdateSubtitle(previewDrag.id, { x: nx, y: ny });
      else onUpdateOverlay(previewDrag.id, { x: nx, y: ny });
    };
    const onPointerUp = () => setPreviewDrag(undefined);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => { window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp); };
  }, [previewDrag, onUpdateSubtitle, onUpdateOverlay]);

  // Overlay resize drag
  useEffect(() => {
    if (!resizeDrag) return undefined;
    const onPointerMove = (e: PointerEvent) => {
      const rect = previewContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dw = ((e.clientX - resizeDrag.startX) / rect.width) * 100;
      const dh = ((e.clientY - resizeDrag.startY) / rect.height) * 100;
      const nw = Math.max(5, Math.min(100, resizeDrag.origW + dw));
      const nh = Math.max(5, Math.min(100, resizeDrag.origH + dh));
      onUpdateOverlay(resizeDrag.id, { width: nw, height: nh });
    };
    const onPointerUp = () => setResizeDrag(undefined);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => { window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp); };
  }, [resizeDrag, onUpdateOverlay]);

  // Subtitle timeline drag (left/right)
  useEffect(() => {
    if (!subDrag) return undefined;
    const onPointerMove = (e: PointerEvent) => {
      const rect = tracksLaneRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const deltaRatio = (e.clientX - subDrag.startX) / rect.width;
      const deltaSecs = deltaRatio * timelineDuration;
      const dur = subDrag.origEnd - subDrag.origStart;
      const newStart = Math.max(0, subDrag.origStart + deltaSecs);
      onUpdateSubtitle(subDrag.id, { start: newStart, end: newStart + dur });
    };
    const onPointerUp = () => setSubDrag(undefined);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => { window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp); };
  }, [subDrag, timelineDuration, onUpdateSubtitle]);

  // Overlay timeline trim drag
  useEffect(() => {
    if (!ovTrimDrag) return undefined;
    const onPointerMove = (e: PointerEvent) => {
      const rect = tracksLaneRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const deltaRatio = (e.clientX - ovTrimDrag.startX) / rect.width;
      const deltaSecs = deltaRatio * timelineDuration;
      if (ovTrimDrag.side === "start") {
        const newStart = Math.max(0, Math.min(ovTrimDrag.origEnd - 0.5, ovTrimDrag.origStart + deltaSecs));
        onUpdateOverlay(ovTrimDrag.id, { start: newStart });
      } else {
        const newEnd = Math.max(ovTrimDrag.origStart + 0.5, ovTrimDrag.origEnd + deltaSecs);
        onUpdateOverlay(ovTrimDrag.id, { end: newEnd });
      }
    };
    const onPointerUp = () => setOvTrimDrag(undefined);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => { window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp); };
  }, [ovTrimDrag, timelineDuration, onUpdateOverlay]);

  // Cmd/Ctrl + scroll wheel zoom on tracks
  useEffect(() => {
    const el = tracksLaneRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        setTimelineZoom((z) => Math.max(50, Math.min(800, z + (e.deltaY < 0 ? 25 : -25))));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Clip drag-to-reorder global handlers
  useEffect(() => {
    if (!clipDrag) return undefined;
    const onPointerMove = (e: PointerEvent) => setClipDrag((d) => d ? { ...d, currentX: e.clientX } : d);
    const onPointerUp = () => {
      if (clipDrag && tracksLaneRef.current) {
        const rect = tracksLaneRef.current.getBoundingClientRect();
        const ratio = (clipDrag.currentX - rect.left) / rect.width;
        const targetTime = Math.max(0, ratio * timelineDuration);
        const isVisualTrack = clipDrag.track === "visual";
        const trackClips = clips.filter((c) => isVisualTrack ? c.asset.kind !== "audio" : c.asset.kind === "audio");
        const otherClips = clips.filter((c) => isVisualTrack ? c.asset.kind === "audio" : c.asset.kind !== "audio");
        const movingClip = trackClips.find((c) => c.id === clipDrag.clipId);
        if (movingClip) {
          const remaining = trackClips.filter((c) => c.id !== clipDrag.clipId);
          let insertIdx = remaining.length;
          let cursor = 0;
          for (let i = 0; i < remaining.length; i++) {
            const dur = getEditorClipDuration(remaining[i]);
            if (targetTime < cursor + dur / 2) { insertIdx = i; break; }
            cursor += dur;
          }
          remaining.splice(insertIdx, 0, movingClip);
          // Rebuild full clips array: reordered track clips interleaved with other track clips in original order
          const merged: EditorClip[] = [];
          let ti = 0, oi = 0;
          for (const c of clips) {
            const belongsToTrack = isVisualTrack ? c.asset.kind !== "audio" : c.asset.kind === "audio";
            if (belongsToTrack) {
              if (ti < remaining.length) merged.push(remaining[ti++]);
            } else {
              if (oi < otherClips.length) merged.push(otherClips[oi++]);
            }
          }
          while (ti < remaining.length) merged.push(remaining[ti++]);
          while (oi < otherClips.length) merged.push(otherClips[oi++]);
          onReorderClips(merged);
        }
      }
      setClipDrag(undefined);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => { window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp); };
  }, [clipDrag, clips, onReorderClips, timelineDuration]);

  // (playhead clip lookups moved above effects)

  // Active subtitle at playhead
  const activeSubtitle = subtitleClips.find((s) => currentTime >= s.start && currentTime < s.end);

  const handleSeek = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setCurrentTime(ratio * timelineDuration);
    setPlaying(false);
  };

  const handleExport = () => {
    void (async () => {
      try {
        await exportEditorTimeline({
          title: exportTitle.trim() || "Editor Export",
          categoryId: exportCategoryId || undefined,
          clips: clips.map((clip) => ({
            assetId: clip.asset.id,
            kind: clip.asset.kind,
            filePath: clip.asset.filePath,
            trimStart: Number.isFinite(Number(clip.trimStart)) ? Number(clip.trimStart) : 0,
            trimEnd: clip.trimEnd.trim() && Number.isFinite(Number(clip.trimEnd)) ? Number(clip.trimEnd) : undefined,
            stillDuration: clip.asset.kind === "image" && Number.isFinite(Number(clip.stillDuration)) ? Number(clip.stillDuration) : 3,
          })),
          overlays: overlayClips.length ? overlayClips.map((ov) => ({
            filePath: ov.filePath,
            start: ov.start,
            end: ov.end,
            x: ov.x,
            y: ov.y,
            width: ov.width,
          })) : undefined,
        });
        setExportToast("Video exported successfully");
        setTimeout(() => setExportToast(undefined), 3000);
      } catch {
        setExportToast("Export failed");
        setTimeout(() => setExportToast(undefined), 4000);
      }
    })();
    setExportOpen(false);
  };

  // Context menu actions
  const handleCtxAction = (action: string) => {
    if (!ctxMenu) return;
    const clip = clips.find((c) => c.id === ctxMenu.clipId);
    if (!clip && action !== "paste") return;
    switch (action) {
      case "speed-125": if (clip) onUpdateClip(clip.id, { speed: String(getEditorClipSpeed(clip) * 1.25) }); break;
      case "speed-150": if (clip) onUpdateClip(clip.id, { speed: "1.5" }); break;
      case "speed-200": if (clip) onUpdateClip(clip.id, { speed: "2" }); break;
      case "slow-075": if (clip) onUpdateClip(clip.id, { speed: String(getEditorClipSpeed(clip) * 0.75) }); break;
      case "slow-050": if (clip) onUpdateClip(clip.id, { speed: "0.5" }); break;
      case "slow-025": if (clip) onUpdateClip(clip.id, { speed: "0.25" }); break;
      case "reset-speed": if (clip) onUpdateClip(clip.id, { speed: "1" }); break;
      case "copy": if (clip) clipboardRef.current = { ...clip }; break;
      case "paste": {
        const cb = clipboardRef.current;
        if (cb) {
          const newClip = createEditorClip(cb.asset);
          newClip.trimStart = cb.trimStart;
          newClip.trimEnd = cb.trimEnd;
          newClip.stillDuration = cb.stillDuration;
          newClip.speed = cb.speed;
          chrome?.openEditorAsset(cb.asset);
        }
        break;
      }
      case "delete": if (clip) onRemoveClip(clip.id); break;
      case "split": {
        if (!clip) break;
        // Find the track item and split at playhead
        const allItems = [...visualTrack.items, ...audioTrack.items];
        const item = allItems.find((it) => it.clip.id === clip.id);
        if (!item || currentTime <= item.start || currentTime >= item.end) break;
        const splitPoint = currentTime - item.start;
        const originalStart = parseSecondsInput(clip.trimStart, 0) ?? 0;
        onUpdateClip(clip.id, { trimEnd: formatEditableDuration(originalStart + splitPoint) });
        const newClip = createEditorClip(clip.asset);
        newClip.trimStart = formatEditableDuration(originalStart + splitPoint);
        newClip.trimEnd = clip.trimEnd;
        newClip.speed = clip.speed;
        chrome?.openEditorAsset(clip.asset);
        break;
      }
      case "move-to-overlay": {
        if (!clip || clip.asset.kind !== "image") break;
        const ov: OverlayClip = {
          id: `ov-${Date.now()}`,
          assetId: clip.asset.id,
          filePath: clip.asset.filePath,
          start: 0, end: 5,
          x: 50, y: 50, width: 30, height: 30,
        };
        onAddOverlay(ov);
        onRemoveClip(clip.id);
        break;
      }
      case "move-to-visual": {
        const ovClip = overlayClips.find((o) => o.id === ctxMenu.clipId);
        if (!ovClip) break;
        const imgAsset: MediaAsset = {
          id: ovClip.assetId,
          kind: "image",
          modelId: "overlay",
          prompt: "Image overlay",
          filePath: ovClip.filePath,
          status: "completed",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        onAddClip(createEditorClip(imgAsset));
        onRemoveOverlay(ovClip.id);
        break;
      }
      case "extract-audio": {
        if (!clip || clip.asset.kind !== "video") break;
        void (async () => {
          try {
            const extracted = await api.extractAudio(clip.asset.filePath);
            chrome?.openEditorAsset(extracted);
          } catch (err) {
            console.error("Failed to extract audio:", err);
          }
        })();
        break;
      }
    }
    setCtxMenu(undefined);
  };

  const renderTrackClips = (items: TimelineTrackItem[], trackType: "visual" | "audio") =>
    items.length ? (
      items.map((item) => {
        const width = Math.max((item.duration / timelineDuration) * 100, 1);
        const left = (item.start / timelineDuration) * 100;
        const accent =
          item.clip.asset.kind === "image"
            ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
            : item.clip.asset.kind === "video"
              ? "border-sky-300/20 bg-sky-300/12 text-sky-50"
              : "border-amber-300/20 bg-amber-300/12 text-amber-50";
        const isDragging = clipDrag?.clipId === item.clip.id;
        const speedLabel = getEditorClipSpeed(item.clip) !== 1 ? ` · ${getEditorClipSpeed(item.clip).toFixed(2)}×` : "";

        return (
          <button
            key={item.clip.id}
            type="button"
            onClick={() => { onSelectClip(item.clip.id); setCurrentTime(item.start); }}
            onContextMenu={(e) => { e.preventDefault(); onSelectClip(item.clip.id); setCtxMenu({ clipId: item.clip.id, trackType, x: e.clientX, y: e.clientY }); }}
            onPointerDown={(e) => {
              if (e.button === 0) {
                e.stopPropagation();
                setClipDrag({ clipId: item.clip.id, startX: e.clientX, currentX: e.clientX, track: trackType });
              }
            }}
            className={clsx(
              "absolute bottom-1.5 top-1.5 overflow-hidden rounded-[14px] border px-2 py-1 text-left transition cursor-grab",
              isDragging ? "opacity-60 ring-2 ring-amber-300/30" : "",
              item.clip.id === activeClipId ? accent : "border-white/10 bg-white/[0.04] text-stone-200 hover:bg-white/[0.08]",
            )}
            style={{
              left: `${Math.min(left, 96)}%`,
              width: `${Math.min(width, 100 - Math.min(left, 96))}%`,
            }}
          >
            <span
              className="absolute inset-y-1 left-0 w-1.5 cursor-ew-resize rounded-l-[14px] bg-white/0 transition hover:bg-white/15"
              onPointerDown={(e) => { e.stopPropagation(); setTrimDrag({ clip: item.clip, side: "start", startX: e.clientX, frozenDuration: timelineDuration }); }}
            />
            <span
              className="absolute inset-y-1 right-0 w-1.5 cursor-ew-resize rounded-r-[14px] bg-white/0 transition hover:bg-white/15"
              onPointerDown={(e) => { e.stopPropagation(); setTrimDrag({ clip: item.clip, side: "end", startX: e.clientX, frozenDuration: timelineDuration }); }}
            />
            <p className="truncate font-['IBM_Plex_Mono'] text-[8px] uppercase tracking-[0.16em] text-current/70">
              {formatTimelineSeconds(item.start)}–{formatTimelineSeconds(item.end)}{speedLabel}
            </p>
            <p className="mt-0.5 line-clamp-1 text-[9px] leading-4">{item.clip.asset.prompt}</p>
          </button>
        );
      })
    ) : (
      <div className="flex h-full min-h-[44px] items-center justify-center rounded-[12px] border border-dashed border-white/8 bg-white/[0.02] text-[9px] text-stone-500">
        {trackType === "visual" ? "Drop image/video clips here" : "Drop audio clips here"}
      </div>
    );

  // Ruler markers
  const rulerCount = Math.max(7, Math.round(timelineZoom / 15));
  const rulers = Array.from({ length: rulerCount }, (_, i) => {
    const ratio = i / (rulerCount - 1);
    return { left: `${ratio * 100}%`, value: timelineDuration * ratio };
  });

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/6 px-3 py-2.5">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">Editor</p>
            <h2 className="text-[15px] font-semibold text-stone-100">Media Editor</h2>
          </div>
          <div className="flex gap-1.5 text-[9px] text-stone-400">
            <span className="rounded-full border border-white/7 bg-white/[0.03] px-2 py-0.5">{visualTrack.items.length} visual</span>
            <span className="rounded-full border border-white/7 bg-white/[0.03] px-2 py-0.5">{audioTrack.items.length} audio</span>
            <span className="rounded-full border border-white/7 bg-white/[0.03] px-2 py-0.5">{subtitleClips.length} subs</span>
            <span className="rounded-full border border-white/7 bg-white/[0.03] px-2 py-0.5 font-['IBM_Plex_Mono']">{formatTimelineSeconds(timelineDuration)}</span>
          </div>
        </div>
        <button
          type="button"
          disabled={importing}
          onClick={async () => {
            try {
              const selection = await openDialog({
                multiple: false,
                filters: [{ name: "Media", extensions: ["mp4", "mov", "mp3", "wav", "png", "jpg", "jpeg", "gif", "webp"] }],
              });
              if (typeof selection === "string") {
                setImporting(true);
                try { const asset = await importLocalMediaAsset(selection); if (asset) chrome?.openEditorAsset(asset); }
                finally { setImporting(false); }
              }
            } catch (err) { console.error("Failed to import media:", err); }
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/18 bg-emerald-300/10 px-2.5 py-1 text-[10px] text-emerald-50 transition hover:bg-emerald-300/16 disabled:opacity-50"
        >
          <FolderPlus className="h-3 w-3" />
          {importing ? "Importing…" : "Import"}
        </button>
      </div>

      {/* Preview */}
      <div className="relative flex h-[280px] shrink-0 items-center justify-center overflow-hidden border-b border-white/6 bg-[radial-gradient(circle_at_top,rgba(38,56,54,0.18),rgba(3,5,7,0.98)_62%)]">
        {/* Aspect ratio toggle */}
        <div className="absolute right-2 top-2 z-10 flex rounded-lg border border-white/8 bg-black/50 text-[8px]">
          <button type="button" onClick={() => onSetEditorAspect("landscape")} className={clsx("rounded-l-lg px-2 py-1 transition", editorAspect === "landscape" ? "bg-white/15 text-stone-100" : "text-stone-400 hover:text-stone-200")}>16:9</button>
          <button type="button" onClick={() => onSetEditorAspect("vertical")} className={clsx("rounded-r-lg px-2 py-1 transition", editorAspect === "vertical" ? "bg-white/15 text-stone-100" : "text-stone-400 hover:text-stone-200")}>9:16</button>
        </div>
        {/* Preview container with aspect ratio */}
        <div
          ref={previewContainerRef}
          className="relative overflow-hidden rounded-lg border border-white/5 bg-black"
          style={editorAspect === "landscape" ? { width: "min(100%, 497px)", aspectRatio: "16/9" } : { height: "100%", aspectRatio: "9/16" }}
        >
          {previewClip && previewSrc ? (
            previewClip.asset.kind === "video" ? (
              <video ref={videoPreviewRef} src={previewSrc} muted className="h-full w-full object-contain" />
            ) : previewClip.asset.kind === "audio" ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-amber-300/20 bg-amber-300/10 text-amber-100">
                  <AudioLines className="h-6 w-6" />
                </div>
                <p className="max-w-xs text-center text-[11px] text-stone-300">{previewClip.asset.prompt}</p>
                <audio ref={audioPreviewRef} src={previewSrc} />
              </div>
            ) : (
              <img src={previewSrc} alt={previewClip.asset.prompt} className="h-full w-full object-contain" />
            )
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <p className="text-[11px] text-stone-500">{clips.length ? "Loading preview…" : "Add clips to begin editing"}</p>
            </div>
          )}
          {/* Overlay images on preview */}
          {overlayClips.filter((ov) => currentTime >= ov.start && currentTime < ov.end).map((ov) => {
            const ovSrc = previewSources[ov.assetId];
            if (!ovSrc) return null;
            const isActive = activeOverlayId === ov.id;
            return (
              <div
                key={ov.id}
                className={clsx("absolute cursor-move select-none", isActive ? "ring-2 ring-pink-400 rounded" : "")}
                style={{ left: `${ov.x}%`, top: `${ov.y}%`, width: `${ov.width}%`, transform: "translate(-50%, -50%)" }}
                onPointerDown={(e) => { e.stopPropagation(); setActiveOverlayId(ov.id); setPreviewDrag({ type: "overlay", id: ov.id, startX: e.clientX, startY: e.clientY, origX: ov.x, origY: ov.y }); }}
              >
                <img src={ovSrc} alt="overlay" className="h-full w-full object-contain" draggable={false} />
                {isActive ? (
                  <div
                    className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-pink-400 bg-pink-900"
                    onPointerDown={(e) => { e.stopPropagation(); setResizeDrag({ id: ov.id, startX: e.clientX, startY: e.clientY, origW: ov.width, origH: ov.height }); }}
                  />
                ) : null}
              </div>
            );
          })}
          {/* Subtitle overlay — draggable with font size controls */}
          {activeSubtitle ? (
            <div
              className="absolute z-10 select-none"
              style={{ left: `${activeSubtitle.x}%`, top: `${activeSubtitle.y}%`, transform: "translate(-50%, -50%)" }}
            >
              <div
                className="cursor-move rounded-lg bg-black/70 px-4 py-2 font-medium text-white"
                style={{ fontSize: `${activeSubtitle.fontSize ?? 16}px` }}
                onPointerDown={(e) => { e.stopPropagation(); setPreviewDrag({ type: "subtitle", id: activeSubtitle.id, startX: e.clientX, startY: e.clientY, origX: activeSubtitle.x, origY: activeSubtitle.y }); }}
              >
                {activeSubtitle.text}
              </div>
              {/* Font size controls */}
              <div className="mt-1 flex items-center justify-center gap-1">
                <button type="button" onClick={(e) => { e.stopPropagation(); onUpdateSubtitle(activeSubtitle.id, { fontSize: Math.max(8, (activeSubtitle.fontSize ?? 16) - 2) }); }} className="flex h-5 w-5 items-center justify-center rounded bg-black/60 text-[10px] text-white/70 hover:text-white">−</button>
                <span className="text-[8px] text-white/50">{activeSubtitle.fontSize ?? 16}px</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); onUpdateSubtitle(activeSubtitle.id, { fontSize: Math.min(72, (activeSubtitle.fontSize ?? 16) + 2) }); }} className="flex h-5 w-5 items-center justify-center rounded bg-black/60 text-[10px] text-white/70 hover:text-white">+</button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-3 border-b border-white/6 px-3 py-2">
        <button type="button" onClick={() => { setCurrentTime(0); setPlaying(false); }} className="rounded-lg p-1 text-stone-400 transition hover:bg-white/8 hover:text-stone-200">
          <SkipBack className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-300/20 bg-amber-300/12 text-amber-50 transition hover:bg-amber-300/20"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </button>
        <button type="button" onClick={() => { setCurrentTime(timelineDuration); setPlaying(false); }} className="rounded-lg p-1 text-stone-400 transition hover:bg-white/8 hover:text-stone-200">
          <SkipForward className="h-4 w-4" />
        </button>
        <span className="font-['IBM_Plex_Mono'] text-[11px] text-stone-300">
          {formatTimelineSeconds(currentTime)} / {formatTimelineSeconds(timelineDuration)}
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-white/6 px-3 py-1.5">
        <div className="flex items-center gap-2">
          {/* Zoom */}
          <button type="button" onClick={() => setTimelineZoom((z) => Math.max(50, z - 25))} className="rounded-lg p-1 text-stone-400 hover:bg-white/8 hover:text-stone-200">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="font-['IBM_Plex_Mono'] text-[9px] text-stone-400">{timelineZoom}%</span>
          <button type="button" onClick={() => setTimelineZoom((z) => Math.min(800, z + 25))} className="rounded-lg p-1 text-stone-400 hover:bg-white/8 hover:text-stone-200">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <div className="mx-1 h-4 w-px bg-white/8" />
          {/* Add subtitle */}
          <button
            type="button"
            onClick={() => {
              const sub: SubtitleClip = { id: `sub-${Date.now()}`, text: "Subtitle", start: currentTime, end: Math.min(currentTime + 3, timelineDuration), x: 50, y: 90, fontSize: 16 };
              onAddSubtitle(sub);
              setEditingSubId(sub.id);
              setEditingSubText(sub.text);
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] text-stone-400 hover:bg-white/8 hover:text-stone-200"
          >
            <Captions className="h-3.5 w-3.5" />
            Subtitle
          </button>
          {/* Add image overlay */}
          <button
            type="button"
            onClick={async () => {
              try {
                const selection = await openDialog({
                  multiple: false,
                  filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
                });
                if (typeof selection === "string") {
                  const asset = await importLocalMediaAsset(selection);
                  if (asset) {
                    const ov: OverlayClip = {
                      id: `ov-${Date.now()}`,
                      assetId: asset.id,
                      filePath: asset.filePath,
                      start: currentTime,
                      end: Math.min(currentTime + 5, timelineDuration || 5),
                      x: 50, y: 50, width: 30, height: 30,
                    };
                    onAddOverlay(ov);
                    setActiveOverlayId(ov.id);
                  }
                }
              } catch (err) { console.error("Failed to add overlay:", err); }
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] text-stone-400 hover:bg-white/8 hover:text-stone-200"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            Overlay
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* Export dropdown */}
          <div className="relative" ref={exportDropRef}>
            <button
              type="button"
              onClick={() => setExportOpen((o) => !o)}
              disabled={!clips.length || exportingEditor}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-300/18 bg-amber-300/10 px-2.5 py-1 text-[9px] font-semibold text-amber-50 transition hover:bg-amber-300/16 disabled:opacity-50"
            >
              <Download className="h-3 w-3" />
              {exportingEditor ? "Exporting…" : "Export"}
            </button>
            {exportOpen ? (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-white/10 bg-[#0f1012] p-2.5 shadow-2xl">
                <input value={exportTitle} onChange={(e) => setExportTitle(e.target.value)} placeholder="Title" className="w-full rounded-lg border border-white/8 bg-black/30 px-2 py-1.5 text-[10px] text-stone-100 outline-none focus:border-amber-300/35" />
                <select value={exportCategoryId} onChange={(e) => setExportCategoryId(e.target.value)} className="mt-1.5 w-full rounded-lg border border-white/8 bg-black/30 px-2 py-1.5 text-[10px] text-stone-100 outline-none">
                  <option value="">Auto-categorize</option>
                  {mediaCategories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
                <button type="button" onClick={handleExport} disabled={exportingEditor} className="mt-1.5 w-full rounded-lg border border-amber-300/20 bg-amber-300/12 px-2 py-1.5 text-[10px] font-semibold text-amber-50 hover:bg-amber-300/18 disabled:opacity-50">
                  Export Video
                </button>
              </div>
            ) : null}
          </div>
          <button type="button" onClick={onClear} disabled={!clips.length || exportingEditor} className="rounded-lg px-2 py-1 text-[9px] text-stone-400 hover:bg-white/8 hover:text-rose-300 disabled:opacity-50">
            Clear
          </button>
        </div>
      </div>

      {/* Tracks */}
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
        <div style={{ minWidth: `${timelineZoom}%` }} className="relative px-2.5 py-2">
          {/* Ruler */}
          <div className="relative h-5 rounded-[10px] border border-white/6 bg-black/20" onClick={handleSeek}>
            {rulers.map((m) => (
              <div key={m.left} className="absolute inset-y-0" style={{ left: m.left }}>
                <div className="h-full w-px bg-white/8" />
                <span className="absolute left-1 top-1/2 -translate-y-1/2 font-['IBM_Plex_Mono'] text-[7px] text-stone-500">{formatTimelineSeconds(m.value)}</span>
              </div>
            ))}
            {/* Playhead on ruler */}
            <div className="absolute inset-y-0 z-10 w-0.5 bg-amber-400" style={{ left: `${(currentTime / timelineDuration) * 100}%` }} />
          </div>

          {/* Track lanes — labels left, lanes + playhead right */}
          <div className="mt-2 grid gap-x-1.5 gap-y-1.5 md:grid-cols-[72px_minmax(0,1fr)]">
            {/* Track labels column */}
            <div className="flex flex-col gap-1.5">
              <div className="flex min-h-[52px] items-center rounded-[10px] border border-white/8 bg-black/20 px-2 py-2">
                <p className="font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.2em] text-stone-400">Visual</p>
              </div>
              <div className="flex min-h-[52px] items-center rounded-[10px] border border-white/8 bg-black/20 px-2 py-2">
                <p className="font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.2em] text-stone-400">Audio</p>
              </div>
              <div className="flex min-h-[52px] items-center rounded-[10px] border border-white/8 bg-black/20 px-2 py-2">
                <p className="font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.2em] text-stone-400">Overlay</p>
              </div>
              <div className="flex min-h-[52px] items-center rounded-[10px] border border-white/8 bg-black/20 px-2 py-2">
                <p className="font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.2em] text-stone-400">Subs</p>
              </div>
            </div>

            {/* Lanes + playhead column */}
            <div ref={tracksLaneRef} className="relative flex flex-col gap-1.5" onClick={handleSeek}>
              {/* Playhead line */}
              <div
                className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-amber-400/80"
                style={{ left: `${(currentTime / timelineDuration) * 100}%` }}
              >
                <div className="absolute -left-1 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400" />
              </div>

              {/* Visual lane */}
              <div className="relative min-h-[52px] rounded-[12px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,10,12,0.95),rgba(6,7,9,0.98))] p-1.5">
                {renderTrackClips(visualTrack.items, "visual")}
              </div>

              {/* Audio lane */}
              <div className="relative min-h-[52px] rounded-[12px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,10,12,0.95),rgba(6,7,9,0.98))] p-1.5">
                {renderTrackClips(audioTrack.items, "audio")}
              </div>

              {/* Overlay lane */}
              <div className="relative min-h-[52px] rounded-[12px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,10,12,0.95),rgba(6,7,9,0.98))] p-1.5">
                {overlayClips.length ? (
                  overlayClips.map((ov) => {
                    const left = (ov.start / timelineDuration) * 100;
                    const width = Math.max(((ov.end - ov.start) / timelineDuration) * 100, 4);
                    return (
                      <button
                        key={ov.id}
                        type="button"
                        className={clsx(
                          "absolute bottom-1.5 top-1.5 overflow-hidden rounded-[10px] border px-2 py-1 text-left cursor-grab",
                          activeOverlayId === ov.id
                            ? "border-pink-300/30 bg-pink-300/15 text-pink-50"
                            : "border-pink-300/20 bg-pink-300/10 text-pink-50 hover:bg-pink-300/15",
                        )}
                        style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                        onClick={(e) => { e.stopPropagation(); setActiveOverlayId(ov.id); setCurrentTime(ov.start); }}
                        onContextMenu={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          setCtxMenu({ clipId: ov.id, trackType: "overlay", x: e.clientX, y: e.clientY });
                        }}
                      >
                        {/* Left trim handle */}
                        <span
                          className="absolute inset-y-1 left-0 w-1.5 cursor-ew-resize rounded-l-[10px] bg-white/0 transition hover:bg-white/15"
                          onPointerDown={(e) => { e.stopPropagation(); setOvTrimDrag({ id: ov.id, side: "start", startX: e.clientX, origStart: ov.start, origEnd: ov.end }); }}
                        />
                        {/* Right trim handle */}
                        <span
                          className="absolute inset-y-1 right-0 w-1.5 cursor-ew-resize rounded-r-[10px] bg-white/0 transition hover:bg-white/15"
                          onPointerDown={(e) => { e.stopPropagation(); setOvTrimDrag({ id: ov.id, side: "end", startX: e.clientX, origStart: ov.start, origEnd: ov.end }); }}
                        />
                        <p className="truncate font-['IBM_Plex_Mono'] text-[8px] text-current/70">{formatTimelineSeconds(ov.start)}–{formatTimelineSeconds(ov.end)}</p>
                        <p className="truncate text-[9px] leading-4">Image overlay</p>
                      </button>
                    );
                  })
                ) : (
                  <div className="flex h-full min-h-[44px] items-center justify-center rounded-[10px] border border-dashed border-white/8 bg-white/[0.02] text-[9px] text-stone-500">
                    Drag images here for overlays
                  </div>
                )}
              </div>

              {/* Subtitle lane */}
              <div className="relative min-h-[52px] rounded-[12px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,10,12,0.95),rgba(6,7,9,0.98))] p-1.5">
                {subtitleClips.length ? (
                  subtitleClips.map((sub) => {
                    const left = (sub.start / timelineDuration) * 100;
                    const width = Math.max(((sub.end - sub.start) / timelineDuration) * 100, 4);
                    return (
                      <div
                        key={sub.id}
                        className={clsx(
                          "absolute bottom-1.5 top-1.5 overflow-hidden rounded-[10px] border px-2 py-1 text-left cursor-pointer",
                          editingSubId === sub.id
                            ? "border-violet-300/30 bg-violet-300/15 text-violet-50"
                            : "border-violet-300/15 bg-violet-300/8 text-violet-100 hover:bg-violet-300/12",
                        )}
                        style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, cursor: "grab" }}
                        onClick={(e) => { e.stopPropagation(); setEditingSubId(sub.id); setEditingSubText(sub.text); setCurrentTime(sub.start); }}
                        onPointerDown={(e) => { if (e.button === 0 && editingSubId !== sub.id) { e.stopPropagation(); setSubDrag({ id: sub.id, startX: e.clientX, origStart: sub.start, origEnd: sub.end }); } }}
                        onContextMenu={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          setCtxMenu({ clipId: sub.id, trackType: "subtitle", x: e.clientX, y: e.clientY });
                        }}
                      >
                        {editingSubId === sub.id ? (
                          <input
                            autoFocus
                            value={editingSubText}
                            onChange={(e) => setEditingSubText(e.target.value)}
                            onBlur={() => { onUpdateSubtitle(sub.id, { text: editingSubText }); setEditingSubId(undefined); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { onUpdateSubtitle(sub.id, { text: editingSubText }); setEditingSubId(undefined); } }}
                            className="w-full bg-transparent text-[9px] text-violet-50 outline-none"
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <p className="truncate text-[9px] leading-4">{sub.text}</p>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="flex h-full min-h-[44px] items-center justify-center rounded-[10px] border border-dashed border-white/8 bg-white/[0.02] text-[9px] text-stone-500">
                    Add subtitles via toolbar
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Export toast */}
      {exportToast ? (
        <div className="pointer-events-none fixed inset-x-0 top-6 z-[9999] flex justify-center">
          <div className={clsx(
            "pointer-events-auto rounded-xl border px-4 py-2 text-[12px] font-medium shadow-xl",
            exportToast.includes("failed")
              ? "border-rose-400/20 bg-rose-950/90 text-rose-200"
              : "border-emerald-400/20 bg-emerald-950/90 text-emerald-200",
          )}>
            {exportToast}
          </div>
        </div>
      ) : null}

      {/* Context menu */}
      {ctxMenu ? (
        <div
          className="fixed z-[9999] min-w-[160px] max-h-[80vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0f1012] py-1 shadow-2xl"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 180), ...(ctxMenu.y > window.innerHeight * 0.5 ? { bottom: window.innerHeight - ctxMenu.y } : { top: ctxMenu.y }) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {ctxMenu.trackType === "subtitle" ? (
            <>
              <button type="button" onClick={() => { const sub = subtitleClips.find((s) => s.id === ctxMenu.clipId); if (sub) { setEditingSubId(sub.id); setEditingSubText(sub.text); } setCtxMenu(undefined); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8">
                <Pencil className="h-3 w-3" /> Edit Text
              </button>
              <button type="button" onClick={() => { onRemoveSubtitle(ctxMenu.clipId); setCtxMenu(undefined); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-rose-300 hover:bg-white/8">
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </>
          ) : ctxMenu.trackType === "overlay" ? (
            <>
              <button type="button" onClick={() => handleCtxAction("move-to-visual")} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8">
                <Video className="h-3 w-3" /> Move to Visual
              </button>
              <button type="button" onClick={() => { const ov = overlayClips.find((o) => o.id === ctxMenu.clipId); if (ov) overlayClipboardRef.current = { ...ov }; setCtxMenu(undefined); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8">
                <Copy className="h-3 w-3" /> Copy
              </button>
              <button type="button" onClick={() => { const cb = overlayClipboardRef.current; if (cb) { onAddOverlay({ ...cb, id: `ov-${Date.now()}`, start: currentTime, end: currentTime + (cb.end - cb.start) }); } setCtxMenu(undefined); }} disabled={!overlayClipboardRef.current} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8 disabled:text-stone-600">
                <Plus className="h-3 w-3" /> Paste
              </button>
              <div className="my-1 h-px bg-white/8" />
              <button type="button" onClick={() => { onRemoveOverlay(ctxMenu.clipId); setCtxMenu(undefined); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-rose-300 hover:bg-white/8">
                <Trash2 className="h-3 w-3" /> Delete Overlay
              </button>
            </>
          ) : (
            <>
              <div className="px-3 py-1 text-[8px] uppercase tracking-[0.2em] text-stone-500">Speed</div>
              <button type="button" onClick={() => handleCtxAction("speed-200")} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8">
                <FastForward className="h-3 w-3" /> 2× Fast
              </button>
              <button type="button" onClick={() => handleCtxAction("speed-150")} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8">
                <FastForward className="h-3 w-3" /> 1.5× Fast
              </button>
              <button type="button" onClick={() => handleCtxAction("slow-050")} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8">
                <Gauge className="h-3 w-3" /> 0.5× Slow
              </button>
              <button type="button" onClick={() => handleCtxAction("slow-025")} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8">
                <Gauge className="h-3 w-3" /> 0.25× Slow
              </button>
              <button type="button" onClick={() => handleCtxAction("reset-speed")} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8">
                <RefreshCcw className="h-3 w-3" /> Reset Speed
              </button>
              <div className="my-1 h-px bg-white/8" />
              <button type="button" onClick={() => handleCtxAction("split")} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8">
                <Scissors className="h-3 w-3" /> Split at Playhead
              </button>
              {(() => { const c = clips.find((cl) => cl.id === ctxMenu.clipId); return (
                <>
                  {c?.asset.kind === "video" ? (
                    <button type="button" onClick={() => handleCtxAction("extract-audio")} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8">
                      <AudioLines className="h-3 w-3" /> Extract Audio
                    </button>
                  ) : null}
                  {c?.asset.kind === "image" ? (
                    <button type="button" onClick={() => handleCtxAction("move-to-overlay")} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8">
                      <ImagePlus className="h-3 w-3" /> Move to Overlay
                    </button>
                  ) : null}
                </>
              ); })()}
              <div className="my-1 h-px bg-white/8" />
              <button type="button" onClick={() => handleCtxAction("copy")} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8">
                <Copy className="h-3 w-3" /> Copy
              </button>
              <button type="button" onClick={() => handleCtxAction("paste")} disabled={!clipboardRef.current} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-stone-200 hover:bg-white/8 disabled:text-stone-600">
                <Plus className="h-3 w-3" /> Paste
              </button>
              <div className="my-1 h-px bg-white/8" />
              <button type="button" onClick={() => handleCtxAction("delete")} className="flex w-full items-center gap-2 px-3 py-1.5 text-[10px] text-rose-300 hover:bg-white/8">
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function BrowserPanel() {
  const browserUrl = useAppStore((state) => state.browserUrl);
  const browserDraftUrl = useAppStore((state) => state.browserDraftUrl);
  const browserPreviewHtml = useAppStore((state) => state.browserPreviewHtml);
  const detectedServerUrl = useAppStore((state) => state.detectedServerUrl);
  const setBrowserDraftUrl = useAppStore((state) => state.setBrowserDraftUrl);
  const openBrowserUrl = useAppStore((state) => state.openBrowserUrl);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/6 px-4 py-4">
        <h2 className="text-[13px] font-semibold text-stone-100">Browser</h2>
        <p className="mt-1 text-[10px] text-stone-500">
          {browserPreviewHtml
            ? "Previewing the current snippet or generated asset."
            : "Load localhost apps started from the footer terminal."}
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={browserDraftUrl}
            onChange={(event) => setBrowserDraftUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                openBrowserUrl();
              }
            }}
            className="min-w-0 flex-1 rounded-xl border border-white/8 bg-black/35 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none focus:border-sky-300/40"
          />
          <button
            type="button"
            onClick={() => openBrowserUrl()}
            className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-white/10"
          >
            Open
          </button>
        </div>
        {detectedServerUrl ? (
          <button
            type="button"
            onClick={() => openBrowserUrl(detectedServerUrl)}
            className="mt-3 rounded-xl border border-sky-300/18 bg-sky-300/10 px-3 py-2 text-[10px] text-sky-100 transition hover:bg-sky-300/16"
          >
            Use detected server: {detectedServerUrl}
          </button>
        ) : (
          <p className="mt-3 text-[10px] text-stone-500">
            Start a local server in the terminal and this panel will detect localhost URLs.
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 bg-[#0c0d0e]">
        {browserPreviewHtml ? (
          <iframe
            title="Super ASCIIVision browser preview"
            srcDoc={browserPreviewHtml}
            sandbox="allow-scripts allow-same-origin"
            className="h-full w-full border-0 bg-[#050607]"
          />
        ) : (
          <iframe title="Super ASCIIVision browser" src={browserUrl} className="h-full w-full border-0 bg-[#050607]" />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Music player components
// ---------------------------------------------------------------------------

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

function AsciiVisionPanel({ onClose }: { onClose: () => void }) {
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

function TerminalPanel() {
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
