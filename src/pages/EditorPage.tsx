import { open as openDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import {
  AudioLines,
  Captions,
  Copy,
  Download,
  FastForward,
  FolderPlus,
  Gauge,
  ImagePlus,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Video,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ShellChromeContext } from "../components/ShellChromeContext";
import { api } from "../lib/tauri";
import { useAppStore } from "../store/appStore";
import type { MediaAsset } from "../types";
import { isEditableTarget } from "../utils/dom";
import { buildClipTrimPatch, buildTimelineTrack, createEditorClip, findClipAtTime, getEditorClipDuration, getEditorClipSpeed } from "../utils/editor";
import type { EditorClip, TimelineTrackItem } from "../utils/editor";
import { formatEditableDuration, formatTimelineSeconds, parseSecondsInput } from "../utils/formatting";

export interface SubtitleClip {
  id: string;
  text: string;
  start: number;
  end: number;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  fontSize: number; // pixels
}

export interface OverlayClip {
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

export interface EditorContextMenu {
  clipId: string;
  trackType: "visual" | "audio" | "subtitle" | "overlay";
  x: number;
  y: number;
}

export function EditorPage({
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
