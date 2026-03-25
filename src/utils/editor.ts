import type { MediaAsset } from "../types";
import { formatEditableDuration, parseSecondsInput } from "./formatting";

export interface EditorClip {
  id: string;
  asset: MediaAsset;
  trimStart: string;
  trimEnd: string;
  stillDuration: string;
  speed: string;
  mediaDuration?: number;
}

export interface TimelineTrackItem {
  clip: EditorClip;
  start: number;
  duration: number;
  end: number;
}

export function createEditorClip(asset: MediaAsset): EditorClip {
  return {
    id: `${asset.id}-${Date.now()}`,
    asset,
    trimStart: "0",
    trimEnd: "",
    stillDuration: "3",
    speed: "1",
  };
}

export function getEditorClipSpeed(clip: EditorClip) {
  const s = parseSecondsInput(clip.speed, 1) ?? 1;
  return Math.max(0.25, Math.min(4, s));
}

export function getEditorClipDuration(clip: EditorClip) {
  const speed = getEditorClipSpeed(clip);
  if (clip.asset.kind === "image") {
    return Math.max((parseSecondsInput(clip.stillDuration, 3) ?? 3) / speed, 0.5);
  }
  const trimStart = parseSecondsInput(clip.trimStart, 0) ?? 0;
  const trimEnd = parseSecondsInput(clip.trimEnd);
  if (trimEnd !== undefined && trimEnd > trimStart) {
    return Math.max((trimEnd - trimStart) / speed, 0.5);
  }
  // Use actual media duration if known, otherwise fallback
  const fallback = clip.mediaDuration ?? (clip.asset.kind === "video" ? 6 : 8);
  return Math.max((fallback - trimStart) / speed, 0.5);
}

export function buildTimelineTrack(clips: EditorClip[], track: "visual" | "audio") {
  let cursor = 0;
  const items: TimelineTrackItem[] = [];

  clips.forEach((clip) => {
    const belongsToTrack = track === "visual" ? clip.asset.kind !== "audio" : clip.asset.kind === "audio";
    if (!belongsToTrack) {
      return;
    }
    const duration = getEditorClipDuration(clip);
    items.push({
      clip,
      start: cursor,
      duration,
      end: cursor + duration,
    });
    cursor += duration;
  });

  return { items, duration: cursor };
}

export function findClipAtTime(items: TimelineTrackItem[], time: number): TimelineTrackItem | undefined {
  return items.find((item) => time >= item.start && time < item.end);
}

export function buildClipTrimPatch(clip: EditorClip, side: "start" | "end", deltaSeconds: number): Partial<EditorClip> {
  if (clip.asset.kind === "image") {
    const currentDuration = getEditorClipDuration(clip);
    const nextDuration =
      side === "start"
        ? Math.max(0.5, currentDuration - deltaSeconds)
        : Math.max(0.5, currentDuration + deltaSeconds);
    return { stillDuration: formatEditableDuration(nextDuration) };
  }

  const currentStart = parseSecondsInput(clip.trimStart, 0) ?? 0;
  const currentDuration = getEditorClipDuration(clip);
  const currentEnd = parseSecondsInput(clip.trimEnd, currentStart + currentDuration) ?? currentStart + currentDuration;

  if (side === "start") {
    const nextStart = Math.max(0, Math.min(currentEnd - 0.5, currentStart + deltaSeconds));
    return { trimStart: formatEditableDuration(nextStart) };
  }

  const nextEnd = Math.max(currentStart + 0.5, currentEnd + deltaSeconds);
  return { trimEnd: formatEditableDuration(nextEnd) };
}
