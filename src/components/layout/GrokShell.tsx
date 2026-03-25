import clsx from "clsx";
import { Files, Globe } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAppStore } from "../../store/appStore";
import type { AppPage, OverlayClip, SubtitleClip } from "../../types";
import { clamp } from "../../utils/formatting";
import { createEditorClip } from "../../utils/editor";
import type { EditorClip } from "../../utils/editor";
import { isEditableTarget } from "../../utils/dom";
import { BrowserPanel } from "../BrowserPanel";
import { ResizeHandle } from "../ResizeHandle";
import { ShellChromeContext } from "../ShellChromeContext";
import type { ShellChromeActions } from "../ShellChromeContext";
import { ChatPage } from "../../pages/ChatPage";
import { EditorPage } from "../../pages/EditorPage";
import { HandsPage } from "../../pages/HandsPage";
import { IdePage } from "../../pages/IdePage";
import { ImaginePage } from "../../pages/ImaginePage";
import { MusicPage } from "../../pages/MusicPage";
import { TilesPage } from "../../pages/TilesPage";
import { VoiceAudioPage } from "../../pages/VoiceAudioPage";
import { AsciiVisionPanel } from "./AsciiVisionPanel";
import { HistoryRail } from "./HistoryRail";
import { MusicMiniPlayer } from "./MusicMiniPlayer";
import { MusicSidebar } from "./MusicSidebar";
import { SettingsSheet } from "./SettingsSheet";
import { TerminalPanel } from "./TerminalPanel";
import { TopBar } from "./TopBar";
import { WorkspaceDrawer } from "./WorkspaceDrawer";

type RightPanelMode = "workspace" | "browser";
type DragMode = "left" | "right" | "footer";

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  startValue: number;
}

export function GrokShell() {
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
