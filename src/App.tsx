

import clsx from "clsx";
import { Files, Globe } from "lucide-react";
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
import { useEffect, useMemo, useRef, useState } from "react";

import { useAppStore } from "./store/appStore";
import type { AppPage, OverlayClip, SubtitleClip } from "./types";
import { clamp } from "./utils/formatting";
import { createEditorClip } from "./utils/editor";
import type { EditorClip } from "./utils/editor";
import { isEditableTarget } from "./utils/dom";
import { BrowserPanel } from "./components/BrowserPanel";
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
import { HistoryRail } from "./components/layout/HistoryRail";
import { MusicMiniPlayer } from "./components/layout/MusicMiniPlayer";
import { MusicSidebar } from "./components/layout/MusicSidebar";
import { SettingsSheet } from "./components/layout/SettingsSheet";
import { TerminalPanel } from "./components/layout/TerminalPanel";
import { TopBar } from "./components/layout/TopBar";
import { WorkspaceDrawer } from "./components/layout/WorkspaceDrawer";

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


/* TopBar extracted to src/components/layout/TopBar.tsx */

/* HistoryRail + ConversationCard extracted to src/components/layout/HistoryRail.tsx */

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

/* MusicSidebar extracted to src/components/layout/MusicSidebar.tsx */


/* MusicSidebar extracted to src/components/layout/MusicSidebar.tsx */

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


/* WorkspaceDrawer + WorkspaceItemRow extracted to src/components/layout/WorkspaceDrawer.tsx */

/* MusicMiniPlayer extracted to src/components/layout/MusicMiniPlayer.tsx */

/* TilesPage and TileTerminal extracted to src/pages/TilesPage.tsx */

/* AsciiVisionPanel extracted to src/components/layout/AsciiVisionPanel.tsx */

/* TerminalPanel extracted to src/components/layout/TerminalPanel.tsx */

/* SettingsSheet extracted to src/components/layout/SettingsSheet.tsx */


export default App;
