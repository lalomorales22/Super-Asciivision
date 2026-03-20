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
  ChevronRight,
  ChevronDown,
  Code2,
  Copy,
  Disc3,
  Download,
  Eye,
  Files,
  Folder,
  FolderPlus,
  FolderOpen,
  Globe,
  ImagePlus,
  LayoutGrid,
  ListMusic,
  MoveDown,
  MoveUp,
  MessageSquarePlus,
  Mic,
  Music,
  Pause,
  Pencil,
  Pin,
  Play,
  RefreshCcw,
  Repeat,
  Repeat1,
  Save,
  Send,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  SquareTerminal,
  Trash2,
  Video,
  Volume2,
  VolumeX,
  WandSparkles,
  Wifi,
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
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Terminal as XTerm } from "xterm";
import { api, events } from "./lib/tauri";
import { useAppStore } from "./store/appStore";
import type { MediaAsset, Message, Settings, StreamEvent, WorkspaceItem, WorkspaceMediaFile } from "./types";

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

type AppPage = "tiles" | "chat" | "imagine" | "voice" | "editor" | "ide" | "hands" | "music";
type RightPanelMode = "workspace" | "browser";
type DragMode = "left" | "right" | "footer";

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  startValue: number;
}

interface ShellChromeActions {
  openBrowserPreview: (html: string) => void;
  openEditorAsset: (asset: MediaAsset) => void;
}

interface EditorClip {
  id: string;
  asset: MediaAsset;
  trimStart: string;
  trimEnd: string;
  stillDuration: string;
}

interface TimelineTrackItem {
  clip: EditorClip;
  start: number;
  duration: number;
  end: number;
}

interface IdeTreeNode {
  id: string;
  name: string;
  path: string;
  kind: "folder" | "file";
  file?: WorkspaceItem;
  children?: IdeTreeNode[];
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

const ShellChromeContext = createContext<ShellChromeActions | null>(null);

const CHAT_MODELS = [
  "grok-4-1-fast-reasoning",
  "grok-4-1-fast-non-reasoning",
  "grok-code-fast-1",
  "grok-4-fast-reasoning",
  "grok-4-fast-non-reasoning",
  "grok-4-0709",
  "grok-3-mini",
  "grok-3",
];

const IMAGE_MODELS = ["grok-imagine-image-pro", "grok-imagine-image"];
const VIDEO_MODELS = ["grok-imagine-video"];
const IMAGE_ASPECT_OPTIONS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const IMAGE_RESOLUTION_OPTIONS = ["1k", "2k"];
const XAI_VOICE_OPTIONS = [
  { id: "eve", label: "Eve" },
  { id: "ara", label: "Ara" },
  { id: "rex", label: "Rex" },
  { id: "sal", label: "Sal" },
  { id: "leo", label: "Leo" },
];
const REALTIME_AUDIO_RATE = 24_000;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function estimateSelectedTokens(items: WorkspaceItem[], selection: Record<string, boolean>) {
  return Math.round(
    items
      .filter((item) => selection[item.id] && item.chunkCount > 0)
      .reduce((sum, item) => sum + item.byteSize, 0) / 4,
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPreviewDocument(code: string, language?: string) {
  const normalized = (language ?? "").toLowerCase();
  if (["html", "htm"].includes(normalized)) {
    return code;
  }
  if (normalized === "css") {
    return `<!doctype html><html><head><style>${code}</style></head><body><main class="preview-root">CSS preview</main></body></html>`;
  }
  if (["javascript", "js", "mjs"].includes(normalized)) {
    return `<!doctype html><html><body><div id="app"></div><script type="module">${code}</script></body></html>`;
  }
  return `<!doctype html><html><body style="margin:0;background:#070809;color:#f5f5f4;font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;"><pre style="margin:0;padding:18px;white-space:pre-wrap;">${escapeHtml(code)}</pre></body></html>`;
}

function buildAssetPreviewDocument(asset: MediaAsset, src: string) {
  const shell = "margin:0;min-height:100vh;background:#050607;color:#f5f5f4;color-scheme:dark;";
  const scrollbar =
    "html{scrollbar-color:rgba(132,160,155,0.48) #050607;}::-webkit-scrollbar{width:12px;height:12px;background:#050607;}::-webkit-scrollbar-thumb{border-radius:999px;background:linear-gradient(180deg,rgba(132,160,155,0.55),rgba(125,211,252,0.4));border:2px solid #050607;}::-webkit-scrollbar-corner{background:#050607;}";
  const fitStyle =
    "display:block;width:auto;height:auto;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);object-fit:contain;margin:auto;";
  if (asset.kind === "image") {
    return `<!doctype html><html><head><style>${scrollbar}</style></head><body style="${shell}display:grid;place-items:center;padding:12px;overflow:auto;"><img src="${src}" style="${fitStyle}" /></body></html>`;
  }
  if (asset.kind === "video") {
    return `<!doctype html><html><head><style>${scrollbar}</style></head><body style="${shell}display:grid;place-items:center;padding:12px;overflow:auto;"><video src="${src}" controls autoplay style="${fitStyle}" playsinline></video></body></html>`;
  }
  return `<!doctype html><html><head><style>${scrollbar}</style></head><body style="${shell}display:grid;place-items:center;font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;"><audio src="${src}" controls autoplay></audio></body></html>`;
}

function extensionForLanguage(language?: string) {
  switch ((language ?? "").toLowerCase()) {
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "javascript":
    case "js":
    case "mjs":
      return "js";
    case "typescript":
    case "ts":
      return "ts";
    case "tsx":
      return "tsx";
    case "json":
      return "json";
    case "rust":
    case "rs":
      return "rs";
    case "python":
    case "py":
      return "py";
    case "markdown":
    case "md":
      return "md";
    default:
      return "txt";
  }
}

function leafName(path: string) {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "Never";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function parentPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : "";
}

function renamedPath(path: string, nextName: string) {
  const parent = parentPath(path);
  return parent ? `${parent}/${nextName}` : nextName;
}

function replacePathPrefix(path: string, from: string, to: string) {
  if (path === from) {
    return to;
  }
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function formatEditableDuration(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const normalized = Math.max(0, value);
  return normalized.toFixed(2).replace(/\.?0+$/, "");
}

function shouldStartWindowDrag(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return true;
  }

  return !target.closest(
    '[data-no-drag="true"],button,input,select,textarea,a,[role="button"],[contenteditable="true"]',
  );
}

function relativeWorkspacePath(path: string, roots: string[]) {
  const normalizedPath = path.replace(/\\/g, "/");
  for (const root of roots) {
    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalizedPath === normalizedRoot) {
      return leafName(normalizedPath);
    }
    if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
      return normalizedPath.slice(normalizedRoot.length + 1);
    }
  }
  return leafName(normalizedPath);
}

function isSameOrDescendantPath(path: string, root: string) {
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function buildIdeTree(items: WorkspaceItem[], roots: string[]) {
  const rootNodes = new Map<string, IdeTreeNode>();

  for (const root of roots) {
    rootNodes.set(root, {
      id: `root:${root}`,
      name: leafName(root),
      path: root,
      kind: "folder",
      children: [],
    });
  }

  items.forEach((item) => {
    const rootPath = roots.find((root) => isSameOrDescendantPath(item.path, root));
    const rootKey = rootPath ?? roots[0] ?? item.workspaceId;
    const rootNode =
      rootNodes.get(rootKey) ??
      {
        id: `root:${rootKey}`,
        name: leafName(rootKey),
        path: rootKey,
        kind: "folder" as const,
        children: [],
      };
    rootNodes.set(rootKey, rootNode);

    const parts = relativeWorkspacePath(item.path, roots).split("/").filter(Boolean);
    let currentNode = rootNode;

    parts.forEach((part, index) => {
      const isLeaf = index === parts.length - 1;
      currentNode.children ??= [];
      let nextNode = currentNode.children.find((child) => child.name === part);
      if (!nextNode) {
        const nodePath = isLeaf ? item.path : `${currentNode.path}/${part}`;
        nextNode = {
          id: isLeaf ? `file:${item.id}` : `folder:${nodePath}`,
          name: part,
          path: nodePath,
          kind: isLeaf ? "file" : "folder",
          file: isLeaf ? item : undefined,
          children: isLeaf ? undefined : [],
        };
        currentNode.children.push(nextNode);
        currentNode.children.sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === "folder" ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        });
      }
      currentNode = nextNode;
    });
  });

  return Array.from(rootNodes.values());
}

function extractAssistantCode(text: string) {
  const fenced = text.match(/```(?:[\w-]+)?\n([\s\S]*?)```/);
  return (fenced?.[1] ?? text).trim();
}

function encodePcm16Base64(input: Float32Array) {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64Bytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function pcm16BytesToFloat32(bytes: Uint8Array) {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const floats = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < sampleCount; index += 1) {
    floats[index] = view.getInt16(index * 2, true) / 0x8000;
  }
  return floats;
}

function normalizeVoiceId(value?: string | null) {
  const trimmed = value?.trim();
  const normalized = trimmed ? trimmed.toLowerCase() : "eve";
  return XAI_VOICE_OPTIONS.some((voice) => voice.id === normalized) ? normalized : "eve";
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tag = element.tagName?.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    element.isContentEditable
  );
}

function AppMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="appmark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0a0a0f" />
          <stop offset="100%" stopColor="#050508" />
        </linearGradient>
        <linearGradient id="appmark-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff6ef9" />
          <stop offset="30%" stopColor="#a855f7" />
          <stop offset="60%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="224" fill="url(#appmark-bg)" />
      {/* "s" — white */}
      <path d="M390 395c-55 0-100 40-100 90s35 72 88 85c35 9 52 22 52 42 0 25-22 43-55 43-38 0-65-18-82-45l-40 35c28 40 72 62 120 62 65 0 112-42 112-97 0-52-32-75-92-90-33-8-48-20-48-38 0-22 18-38 48-38 30 0 52 14 68 36l38-34c-24-32-62-51-109-51z" fill="#ffffff" opacity="0.95" transform="translate(30,120) scale(0.85)" />
      {/* "A" — rainbow gradient matching ASCIIVISION button */}
      <path d="M180 680h-58L230 200h65l108 480h-58l-26-120H206zm22-168h96l-48-222z" fill="url(#appmark-a)" transform="translate(430,0) scale(1.0)" />
    </svg>
  );
}

async function requestMicrophoneStream() {
  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  }

  const legacyGetUserMedia =
    (navigator as Navigator & {
      getUserMedia?: (
        constraints: MediaStreamConstraints,
        onSuccess: (stream: MediaStream) => void,
        onError: (error: Error) => void,
      ) => void;
      webkitGetUserMedia?: (
        constraints: MediaStreamConstraints,
        onSuccess: (stream: MediaStream) => void,
        onError: (error: Error) => void,
      ) => void;
    }).webkitGetUserMedia ??
    (navigator as Navigator & {
      getUserMedia?: (
        constraints: MediaStreamConstraints,
        onSuccess: (stream: MediaStream) => void,
        onError: (error: Error) => void,
      ) => void;
    }).getUserMedia;

  if (!legacyGetUserMedia) {
    throw new Error("Microphone capture is unavailable in this runtime.");
  }

  return new Promise<MediaStream>((resolve, reject) => {
    legacyGetUserMedia.call(
      navigator,
      {
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      },
      resolve,
      reject,
    );
  });
}

function createEditorClip(asset: MediaAsset): EditorClip {
  return {
    id: `${asset.id}-${Date.now()}`,
    asset,
    trimStart: "0",
    trimEnd: "",
    stillDuration: "3",
  };
}

function parseSecondsInput(value: string, fallback?: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function getEditorClipDuration(clip: EditorClip) {
  if (clip.asset.kind === "image") {
    return Math.max(parseSecondsInput(clip.stillDuration, 3) ?? 3, 0.5);
  }
  const trimStart = parseSecondsInput(clip.trimStart, 0) ?? 0;
  const trimEnd = parseSecondsInput(clip.trimEnd);
  if (trimEnd !== undefined && trimEnd > trimStart) {
    return Math.max(trimEnd - trimStart, 0.5);
  }
  return clip.asset.kind === "video" ? 6 : 8;
}

function formatTimelineSeconds(value: number) {
  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded.replace(/\.0$/, "")}s`;
}

function buildTimelineTrack(clips: EditorClip[], track: "visual" | "audio") {
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

function buildClipTrimPatch(clip: EditorClip, side: "start" | "end", deltaSeconds: number): Partial<EditorClip> {
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
  const [asciivisionActive, setAsciivisionActive] = useState(false);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("workspace");
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [leftWidth, setLeftWidth] = useState(210);
  const [rightWidth, setRightWidth] = useState(340);
  const [footerHeight, setFooterHeight] = useState(220);
  const [editorClips, setEditorClips] = useState<EditorClip[]>([]);
  const [activeEditorClipId, setActiveEditorClipId] = useState<string>();
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
  const showMusicMiniPlayer = musicCurrentIndex >= 0 && musicCurrentIndex < musicTracks.length && !asciivisionActive;
  const chromeActions = useMemo<ShellChromeActions>(
    () => ({
      openBrowserPreview: (html) => {
        openBrowserPreviewInStore(html);
        setRightPanelVisible(true);
        setRightPanelMode("browser");
      },
      openEditorAsset: (asset) => {
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
      <main className="h-[calc(100vh-8px)] w-full bg-transparent p-1">
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
              onSelectPage={(p) => { setAsciivisionActive(false); setPage(p); }}
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
              onMoveEditorClip={(clipId, direction) =>
                setEditorClips((current) => {
                  const index = current.findIndex((clip) => clip.id === clipId);
                  if (index < 0) {
                    return current;
                  }
                  const nextIndex = direction === "up" ? index - 1 : index + 1;
                  if (nextIndex < 0 || nextIndex >= current.length) {
                    return current;
                  }
                  const next = [...current];
                  const [clip] = next.splice(index, 1);
                  next.splice(nextIndex, 0, clip);
                  return next;
                })
              }
              onClearEditor={() => {
                setEditorClips([]);
                setActiveEditorClipId(undefined);
              }}
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
              <MusicMiniPlayer onExpand={() => { setAsciivisionActive(false); setPage("music"); }} />
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
  const providerStatuses = useAppStore((state) => state.providerStatuses);
  const toggleSettings = useAppStore((state) => state.toggleSettings);
  const currentWindow = getCurrentWindow();
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const xaiReady = providerStatuses.find((status) => status.providerId === "xai")?.configured;
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
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold tracking-[0.12em] text-stone-100">Super ASCIIVision</p>
          <p className="truncate text-[10px] text-stone-500">
            {xaiReady ? "xAI key ready" : "Add an xAI API key in settings"}
          </p>
        </div>
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
          className="absolute inset-y-0.5 rounded-full bg-emerald-300/14 shadow-[0_0_0_1px_rgba(110,231,183,0.1),0_10px_22px_rgba(16,185,129,0.18)] transition-[left,width] duration-300 ease-out"
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
        className="inline-flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/5 px-2.5 py-1 text-[10px] text-stone-200 transition hover:bg-white/10"
        aria-label="Open settings"
        data-no-drag="true"
      >
        <Settings2 className="h-3.5 w-3.5" />
        Settings
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

function NavTab({
  pageId,
  active,
  onClick,
  children,
}: {
  pageId: AppPage;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      data-page={pageId}
      type="button"
      onClick={onClick}
      className={clsx(
        "relative z-10 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] transition-colors duration-300",
        active ? "text-emerald-50" : "text-stone-400 hover:text-stone-100",
      )}
    >
      {children}
    </button>
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
  onMoveEditorClip,
  onClearEditor,
}: {
  page: AppPage;
  onNavigate: (page: AppPage) => void;
  onShowBrowser: () => void;
  editorClips: EditorClip[];
  activeEditorClipId?: string;
  onSelectEditorClip: (clipId?: string) => void;
  onUpdateEditorClip: (clipId: string, patch: Partial<EditorClip>) => void;
  onRemoveEditorClip: (clipId: string) => void;
  onMoveEditorClip: (clipId: string, direction: "up" | "down") => void;
  onClearEditor: () => void;
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
        onMoveClip={onMoveEditorClip}
        onClear={onClearEditor}
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

function ChatPage() {
  const conversation = useAppStore((state) => state.activeConversation);
  const composer = useAppStore((state) => state.composer);
  const sending = useAppStore((state) => state.sending);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const models = useAppStore((state) => state.models);
  const providerStatuses = useAppStore((state) => state.providerStatuses);
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
  const workspaceItemsMap = useAppStore((state) => state.workspaceItems);
  const workspaceSelection = useAppStore((state) => state.workspaceSelection);
  const selectModel = useAppStore((state) => state.selectModel);
  const setComposer = useAppStore((state) => state.setComposer);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const sendAgentMessage = useAppStore((state) => state.sendAgentMessage);
  const stopStream = useAppStore((state) => state.stopStream);
  const agentMode = useAppStore((state) => state.agentMode);
  const toggleAgentMode = useAppStore((state) => state.toggleAgentMode);
  const agentToolCalls = useAppStore((state) => state.agentToolCalls);

  const workspaceItems = activeWorkspaceId ? workspaceItemsMap[activeWorkspaceId] ?? [] : [];
  const selectedWorkspaceItems = useMemo(
    () => workspaceItems.filter((item) => workspaceSelection[item.id]),
    [workspaceItems, workspaceSelection],
  );
  const selectedTokens = useMemo(
    () => estimateSelectedTokens(workspaceItems, workspaceSelection),
    [workspaceItems, workspaceSelection],
  );
  const xaiReady = providerStatuses.find((status) => status.providerId === "xai")?.available ?? true;

  const handleSend = agentMode ? sendAgentMessage : sendMessage;

  return (
    <section className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
      <div className="min-h-0 overflow-y-auto px-3 py-3">
        {conversation?.messages.length ? (
          <div className="space-y-3">
            {conversation.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {agentMode && sending && agentToolCalls.length > 0 && (
              <div className="max-w-[92%] space-y-1">
                {agentToolCalls.map((tc, i) => (
                  <ToolCallBlock
                    key={`${tc.toolName}-${i}`}
                    toolName={tc.toolName}
                    args={tc.args}
                    result={tc.result}
                    success={tc.success}
                    isRunning={tc.isRunning}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <EmptyPanel
            eyebrow="Chat"
            title="Coding shell."
            body="Use an xAI language model, run local commands in the footer terminal, and send workspace-backed prompts from this page."
          />
        )}
      </div>

      <div className="border-t border-white/6 bg-[linear-gradient(180deg,rgba(11,12,14,0.98),rgba(8,9,11,0.98))] px-3 py-2.5">
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-stone-500">
          <span className="rounded-full border border-white/7 bg-white/[0.03] px-3 py-1">
            {selectedWorkspaceItems.length} context files
          </span>
          <span className="rounded-full border border-white/7 bg-white/[0.03] px-3 py-1 font-['IBM_Plex_Mono']">
            ~{selectedTokens} tokens
          </span>
          {agentMode && (
            <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-3 py-1 text-violet-100">
              Agent mode
            </span>
          )}
          {!xaiReady ? (
            <span className="rounded-full border border-amber-200/20 bg-amber-300/10 px-3 py-1 text-amber-100">
              xAI unavailable
            </span>
          ) : null}
        </div>

        <div className="rounded-[20px] border border-white/7 bg-black/30 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="rounded-xl border border-white/8 bg-black/35 px-2 py-1.5 text-[10px] font-semibold text-stone-200">
              xAI
            </div>
            <select
              value={selectedModel ?? ""}
              onChange={(event) => selectModel(event.target.value)}
              className="min-w-56 rounded-xl border border-white/8 bg-black/35 px-2 py-1.5 font-['IBM_Plex_Mono'] text-[10px] text-stone-300 outline-none transition focus:border-sky-300/40"
            >
              {(models.xai.length ? models.xai : CHAT_MODELS.map((modelId) => ({ modelId, label: modelId } as const))).map(
                (model) => (
                  <option key={model.modelId} value={model.modelId}>
                    {model.label}
                  </option>
                ),
              )}
            </select>
            <button
              type="button"
              onClick={toggleAgentMode}
              className={clsx(
                "ml-auto flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[10px] font-semibold transition",
                agentMode
                  ? "border-violet-300/30 bg-violet-300/15 text-violet-100 hover:bg-violet-300/22"
                  : "border-white/8 bg-white/5 text-stone-400 hover:bg-white/10 hover:text-stone-200",
              )}
            >
              <Bot className="h-3 w-3" />
              Agent
            </button>
          </div>
          <textarea
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder={
              agentMode
                ? "Ask the agent to edit files, run commands, search code…"
                : "Ask about your code, workspace, build issue, or next step…"
            }
            className="min-h-24 w-full resize-none bg-transparent px-1.5 py-1 text-[12px] leading-5 text-stone-100 outline-none placeholder:text-stone-600"
          />
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <p className="text-[10px] text-stone-600">Shift + Enter for a newline</p>
            {sending ? (
              <button
                type="button"
                onClick={() => void stopStream()}
                className="flex items-center gap-1 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-[10px] text-stone-100 transition hover:bg-white/10"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!xaiReady}
                className={clsx(
                  "flex items-center gap-1 rounded-xl border px-3 py-1.5 text-[10px] transition disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/4 disabled:text-stone-500",
                  agentMode
                    ? "border-violet-300/20 bg-violet-300/12 text-violet-50 hover:bg-violet-300/20"
                    : "border-emerald-300/20 bg-emerald-300/12 text-emerald-50 hover:bg-emerald-300/20",
                )}
              >
                {agentMode ? <Bot className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                {agentMode ? "Run Agent" : "Send"}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isAssistant = message.role === "assistant";
  return (
    <article
      className={clsx(
        "max-w-[92%] rounded-[20px] border px-3.5 py-2.5 shadow-[0_16px_30px_rgba(0,0,0,0.18)]",
        isAssistant
          ? "border-white/8 bg-white/[0.04] text-stone-100"
          : "ml-auto border-emerald-200/12 bg-emerald-300/10 text-emerald-50",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-stone-300">
            {isAssistant ? "Assistant" : "You"}
          </p>
          <p className="mt-1 font-['IBM_Plex_Mono'] text-[10px] text-stone-400">
            {message.modelId ?? "local"} · {message.status}
          </p>
        </div>
        {message.usage ? (
          <p className="font-['IBM_Plex_Mono'] text-[10px] text-stone-400">
            in {message.usage.inputTokens ?? 0} / out {message.usage.outputTokens ?? 0}
          </p>
        ) : null}
      </div>

      {isAssistant ? (
        <div className="prose prose-invert prose-pre:rounded-xl prose-pre:border prose-pre:border-white/8 prose-pre:bg-black/40 prose-code:font-['IBM_Plex_Mono'] max-w-none text-[12px] leading-6">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const language = className?.replace("language-", "");
                const code = String(children ?? "").replace(/\n$/, "");
                const inline = !className;
                if (inline) {
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                }
                return <CodeBlock code={code} language={language} />;
              },
            }}
          >
            {message.content || "…"}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-[12px] leading-6">{message.content}</p>
      )}

      {message.error ? <p className="mt-3 text-[10px] text-rose-200">{message.error}</p> : null}
    </article>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const chrome = useContext(ShellChromeContext);
  const label = (language ?? "code").toLowerCase();
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(code.split("\n").length > 60);
  const lineCount = code.split("\n").length;

  const highlighted = useMemo(() => {
    const lang = (language ?? "").toLowerCase();
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch {
        // fallback
      }
    }
    try {
      return hljs.highlightAuto(code).value;
    } catch {
      return null;
    }
  }, [code, language]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `snippet.${extensionForLanguage(language)}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="my-4 overflow-hidden rounded-[18px] border border-white/8 bg-[#0a0d0f] shadow-[0_10px_30px_rgba(0,0,0,0.24)]">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 bg-white/[0.03] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-['IBM_Plex_Mono'] text-[10px] uppercase tracking-[0.18em] text-stone-400">
            {label}
          </span>
          <span className="font-['IBM_Plex_Mono'] text-[10px] text-stone-500">
            {lineCount} lines
          </span>
          {lineCount > 60 && (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="text-[10px] text-sky-300/70 hover:text-sky-300"
            >
              {collapsed ? "Expand" : "Collapse"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1 rounded-lg border border-white/8 bg-white/5 px-2 py-1 text-[10px] text-stone-300 transition hover:bg-white/10"
          >
            <Copy className="h-3 w-3" />
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1 rounded-lg border border-white/8 bg-white/5 px-2 py-1 text-[10px] text-stone-300 transition hover:bg-white/10"
          >
            <Download className="h-3 w-3" />
            Download
          </button>
          <button
            type="button"
            onClick={() => chrome?.openBrowserPreview(buildPreviewDocument(code, language))}
            className="inline-flex items-center gap-1 rounded-lg border border-sky-300/18 bg-sky-300/10 px-2 py-1 text-[10px] text-sky-100 transition hover:bg-sky-300/16"
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
        </div>
      </div>
      <pre
        className={clsx(
          "m-0 overflow-x-auto px-4 py-4 font-['IBM_Plex_Mono'] text-[10px] leading-6 text-stone-200",
          collapsed && "max-h-48 overflow-y-hidden",
        )}
      >
        {highlighted ? (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code>{code}</code>
        )}
      </pre>
      {collapsed && (
        <div className="border-t border-white/5 bg-gradient-to-t from-[#0a0d0f] to-transparent px-4 py-2 text-center">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="text-[10px] text-sky-300/70 hover:text-sky-300"
          >
            Show all {lineCount} lines
          </button>
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({ toolName, args, result, success, isRunning }: {
  toolName: string;
  args: string;
  result?: string;
  success?: boolean;
  isRunning?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = isRunning ? "text-amber-300" : success ? "text-emerald-300" : "text-rose-300";
  const statusBorder = isRunning ? "border-amber-300/20" : success ? "border-emerald-300/20" : "border-rose-300/20";
  const statusBg = isRunning ? "bg-amber-300/5" : success ? "bg-emerald-300/5" : "bg-rose-300/5";

  return (
    <div className={clsx("my-2 overflow-hidden rounded-xl border", statusBorder, statusBg)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Code2 className={clsx("h-3 w-3 shrink-0", statusColor)} />
        <span className={clsx("font-['IBM_Plex_Mono'] text-[10px] font-semibold", statusColor)}>
          {toolName}
        </span>
        <span className="text-[10px] text-stone-500">
          {isRunning ? "running…" : success ? "completed" : "failed"}
        </span>
        <ChevronRight className={clsx("ml-auto h-3 w-3 text-stone-500 transition", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <div className="border-t border-white/5 px-3 py-2">
          {args && (
            <div className="mb-2">
              <p className="mb-1 text-[9px] uppercase tracking-wider text-stone-500">Input</p>
              <pre className="overflow-x-auto rounded-lg bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-300">
                {(() => { try { return JSON.stringify(JSON.parse(args), null, 2); } catch { return args; } })()}
              </pre>
            </div>
          )}
          {result && (
            <div>
              <p className="mb-1 text-[9px] uppercase tracking-wider text-stone-500">Output</p>
              <pre className="max-h-64 overflow-auto rounded-lg bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-300">
                {result.length > 3000 ? `${result.slice(0, 3000)}\n\n... (truncated)` : result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImaginePage({ onShowBrowser }: { onShowBrowser: () => void }) {
  const settings = useAppStore((state) => state.settings);
  const mediaCategories = useAppStore((state) => state.mediaCategories);
  const mediaAssets = useAppStore((state) => state.mediaAssets);
  const generatingImage = useAppStore((state) => state.generatingImage);
  const generatingVideo = useAppStore((state) => state.generatingVideo);
  const createMediaCategory = useAppStore((state) => state.createMediaCategory);
  const generateImage = useAppStore((state) => state.generateImage);
  const generateVideo = useAppStore((state) => state.generateVideo);
  const ensureMediaLoaded = useAppStore((state) => state.ensureMediaLoaded);
  const [mode, setMode] = useState<"image" | "video">("image");
  const [mediaPrompt, setMediaPrompt] = useState("");
  const [imageModel, setImageModel] = useState(settings?.xaiImageModel ?? IMAGE_MODELS[1]);
  const [videoModel, setVideoModel] = useState(settings?.xaiVideoModel ?? VIDEO_MODELS[0]);
  const [imageAspectRatio, setImageAspectRatio] = useState("1:1");
  const [imageResolution, setImageResolution] = useState("1k");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [selectedVisualCategoryId, setSelectedVisualCategoryId] = useState<string>();
  const [galleryDensity, setGalleryDensity] = useState<4 | 5 | 6>(5);

  useEffect(() => { void ensureMediaLoaded(); }, [ensureMediaLoaded]);

  useEffect(() => {
    if (settings?.xaiImageModel) {
      setImageModel(settings.xaiImageModel);
    }
    if (settings?.xaiVideoModel) {
      setVideoModel(settings.xaiVideoModel);
    }
  }, [settings?.xaiImageModel, settings?.xaiVideoModel]);

  const visualAssets = useMemo(
    () =>
      mediaAssets.filter(
        (asset) =>
          asset.kind !== "audio" && (!selectedVisualCategoryId || asset.categoryId === selectedVisualCategoryId),
      ),
    [mediaAssets, selectedVisualCategoryId],
  );
  const visualCategoryCounts = useMemo(
    () =>
      Object.fromEntries(
        mediaCategories.map((category) => [
          category.id,
          mediaAssets.filter((asset) => asset.kind !== "audio" && asset.categoryId === category.id).length,
        ]),
      ),
    [mediaAssets, mediaCategories],
  );
  const visualAllCount = useMemo(
    () => mediaAssets.filter((asset) => asset.kind !== "audio").length,
    [mediaAssets],
  );

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-white/6 px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">Image & Video</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold text-stone-100">Generate images and video</h2>
            <p className="mt-1 text-[11px] text-stone-500">
              Save every render into categories, then preview it inline or in the browser pane.
            </p>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 overflow-hidden px-3 py-3 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)]">
        <section className="min-h-0 overflow-y-auto rounded-[24px] border border-white/8 bg-white/[0.03] p-3.5">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-white/8 bg-white/5 p-2 text-stone-100">
              {mode === "image" ? <ImagePlus className="h-4 w-4" /> : <Video className="h-4 w-4" />}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-[#84a09b]">Create</p>
              <h3 className="mt-2 text-[14px] font-semibold text-stone-100">One prompt, two outputs</h3>
              <p className="mt-1 text-[11px] leading-5 text-stone-500">
                Switch between still image and video generation without losing your workspace.
              </p>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setMode("image")}
              className={clsx(
                "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] transition",
                mode === "image"
                  ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                  : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/10",
              )}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              Image
            </button>
            <button
              type="button"
              onClick={() => setMode("video")}
              className={clsx(
                "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] transition",
                mode === "video"
                  ? "border-sky-300/20 bg-sky-300/12 text-sky-50"
                  : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/10",
              )}
            >
              <Video className="h-3.5 w-3.5" />
              Video
            </button>
          </div>

          <div className="mt-3 grid gap-2">
            <div className="grid gap-2">
              <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">Model</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(mode === "image" ? IMAGE_MODELS : VIDEO_MODELS).map((modelId) => (
                  <button
                    key={modelId}
                    type="button"
                    onClick={() => (mode === "image" ? setImageModel(modelId) : setVideoModel(modelId))}
                    className={clsx(
                      "rounded-xl border px-3 py-2 text-[10px] font-['IBM_Plex_Mono'] transition",
                      (mode === "image" ? imageModel : videoModel) === modelId
                        ? mode === "image"
                          ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                          : "border-sky-300/20 bg-sky-300/12 text-sky-50"
                        : "border-white/8 bg-black/30 text-stone-300 hover:bg-white/8",
                    )}
                  >
                    {modelId}
                  </button>
                ))}
              </div>
            </div>

            {mode === "image" ? (
              <>
                <div className="grid gap-2">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">Resolution</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {IMAGE_RESOLUTION_OPTIONS.map((resolution) => (
                      <button
                        key={resolution}
                        type="button"
                        onClick={() => setImageResolution(resolution)}
                        className={clsx(
                          "rounded-xl border px-3 py-2 text-[10px] font-['IBM_Plex_Mono'] transition",
                          imageResolution === resolution
                            ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                            : "border-white/8 bg-black/30 text-stone-300 hover:bg-white/8",
                        )}
                      >
                        {resolution}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">Aspect Ratio</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {IMAGE_ASPECT_OPTIONS.map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => setImageAspectRatio(ratio)}
                        className={clsx(
                          "rounded-xl border px-3 py-2 text-[10px] font-['IBM_Plex_Mono'] transition",
                          imageAspectRatio === ratio
                            ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                            : "border-white/8 bg-black/30 text-stone-300 hover:bg-white/8",
                        )}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}

            <textarea
              value={mediaPrompt}
              onChange={(event) => setMediaPrompt(event.target.value)}
              placeholder={
                mode === "image"
                  ? "Describe the image you want to generate…"
                  : "Describe the motion, scene, and shot you want to animate…"
              }
              className="min-h-40 rounded-[18px] border border-white/8 bg-black/30 px-3 py-3 text-[12px] leading-5 text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/30"
            />
            <button
              type="button"
              onClick={() =>
                mode === "image"
                  ? void generateImage(mediaPrompt, imageModel, imageAspectRatio, imageResolution, selectedVisualCategoryId)
                  : void generateVideo(mediaPrompt, videoModel, selectedVisualCategoryId)
              }
              disabled={mode === "image" ? generatingImage : generatingVideo}
              className={clsx(
                "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-stone-500",
                mode === "image"
                  ? "border border-emerald-300/20 bg-emerald-300/12 text-emerald-50 hover:bg-emerald-300/20"
                  : "border border-sky-300/20 bg-sky-300/12 text-sky-50 hover:bg-sky-300/18",
              )}
            >
              {mode === "image" ? <WandSparkles className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}
              {mode === "image"
                ? generatingImage
                  ? "Generating…"
                  : "Generate Image"
                : generatingVideo
                  ? "Rendering…"
                  : "Generate Video"}
            </button>
          </div>
        </section>

        <section className="grid min-h-0 overflow-hidden rounded-[24px] border border-white/8 bg-white/[0.025] xl:grid-cols-[200px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b border-white/6 px-3 py-3 xl:border-b-0 xl:border-r">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.3em] text-[#84a09b]">Categories</p>
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
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (newCategoryName.trim()) {
                      void createMediaCategory(newCategoryName.trim());
                      setNewCategoryName("");
                    }
                  }
                }}
                placeholder="New category"
                className="min-w-0 flex-1 rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-[11px] text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/30"
              />
              <button
                type="button"
                onClick={() => {
                  if (newCategoryName.trim()) {
                    void createMediaCategory(newCategoryName.trim());
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
                onClick={() => setSelectedVisualCategoryId(undefined)}
                className={clsx(
                  "rounded-[14px] border px-3 py-2 text-left text-[11px] transition",
                  !selectedVisualCategoryId
                    ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                    : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/10",
                )}
              >
                <span className="block truncate">All visuals</span>
                <span className="mt-1 block text-[10px] text-stone-500">{visualAllCount} items</span>
              </button>
              {mediaCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedVisualCategoryId(category.id)}
                  className={clsx(
                    "rounded-[14px] border px-3 py-2 text-left text-[11px] transition",
                    category.id === selectedVisualCategoryId
                      ? "border-sky-300/20 bg-sky-300/12 text-sky-50"
                      : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/10",
                  )}
                >
                  <span className="block truncate">{category.name}</span>
                  <span className="mt-1 block text-[10px] text-stone-500">{visualCategoryCounts[category.id] ?? 0} items</span>
                </button>
              ))}
            </div>
          </aside>
          <div
            className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-3"
            style={{ gridTemplateColumns: `repeat(${galleryDensity}, minmax(0, 1fr))` }}
          >
            {generatingVideo ? <GeneratingMediaCard prompt={mediaPrompt} /> : null}
            {visualAssets.length ? (
              visualAssets.map((asset) => (
                <MediaAssetCard key={asset.id} asset={asset} onShowBrowser={onShowBrowser} />
              ))
            ) : (
              <div className="col-[1/-1]">
                <EmptyPanel
                  eyebrow="Gallery"
                  title="Your generated media will land here."
                  body="Images, videos, and speech outputs are stored locally and organized by your chosen category."
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function GeneratingMediaCard({ prompt }: { prompt: string }) {
  return (
    <article className="overflow-hidden rounded-[20px] border border-sky-300/18 bg-[#0b0d0f] shadow-[0_18px_60px_rgba(8,47,73,0.24)]">
      <div className="relative aspect-[4/3] overflow-hidden bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),rgba(3,7,18,0.96)_60%)]">
        <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_18%,rgba(255,255,255,0.08)_50%,transparent_82%)] animate-pulse" />
        <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,rgba(56,189,248,0.1),rgba(125,211,252,0.9),rgba(56,189,248,0.1))] animate-pulse" />
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-sky-300/24 bg-sky-300/12 text-sky-100 shadow-[0_0_0_14px_rgba(56,189,248,0.08)]">
            <Video className="h-6 w-6 animate-pulse" />
          </div>
          <div className="flex items-end gap-1">
            <span className="h-3 w-1 rounded-full bg-sky-200/70 animate-pulse" />
            <span className="h-5 w-1 rounded-full bg-sky-200/90 animate-pulse [animation-delay:120ms]" />
            <span className="h-7 w-1 rounded-full bg-sky-100 animate-pulse [animation-delay:240ms]" />
            <span className="h-5 w-1 rounded-full bg-sky-200/90 animate-pulse [animation-delay:360ms]" />
            <span className="h-3 w-1 rounded-full bg-sky-200/70 animate-pulse [animation-delay:480ms]" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-sky-100/80">Rendering</p>
            <p className="mt-2 text-[12px] font-semibold text-stone-100">Processing your video</p>
            <p className="mt-2 line-clamp-3 text-[11px] leading-5 text-stone-400">
              {prompt.trim() || "Your current video prompt will appear here while the render finishes."}
            </p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-white/8 px-3 py-3">
        <div className="rounded-full border border-sky-300/16 bg-sky-300/10 px-2 py-1 font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.18em] text-sky-100">
          In progress
        </div>
        <div className="font-['IBM_Plex_Mono'] text-[9px] text-stone-500">Waiting for final asset</div>
      </div>
    </article>
  );
}

// Module-level preview cache: shared across all MediaAssetCards, survives re-renders
const _mediaPreviewCache = new Map<string, string>();

function MediaAssetCard({ asset, onShowBrowser }: { asset: MediaAsset; onShowBrowser: () => void }) {
  const chrome = useContext(ShellChromeContext);
  const mediaCategories = useAppStore((state) => state.mediaCategories);
  const moveMediaAssetToCategory = useAppStore((state) => state.moveMediaAssetToCategory);
  const renameMediaAsset = useAppStore((state) => state.renameMediaAsset);
  const deleteMediaAsset = useAppStore((state) => state.deleteMediaAsset);
  const [src, setSrc] = useState<string | undefined>(() => _mediaPreviewCache.get(asset.filePath));
  const [titleDraft, setTitleDraft] = useState(asset.prompt);
  const [hovered, setHovered] = useState(false);
  const [cardRect, setCardRect] = useState<DOMRect | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced hover — 150ms delay before showing preview portal
  const handleMouseEnter = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => {
      if (articleRef.current) {
        setCardRect(articleRef.current.getBoundingClientRect());
        setHovered(true);
      }
    }, 150);
  }, []);
  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHovered(false);
  }, []);

  // IntersectionObserver: only load data URL when card is visible in viewport
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Only fetch the data URL once the card is visible (lazy load)
  useEffect(() => {
    if (!isVisible) return undefined;
    // Check cache first
    const cached = _mediaPreviewCache.get(asset.filePath);
    if (cached) {
      setSrc(cached);
      return undefined;
    }
    let cancelled = false;
    void api
      .readMediaDataUrl(asset.filePath)
      .then((value) => {
        if (!cancelled) {
          _mediaPreviewCache.set(asset.filePath, value);
          setSrc(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSrc(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [asset.filePath, isVisible]);

  useEffect(() => {
    setTitleDraft(asset.prompt);
  }, [asset.prompt]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(asset.filePath);
  };

  const handleDownload = () => {
    if (!src) {
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = src;
    anchor.download = leafName(asset.filePath);
    anchor.click();
  };

  return (
    <article
      ref={articleRef}
      className="group relative aspect-square overflow-visible"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-[20px] border border-white/8 bg-[linear-gradient(180deg,rgba(11,13,15,0.98),rgba(8,9,11,0.96))] shadow-[0_14px_34px_rgba(0,0,0,0.22)] transition duration-200 group-hover:border-white/12 group-hover:shadow-[0_18px_42px_rgba(0,0,0,0.3)]">
        <div className="relative flex-1 overflow-hidden bg-black">
          {asset.kind === "audio" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.18),rgba(3,7,18,0.96)_62%)] p-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-300/18 bg-emerald-300/10 text-emerald-100">
                <AudioLines className="h-5 w-5" />
              </div>
              <p className="line-clamp-2 text-[10px] leading-5 text-stone-200">{asset.prompt}</p>
            </div>
          ) : !src ? (
            <div className="flex h-full items-center justify-center text-[11px] text-stone-500">Loading preview…</div>
          ) : asset.kind === "image" ? (
            <img src={src} alt={asset.prompt} className="h-full w-full object-cover" />
          ) : (
            <video src={src} className="h-full w-full object-cover" muted playsInline />
          )}

          <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,rgba(3,7,18,0.9))] px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.18em] text-stone-300">
                {asset.kind}
              </span>
              <span className="font-['IBM_Plex_Mono'] text-[9px] text-stone-400">{leafName(asset.filePath)}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-white/6 px-2.5 py-2">
          <p className="line-clamp-2 text-[10px] leading-5 text-stone-200">{asset.prompt}</p>
        </div>
      </div>

      {hovered && cardRect
        ? createPortal(
            <div
              className="pointer-events-auto fixed z-[9999] w-[min(320px,calc(100vw-32px))]"
              style={{
                left: cardRect.left + cardRect.width / 2,
                top: cardRect.top + cardRect.height / 2,
                transform: "translate(-50%, -50%)",
              }}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <div className="flex flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#0b0d0f] p-2 shadow-[0_24px_64px_rgba(0,0,0,0.45)]">
                <div className="overflow-hidden rounded-[18px] border border-white/8 bg-black">
                  <div className="aspect-[4/3] bg-black">
                    {asset.kind === "audio" ? (
                      <div className="flex h-full flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.18),rgba(3,7,18,0.96)_62%)] p-4 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-300/10 text-emerald-100">
                          <AudioLines className="h-6 w-6" />
                        </div>
                        {src ? <audio src={src} controls className="w-full" /> : <p className="text-[10px] text-stone-500">Loading audio…</p>}
                      </div>
                    ) : !src ? (
                      <div className="flex h-full items-center justify-center text-[11px] text-stone-500">Loading preview…</div>
                    ) : asset.kind === "image" ? (
                      <img src={src} alt={asset.prompt} className="h-full w-full object-cover" />
                    ) : (
                      <video src={src} controls className="h-full w-full object-cover" />
                    )}
                  </div>
                </div>

                <div className="space-y-2.5 px-1 pb-1 pt-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="rounded-full border border-white/8 bg-white/5 px-2 py-1 font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.18em] text-stone-400">
                      {asset.kind}
                    </p>
                    <p className="font-['IBM_Plex_Mono'] text-[9px] text-stone-500">{asset.modelId}</p>
                  </div>

                  {asset.kind === "audio" ? (
                    <div className="grid gap-2">
                      <input
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        placeholder="Clip name"
                        className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-[11px] text-stone-100 outline-none focus:border-emerald-300/35"
                      />
                      <button
                        type="button"
                        onClick={() => void renameMediaAsset(asset.id, titleDraft)}
                        className="inline-flex items-center justify-center gap-1 rounded-xl border border-emerald-300/18 bg-emerald-300/10 px-3 py-2 text-[10px] text-emerald-50 transition hover:bg-emerald-300/16"
                      >
                        <Save className="h-3 w-3" />
                        Save Name
                      </button>
                    </div>
                  ) : (
                    <p className="line-clamp-2 text-[10px] leading-5 text-stone-200">{asset.prompt}</p>
                  )}

                  <label className="block space-y-1.5 text-[10px] text-stone-400">
                    <span className="uppercase tracking-[0.2em]">Category</span>
                    <select
                      value={asset.categoryId ?? ""}
                      onChange={(event) => void moveMediaAssetToCategory(asset.id, event.target.value || undefined)}
                      className="w-full rounded-xl border border-white/8 bg-black/35 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none transition focus:border-sky-300/35"
                    >
                      <option value="">Unsorted</option>
                      {mediaCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (src) {
                          chrome?.openBrowserPreview(buildAssetPreviewDocument(asset, src));
                          onShowBrowser();
                        }
                      }}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-sky-300/18 bg-sky-300/10 px-2 py-1.5 text-[10px] text-sky-100 transition hover:bg-sky-300/16"
                    >
                      <Eye className="h-3 w-3" />
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => chrome?.openEditorAsset(asset)}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-amber-300/18 bg-amber-300/10 px-2 py-1.5 text-[10px] text-amber-50 transition hover:bg-amber-300/16"
                    >
                      <Video className="h-3 w-3" />
                      Editor
                    </button>
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-white/8 bg-white/5 px-2 py-1.5 text-[10px] text-stone-300 transition hover:bg-white/10"
                    >
                      <Download className="h-3 w-3" />
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopy()}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-white/8 bg-white/5 px-2 py-1.5 text-[10px] text-stone-300 transition hover:bg-white/10"
                    >
                      <Copy className="h-3 w-3" />
                      Path
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete this ${asset.kind} asset?`)) {
                          void deleteMediaAsset(asset.id);
                        }
                      }}
                      className="col-span-2 inline-flex items-center justify-center gap-1 rounded-lg border border-white/8 bg-white/5 px-2 py-1.5 text-[10px] text-stone-300 transition hover:bg-rose-500/15"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </article>
  );
}

function VoiceAudioPage({ onShowBrowser }: { onShowBrowser: () => void }) {
  const settings = useAppStore((state) => state.settings);
  const mediaCategories = useAppStore((state) => state.mediaCategories);
  const mediaAssets = useAppStore((state) => state.mediaAssets);
  const createMediaCategory = useAppStore((state) => state.createMediaCategory);
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
  const [voiceName, setVoiceName] = useState(normalizeVoiceId(settings?.xaiVoiceName));
  const [ttsModel, setTtsModel] = useState(settings?.xaiTtsModel ?? "xai-tts");
  const [realtimeModel, setRealtimeModel] = useState(settings?.xaiRealtimeModel ?? "grok-realtime");
  const [realtimeInstructions, setRealtimeInstructions] = useState(
    "You are the voice assistant inside Super ASCIIVision. Keep responses concise and useful.",
  );
  const [realtimeStatus, setRealtimeStatus] = useState("Idle");
  const [voiceActive, setVoiceActive] = useState(false);
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
  const audioCategoryCounts = useMemo(
    () =>
      Object.fromEntries(
        mediaCategories.map((category) => [
          category.id,
          mediaAssets.filter((asset) => asset.kind === "audio" && asset.categoryId === category.id).length,
        ]),
      ),
    [mediaAssets, mediaCategories],
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

      const socket = new WebSocket(session.websocketUrl, [`xai-client-secret.${session.clientSecret}`]);
      websocketRef.current = socket;

      socket.onopen = async () => {
        setRealtimeStatus("Listening");
        socket.send(
          JSON.stringify({
            type: "session.update",
            session: {
              modalities: ["text", "audio"],
              instructions: realtimeInstructions,
              voice: normalizeVoiceId(voiceName),
              turn_detection: { type: "server_vad" },
              input_audio_format: "pcm16",
              output_audio_format: "pcm16",
            },
          }),
        );

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
          if (socket.readyState !== WebSocket.OPEN) {
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
        if (type === "session.updated") {
          setRealtimeStatus("Listening");
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
          setRealtimeStatus("Listening");
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
        if (closeEvent.code !== 1000) {
          setRealtimeStatus(
            closeEvent.reason
              ? `Disconnected: ${closeEvent.reason} (${closeEvent.code})`
              : `Disconnected (code ${closeEvent.code})`,
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
            <input
              value={mode === "speech" ? ttsModel : realtimeModel}
              onChange={(event) => (mode === "speech" ? setTtsModel(event.target.value) : setRealtimeModel(event.target.value))}
              placeholder={mode === "speech" ? "TTS model id" : "Realtime model id"}
              className="rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-200 outline-none focus:border-sky-300/40"
            />
            <select
              value={normalizeVoiceId(voiceName)}
              onChange={(event) => setVoiceName(event.target.value)}
              className="rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-200 outline-none focus:border-sky-300/40"
            >
              {XAI_VOICE_OPTIONS.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
            </select>

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
                <div className="rounded-[22px] border border-white/8 bg-black/30 px-4 py-5">
                  <div className="flex flex-col items-center text-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (voiceActive) {
                          void stopRealtimeConversation();
                        } else {
                          void startRealtimeConversation();
                        }
                      }}
                      disabled={generatingRealtimeSession}
                      className={clsx(
                        "flex h-28 w-28 items-center justify-center rounded-full border transition",
                        voiceActive
                          ? "border-rose-300/30 bg-rose-400/15 text-rose-50 shadow-[0_0_0_10px_rgba(251,113,133,0.08)]"
                          : "border-sky-300/24 bg-sky-300/12 text-sky-50 shadow-[0_0_0_10px_rgba(56,189,248,0.08)] hover:bg-sky-300/18",
                      )}
                    >
                      <Mic className="h-9 w-9" />
                    </button>
                    <p className="mt-4 text-[12px] font-semibold text-stone-100">
                      {voiceActive ? "Tap to end live voice" : "Tap to start live voice"}
                    </p>
                    <p className="mt-1 text-[11px] text-stone-500">
                      {generatingRealtimeSession ? "Creating secure session…" : `Status: ${realtimeStatus}`}
                    </p>
                    {realtimeSession?.expiresAt ? (
                      <p className="mt-1 font-['IBM_Plex_Mono'] text-[10px] text-stone-600">
                        expires {realtimeSession.expiresAt}
                      </p>
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
                      void createMediaCategory(newCategoryName.trim());
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
                      void createMediaCategory(newCategoryName.trim());
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
                {mediaCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedAudioCategoryId(category.id)}
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
                  <button
                    type="button"
                    onClick={onShowBrowser}
                    className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-200 transition hover:bg-white/10"
                  >
                    Open Browser Pane
                  </button>
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
    </section>
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
  const browserDraftUrl = useAppStore((state) => state.browserDraftUrl);
  const detectedServerUrl = useAppStore((state) => state.detectedServerUrl);
  const setBrowserDraftUrl = useAppStore((state) => state.setBrowserDraftUrl);
  const openBrowserUrl = useAppStore((state) => state.openBrowserUrl);
  const [leftMode, setLeftMode] = useState<"explorer" | "workspace" | "browser">("explorer");
  const [query, setQuery] = useState("");
  const [activeFilePath, setActiveFilePath] = useState<string>();
  const [fileContent, setFileContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [previewMode, setPreviewMode] = useState<"code" | "preview">("code");
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [ideRightMode, setIdeRightMode] = useState<"assistant" | "browser">("assistant");
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
    if (!filteredItems.length) {
      setActiveFilePath(undefined);
      setFileContent("");
      setSavedContent("");
      return;
    }
    if (!activeFilePath || !workspaceItems.some((item) => item.path === activeFilePath)) {
      setActiveFilePath(filteredItems[0]?.path);
    }
  }, [activeFilePath, filteredItems, workspaceItems]);

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
    let cancelled = false;
    setLoadingFile(true);
    void api
      .readWorkspaceTextFile(activeFilePath)
      .then((content) => {
        if (!cancelled) {
          setFileContent(content);
          setSavedContent(content);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFileContent("");
          setSavedContent("");
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

  const handleSelectFile = (path: string) => {
    if (dirty && path !== activeFilePath && !window.confirm("Discard unsaved IDE changes?")) {
      return;
    }
    setActiveFilePath(path);
  };

  const handleSave = async () => {
    if (!activeFilePath) {
      return;
    }
    setSavingFile(true);
    try {
      await api.writeWorkspaceTextFile(activeFilePath, fileContent);
      setSavedContent(fileContent);
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

    if (dirty && !window.confirm("Discard unsaved IDE changes and create a new file here?")) {
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
    setFileContent("");
    setSavedContent("");
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
      if (activeWorkspace.roots.length <= 1) {
        await deleteWorkspace(activeWorkspaceId);
        setActiveFilePath(undefined);
        setFileContent("");
        setSavedContent("");
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
    const nextActivePath =
      activeFilePath && (activeFilePath === node.path || activeFilePath.startsWith(`${node.path}/`))
        ? undefined
        : activeFilePath;
    if (!nextActivePath) {
      setFileContent("");
      setSavedContent("");
    }
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

    const prompt = activeItem
      ? `You are helping inside Super ASCIIVision IDE.\nCurrent file: ${activeItem.path}\nLanguage: ${activeItem.languageHint ?? "text"}\n\nCurrent file contents:\n\`\`\`${extensionForLanguage(activeItem.languageHint ?? undefined)}\n${fileContent}\n\`\`\`\n\nUser request:\n${trimmed}`
      : trimmed;

    setAssistantMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content: trimmed, status: "complete" },
    ]);
    setAssistantComposer("");

    const handle = await api.sendMessage({
      conversationId,
      providerId: "xai",
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

      {activeWorkspaceId ? (
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
                ["browser", Globe, "Browser"],
              ] as const
            ).map(([mode, Icon, label]) => (
              <button
                key={mode}
                type="button"
                title={label}
                onClick={() => setLeftMode(mode as "explorer" | "workspace" | "browser")}
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
              <p className="text-[10px] uppercase tracking-[0.28em] text-[#84a09b]">
                {leftMode === "explorer" ? "Explorer" : leftMode === "workspace" ? "Workspaces" : "Browser"}
              </p>
              <p className="mt-1 text-[11px] text-stone-500">
                {leftMode === "explorer"
                  ? `${workspaceItems.length} indexed files`
                  : leftMode === "workspace"
                    ? "Switch active project roots"
                    : "Open preview routes and local URLs"}
              </p>
              {leftMode === "explorer" ? (
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter files"
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
              ) : leftMode === "workspace" ? (
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
                    <button
                      key={workspace.id}
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
                  ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 px-1 py-1">
                  <label className="block text-[10px] text-stone-400">
                    <span className="mb-1.5 block uppercase tracking-[0.2em]">Browser URL</span>
                    <input
                      value={browserDraftUrl}
                      onChange={(event) => setBrowserDraftUrl(event.target.value)}
                      className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none focus:border-sky-300/40"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => openBrowserUrl()}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-200 transition hover:bg-white/10"
                  >
                    <Globe className="h-3 w-3" />
                    Open URL
                  </button>
                  {detectedServerUrl ? (
                    <button
                      type="button"
                      onClick={() => openBrowserUrl(detectedServerUrl)}
                      className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-sky-300/18 bg-sky-300/10 px-3 py-2 text-[10px] text-sky-100 transition hover:bg-sky-300/16"
                    >
                      Use detected localhost
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      chrome?.openBrowserPreview(buildPreviewDocument(fileContent, activeItem?.languageHint ?? undefined));
                      onShowBrowser();
                    }}
                    disabled={!activeItem}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-stone-500"
                  >
                    <Eye className="h-3 w-3" />
                    Open Current Preview
                  </button>
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

          <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-[linear-gradient(180deg,rgba(8,9,11,0.99),rgba(6,7,9,0.98))]">
            <div className="flex items-center justify-between gap-3 border-b border-white/6 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="inline-flex min-w-0 items-center gap-2 rounded-t-2xl border border-b-0 border-white/8 bg-white/[0.04] px-3 py-2">
                  <Code2 className="h-3.5 w-3.5 text-stone-400" />
                  <span className="truncate text-[11px] text-stone-100">
                    {activeItem ? leafName(activeItem.path) : "untitled"}
                  </span>
                  {dirty ? <span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> : null}
                </div>
                <p className="truncate font-['IBM_Plex_Mono'] text-[10px] text-stone-500">
                  {activeItem?.path ?? "Select a file from the explorer"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(activeItem?.path ?? "")}
                  disabled={!activeItem}
                  className="inline-flex items-center gap-1 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-stone-500"
                >
                  <Copy className="h-3 w-3" />
                  Path
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode((current) => (current === "preview" ? "code" : "preview"))}
                  disabled={!activeItem}
                  className="inline-flex items-center gap-1 rounded-xl border border-sky-300/18 bg-sky-300/10 px-3 py-2 text-[10px] text-sky-100 transition hover:bg-sky-300/16 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/5 disabled:text-stone-500"
                >
                  <Eye className="h-3 w-3" />
                  {previewMode === "preview" ? "Code" : "Preview"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!activeItem || !dirty || savingFile}
                  className="inline-flex items-center gap-1 rounded-xl border border-emerald-300/20 bg-emerald-300/12 px-3 py-2 text-[10px] text-emerald-50 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/5 disabled:text-stone-500"
                >
                  <Save className="h-3 w-3" />
                  {savingFile ? "Saving…" : dirty ? "Save" : "Saved"}
                </button>
              </div>
            </div>

            <div className="min-h-0 bg-[#070809] p-3">
              {activeItem ? (
                loadingFile ? (
                  <div className="flex h-full items-center justify-center text-[11px] text-stone-500">Loading file…</div>
                ) : previewMode === "preview" ? (
                  <iframe
                    title="IDE preview"
                    srcDoc={buildPreviewDocument(fileContent, activeItem?.languageHint ?? undefined)}
                    sandbox="allow-scripts allow-same-origin"
                    className="h-full w-full rounded-[18px] border border-white/8 bg-[#050607]"
                  />
                ) : (
                  <textarea
                    value={fileContent}
                    onChange={(event) => setFileContent(event.target.value)}
                    spellCheck={false}
                    className="h-full w-full resize-none rounded-[18px] border border-white/8 bg-[#050607] px-4 py-4 font-['IBM_Plex_Mono'] text-[11px] leading-6 text-stone-100 outline-none"
                  />
                )
              ) : (
                <EmptyPanel
                  eyebrow="IDE"
                  title="Select a file from the explorer."
                  body="Use the left rail to switch between project files, workspace roots, and the browser tools."
                />
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-white/6 px-3 py-2 text-[10px] text-stone-500">
              <div className="flex items-center gap-3">
                <span>{activeItem?.languageHint ?? "text"}</span>
                <span>{activeItem ? formatFileSize(activeItem.byteSize) : "No file selected"}</span>
                {dirty ? <span className="text-amber-200">Unsaved changes</span> : <span>Saved</span>}
              </div>
              <button
                type="button"
                onClick={() => {
                  chrome?.openBrowserPreview(buildPreviewDocument(fileContent, activeItem?.languageHint ?? undefined));
                  onShowBrowser();
                }}
                disabled={!activeItem}
                className="inline-flex items-center gap-1 text-stone-400 transition hover:text-stone-100 disabled:cursor-not-allowed disabled:text-stone-600"
              >
                <Globe className="h-3 w-3" />
                Open in browser
              </button>
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
                <div className="border-b border-white/6 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.3em] text-[#84a09b]">Assistant</p>
                      <h3 className="mt-1 text-[13px] font-semibold text-stone-100">AI Copilot</h3>
                      <p className="mt-1 text-[10px] leading-5 text-stone-500">
                        Ask about the open file, then apply the answer directly into the editor.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-white/5 p-2 text-stone-100">
                      <Bot className="h-4 w-4" />
                    </div>
                  </div>
                  <select
                    value={assistantModel}
                    onChange={(event) => setAssistantModel(event.target.value)}
                    className="mt-3 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none focus:border-emerald-300/35"
                  >
                    {CHAT_MODELS.map((modelId) => (
                      <option key={modelId} value={modelId}>
                        {modelId}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
                  {assistantMessages.length ? (
                    assistantMessages.map((message) => (
                      <article
                        key={message.id}
                        className={clsx(
                          "rounded-[18px] border px-3 py-2.5",
                          message.role === "assistant"
                            ? "border-white/8 bg-white/[0.03] text-stone-100"
                            : "border-emerald-300/16 bg-emerald-300/8 text-emerald-50",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[9px] uppercase tracking-[0.2em] text-stone-400">
                            {message.role === "assistant" ? assistantModel : "You"}
                          </p>
                          <p className="text-[9px] text-stone-500">{message.status}</p>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5">{message.content || "…"}</p>
                        {message.role === "assistant" && message.content ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewMode("code");
                              setFileContent(extractAssistantCode(message.content));
                            }}
                            className="mt-3 inline-flex items-center gap-1 rounded-lg border border-amber-300/18 bg-amber-300/10 px-2 py-1 text-[10px] text-amber-50 transition hover:bg-amber-300/16"
                          >
                            <Code2 className="h-3 w-3" />
                            Replace Open File
                          </button>
                        ) : null}
                      </article>
                    ))
                  ) : (
                    <EmptyPanel
                      eyebrow="Assistant"
                      title="No IDE prompts yet."
                      body="Select a file and ask to explain, refactor, or rewrite it."
                    />
                  )}
                </div>
                <div className="border-t border-white/6 px-3 py-3">
                  <p className="mb-2 text-[10px] text-stone-500">
                    {activeItem ? `Context file: ${leafName(activeItem.path)}` : "Open a file to provide context."}
                  </p>
                  <textarea
                    value={assistantComposer}
                    onChange={(event) => setAssistantComposer(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendAssistantMessage();
                      }
                    }}
                    placeholder="Ask to change the current file…"
                    className="min-h-24 w-full resize-none rounded-[18px] border border-white/8 bg-black/30 px-3 py-3 text-[11px] leading-5 text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/35"
                  />
                  <button
                    type="button"
                    onClick={() => void sendAssistantMessage()}
                    disabled={!assistantComposer.trim() || assistantSending}
                    className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-xl border border-emerald-300/20 bg-emerald-300/12 px-3 py-2 text-[10px] text-emerald-50 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/5 disabled:text-stone-500"
                  >
                    <Send className="h-3 w-3" />
                    {assistantSending ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </aside>
        </div>
      ) : (
        <div className="px-3 py-3">
          <EmptyPanel
            eyebrow="IDE"
            title="No workspace selected."
            body="Attach a workspace from the right sidebar first, then this page will open its indexed files as an in-app IDE."
          />
        </div>
      )}
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

function RightSidebar({
  page,
  mode,
  onSelectMode,
}: {
  page: AppPage;
  mode: RightPanelMode;
  onSelectMode: (mode: RightPanelMode) => void;
}) {
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
  const createWorkspaceFromFolder = useAppStore((state) => state.createWorkspaceFromFolder);
  const createWorkspaceFromFiles = useAppStore((state) => state.createWorkspaceFromFiles);
  const replaceWorkspaceFromFolder = useAppStore((state) => state.replaceWorkspaceFromFolder);
  const replaceWorkspaceFromFiles = useAppStore((state) => state.replaceWorkspaceFromFiles);
  const deleteWorkspace = useAppStore((state) => state.deleteWorkspace);
  const selectWorkspace = useAppStore((state) => state.selectWorkspace);
  const scanWorkspace = useAppStore((state) => state.scanWorkspace);
  const toggleWorkspaceItem = useAppStore((state) => state.toggleWorkspaceItem);
  const importLocalMediaAsset = useAppStore((state) => state.importLocalMediaAsset);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const workspaceItems = activeWorkspaceId ? workspaceItemsMap[activeWorkspaceId] ?? [] : [];
  const [workspaceMedia, setWorkspaceMedia] = useState<WorkspaceMediaFile[]>([]);
  const [workspaceMediaLoading, setWorkspaceMediaLoading] = useState(false);
  const [importingPath, setImportingPath] = useState<string>();
  const workspaceMediaKinds =
    page === "voice" ? ["audio"] : page === "imagine" ? ["image", "video"] : ["image", "video", "audio"];
  const isTextWorkspace = page === "chat" || page === "ide";

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

  const workspaceHeading =
    page === "imagine"
      ? "Workspace Media"
      : page === "voice"
        ? "Workspace Audio"
        : page === "ide"
          ? "Workspace"
        : page === "editor"
          ? "Editor Sources"
          : "Workspace";
  const workspaceBody =
    page === "imagine"
      ? "Browse local image and video files from the active workspace and send them straight into the editor."
      : page === "voice"
        ? "Browse local audio files from the active workspace and queue them into the editor."
        : page === "ide"
          ? "Select or rescan a workspace here, then use the IDE page to browse and edit its indexed text files."
        : page === "editor"
          ? "Pull image, video, and audio files from the active workspace into the media editor."
          : "Index local folders or files as prompt context.";

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
            onClick={() => void createWorkspaceFromFolder()}
            className="rounded-xl border border-white/8 bg-white/5 p-2 text-stone-200 transition hover:bg-white/10"
            aria-label="Add folder"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void createWorkspaceFromFolder()}
            className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-white/10"
          >
            Folder
          </button>
          <button
            type="button"
            onClick={() => void createWorkspaceFromFiles()}
            className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-white/10"
          >
            Files
          </button>
        </div>
      </div>

      <div className="border-b border-white/6 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              onClick={() => void selectWorkspace(workspace.id)}
              className={clsx(
                "rounded-full border px-3 py-1.5 text-[10px] transition",
                workspace.id === activeWorkspaceId
                  ? "border-sky-200/16 bg-sky-300/10 text-sky-100"
                  : "border-white/8 bg-white/4 text-stone-300 hover:bg-white/8",
              )}
            >
              {workspace.name}
            </button>
          ))}
        </div>
        {activeWorkspaceId ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void scanWorkspace(activeWorkspaceId)}
              className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-white/10"
            >
              <RefreshCcw className={clsx("h-3.5 w-3.5", scanningWorkspaceId === activeWorkspaceId && "animate-spin")} />
              Rescan
            </button>
            <button
              type="button"
              onClick={() => void replaceWorkspaceFromFolder(activeWorkspaceId)}
              className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-white/10"
            >
              Replace folder
            </button>
            <button
              type="button"
              onClick={() => void replaceWorkspaceFromFiles(activeWorkspaceId)}
              className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-white/10"
            >
              Replace files
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Remove workspace "${activeWorkspace?.name ?? "Workspace"}"?`)) {
                  void deleteWorkspace(activeWorkspaceId);
                }
              }}
              className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-rose-200 transition hover:bg-rose-500/15"
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {isTextWorkspace ? workspaceItems.length ? (
          workspaceItems.map((item) => (
            <WorkspaceItemRow
              key={item.id}
              item={item}
              selected={workspaceSelection[item.id] ?? false}
              onToggle={() => toggleWorkspaceItem(item.id)}
            />
          ))
        ) : (
          <EmptyPanel
            eyebrow="No workspace"
            title="Attach a folder or selected files."
            body="Supported text files are indexed locally and can be included in each prompt."
          />
        ) : !activeWorkspaceId ? (
          <EmptyPanel
            eyebrow="No workspace"
            title="Attach a folder or selected files."
            body="Pick a workspace first, then this panel will surface local media files that match the current page."
          />
        ) : workspaceMediaLoading ? (
          <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-4 text-[11px] text-stone-400">
            Loading workspace media…
          </div>
        ) : workspaceMedia.length ? (
          workspaceMedia.map((item) => (
            <button
              key={item.path}
              type="button"
              onClick={() => {
                setImportingPath(item.path);
                importLocalMediaAsset(item.path, undefined, item.fileName.replace(/\.[^.]+$/, "")).then((asset) => {
                  if (asset) {
                    chrome?.openEditorAsset(asset);
                  }
                  setImportingPath((current) => (current === item.path ? undefined : current));
                });
              }}
              className="w-full rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.06]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-white/8 bg-white/5 px-2 py-0.5 font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.18em] text-stone-400">
                      {item.kind}
                    </span>
                    <span className="text-[9px] text-stone-500">{formatFileSize(item.fileSize)}</span>
                  </div>
                  <p className="mt-2 truncate text-[11px] font-medium text-stone-100">{item.fileName}</p>
                  <p className="mt-1 truncate font-['IBM_Plex_Mono'] text-[10px] text-stone-500">{item.path}</p>
                </div>
                <span className="rounded-xl border border-amber-300/18 bg-amber-300/10 px-2 py-1 text-[10px] text-amber-50">
                  {importingPath === item.path ? "Adding…" : "Add to Editor"}
                </span>
              </div>
            </button>
          ))
        ) : (
          <EmptyPanel
            eyebrow="No local media"
            title="No matching files in this workspace."
            body={
              page === "voice"
                ? "This workspace does not currently expose any audio files."
                : page === "imagine"
                  ? "This workspace does not currently expose any image or video files."
                  : "This workspace does not currently expose any importable media files."
            }
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
}: {
  item: WorkspaceItem;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        "w-full rounded-[18px] border px-3 py-3 text-left transition",
        selected ? "border-emerald-200/16 bg-emerald-300/8" : "border-white/8 bg-white/[0.03] hover:bg-white/[0.06]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] text-stone-100">{leafName(item.path)}</p>
          <p className="mt-1 truncate font-['IBM_Plex_Mono'] text-[10px] text-stone-600">{item.path}</p>
        </div>
        <div className="text-right text-[10px] text-stone-500">
          <p>{Math.round(item.byteSize / 1024)} KB</p>
          <p>{item.chunkCount} chunks</p>
        </div>
      </div>
    </button>
  );
}

function EditorPage({
  clips,
  activeClipId,
  onSelectClip,
  onUpdateClip,
  onRemoveClip,
  onMoveClip,
  onClear,
}: {
  clips: EditorClip[];
  activeClipId?: string;
  onSelectClip: (clipId?: string) => void;
  onUpdateClip: (clipId: string, patch: Partial<EditorClip>) => void;
  onRemoveClip: (clipId: string) => void;
  onMoveClip: (clipId: string, direction: "up" | "down") => void;
  onClear: () => void;
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

  useEffect(() => { void ensureMediaLoaded(); }, [ensureMediaLoaded]);

  useEffect(() => {
    if (!exportCategoryId && selectedMediaCategoryId) {
      setExportCategoryId(selectedMediaCategoryId);
    }
  }, [exportCategoryId, selectedMediaCategoryId]);

  useEffect(() => {
    let cancelled = false;
    const missing = clips.filter((clip) => !previewSources[clip.asset.id]);
    if (!missing.length) {
      return undefined;
    }

    void Promise.all(
      missing.map(async (clip) => ({
        assetId: clip.asset.id,
        src: await api.readMediaDataUrl(clip.asset.filePath),
      })),
    )
      .then((entries) => {
        if (cancelled) {
          return;
        }
        setPreviewSources((current) => ({
          ...current,
          ...Object.fromEntries(entries.map((entry) => [entry.assetId, entry.src])),
        }));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [clips, previewSources]);

  useEffect(() => {
    if (!clips.length) {
      if (activeClipId) {
        onSelectClip(undefined);
      }
      return;
    }
    if (!activeClipId || !clips.some((clip) => clip.id === activeClipId)) {
      onSelectClip(clips[clips.length - 1]?.id);
    }
  }, [activeClipId, clips, onSelectClip]);

  const activeClip = clips.find((clip) => clip.id === activeClipId) ?? clips[clips.length - 1];
  const activeSrc = activeClip ? previewSources[activeClip.asset.id] : undefined;
  const visualTrack = useMemo(() => buildTimelineTrack(clips, "visual"), [clips]);
  const audioTrack = useMemo(() => buildTimelineTrack(clips, "audio"), [clips]);
  const timelineDuration = Math.max(visualTrack.duration, audioTrack.duration, 1);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-white/6 px-3 py-3">
        <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">Editor</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold text-stone-100">Media Editor</h2>
            <p className="mt-1 text-[11px] text-stone-400">
              Queue gallery assets here, shape the visual and audio timelines, then export a final `.mp4`.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px] text-stone-400">
            <span className="rounded-full border border-white/7 bg-white/[0.03] px-2.5 py-1">
              {visualTrack.items.length} visual
            </span>
            <span className="rounded-full border border-white/7 bg-white/[0.03] px-2.5 py-1">
              {audioTrack.items.length} audio
            </span>
            <span className="rounded-full border border-white/7 bg-white/[0.03] px-2.5 py-1 font-['IBM_Plex_Mono']">
              {formatTimelineSeconds(timelineDuration)} total
            </span>
            <button
              type="button"
              disabled={importing}
              onClick={async () => {
                try {
                  const selection = await openDialog({
                    multiple: false,
                    filters: [
                      { name: "Media", extensions: ["mp4", "mov", "mp3", "wav", "png", "jpg", "jpeg", "gif", "webp"] },
                    ],
                  });
                  if (typeof selection === "string") {
                    setImporting(true);
                    try {
                      const asset = await importLocalMediaAsset(selection);
                      if (asset) {
                        chrome?.openEditorAsset(asset);
                      }
                    } finally {
                      setImporting(false);
                    }
                  }
                } catch (err) {
                  console.error("Failed to import media:", err);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/18 bg-emerald-300/10 px-2.5 py-1 text-[10px] text-emerald-50 transition hover:bg-emerald-300/16 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FolderPlus className="h-3 w-3" />
              {importing ? "Importing…" : "Import Media"}
            </button>
          </div>
        </div>
      </div>

      {clips.length ? (
        <div className="grid min-h-0 flex-1 gap-2.5 overflow-y-auto px-3 py-3 xl:grid-cols-[minmax(0,1.58fr)_320px] xl:grid-rows-[minmax(340px,1fr)_minmax(260px,0.82fr)]">
          <section className="flex min-h-[320px] min-w-0 flex-col overflow-hidden rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(12,13,15,0.98),rgba(7,8,10,0.97))]">
            <div className="flex items-start justify-between gap-3 border-b border-white/6 px-3 py-3">
              <div>
                <p className="font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.18em] text-stone-400">
                  {activeClip ? `${activeClip.asset.kind} clip` : "Queue"}
                </p>
                <p className="mt-1 text-[13px] font-semibold text-stone-100">
                  {activeClip?.asset.prompt ?? "Select a clip"}
                </p>
              </div>
              {activeClip ? (
                <div className="rounded-full border border-white/8 bg-white/5 px-2.5 py-1 font-['IBM_Plex_Mono'] text-[9px] text-stone-300">
                  {leafName(activeClip.asset.filePath)}
                </div>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center bg-[radial-gradient(circle_at_top,rgba(38,56,54,0.24),rgba(3,5,7,0.98)_62%)] p-4">
              <EditorPreview clip={activeClip} src={activeSrc} />
            </div>

            <div className="border-t border-white/6 px-3 py-2.5">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {clips.map((clip, index) => (
                  <button
                    key={clip.id}
                    type="button"
                    onClick={() => onSelectClip(clip.id)}
                    className={clsx(
                      "rounded-[16px] border px-3 py-2 text-left transition",
                      clip.id === activeClipId
                        ? "border-amber-300/20 bg-amber-300/10 text-amber-50"
                        : "border-white/8 bg-white/[0.03] text-stone-300 hover:bg-white/[0.06]",
                    )}
                  >
                    <p className="font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.18em] text-stone-400">
                      Clip {index + 1} · {clip.asset.kind}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-5">{clip.asset.prompt}</p>
                    <p className="mt-2 text-[9px] text-stone-500">{formatTimelineSeconds(getEditorClipDuration(clip))}</p>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="min-h-[320px] space-y-2.5 overflow-y-auto rounded-[24px] border border-white/8 bg-white/[0.03] p-2.5">
            <section className="rounded-[20px] border border-white/8 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-[#84a09b]">Export</p>
              <div className="mt-3 grid gap-2">
                <input
                  value={exportTitle}
                  onChange={(event) => setExportTitle(event.target.value)}
                  placeholder="Export title"
                  className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-[11px] text-stone-100 outline-none focus:border-amber-300/35"
                />
                <select
                  value={exportCategoryId}
                  onChange={(event) => setExportCategoryId(event.target.value)}
                  className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none focus:border-amber-300/35"
                >
                  <option value="">Unsorted export</option>
                  {mediaCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    void exportEditorTimeline({
                      title: exportTitle.trim() || "Editor Export",
                      categoryId: exportCategoryId || undefined,
                      clips: clips.map((clip) => ({
                        assetId: clip.asset.id,
                        kind: clip.asset.kind,
                        filePath: clip.asset.filePath,
                        trimStart: Number.isFinite(Number(clip.trimStart)) ? Number(clip.trimStart) : 0,
                        trimEnd:
                          clip.trimEnd.trim() && Number.isFinite(Number(clip.trimEnd))
                            ? Number(clip.trimEnd)
                            : undefined,
                        stillDuration:
                          clip.asset.kind === "image" && Number.isFinite(Number(clip.stillDuration))
                            ? Number(clip.stillDuration)
                            : 3,
                      })),
                    })
                  }
                  disabled={!clips.length || exportingEditor}
                  className="rounded-xl border border-amber-300/20 bg-amber-300/12 px-3 py-2 text-[10px] font-semibold text-amber-50 transition hover:bg-amber-300/18 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/5 disabled:text-stone-500"
                >
                  {exportingEditor ? "Exporting…" : "Export Video"}
                </button>
                <button
                  type="button"
                  onClick={onClear}
                  disabled={!clips.length || exportingEditor}
                  className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-stone-500"
                >
                  Clear Timeline
                </button>
              </div>
              <p className="mt-3 text-[10px] leading-5 text-stone-500">
                Export currently builds the visual track and audio track separately, aligns both at `0s`, and finishes on the shorter result.
              </p>
            </section>

            {activeClip ? (
              <section className="rounded-[20px] border border-white/8 bg-black/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-[#84a09b]">Inspector</p>
                    <p className="mt-2 text-[12px] font-semibold text-stone-100">{activeClip.asset.prompt}</p>
                  </div>
                  <div className="rounded-full border border-white/8 bg-white/5 px-2 py-1 font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.18em] text-stone-300">
                    {activeClip.asset.kind}
                  </div>
                </div>

                <div className="mt-3 grid gap-2">
                  <label className="space-y-1 text-[10px] text-stone-400">
                    <span>Trim start (s)</span>
                    <input
                      value={activeClip.trimStart}
                      onChange={(event) => onUpdateClip(activeClip.id, { trimStart: event.target.value })}
                      className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none focus:border-amber-300/35"
                    />
                  </label>
                  <label className="space-y-1 text-[10px] text-stone-400">
                    <span>{activeClip.asset.kind === "image" ? "Still duration (s)" : "Trim end (s)"}</span>
                    <input
                      value={activeClip.asset.kind === "image" ? activeClip.stillDuration : activeClip.trimEnd}
                      onChange={(event) =>
                        activeClip.asset.kind === "image"
                          ? onUpdateClip(activeClip.id, { stillDuration: event.target.value })
                          : onUpdateClip(activeClip.id, { trimEnd: event.target.value })
                      }
                      className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none focus:border-amber-300/35"
                    />
                  </label>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => onMoveClip(activeClip.id, "up")}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/8 bg-white/5 px-2 py-2 text-[10px] text-stone-200 transition hover:bg-white/10"
                  >
                    <MoveUp className="h-3 w-3" />
                    Up
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveClip(activeClip.id, "down")}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/8 bg-white/5 px-2 py-2 text-[10px] text-stone-200 transition hover:bg-white/10"
                  >
                    <MoveDown className="h-3 w-3" />
                    Down
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveClip(activeClip.id)}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/8 bg-white/5 px-2 py-2 text-[10px] text-rose-200 transition hover:bg-rose-500/15"
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </button>
                </div>

                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (activeSrc) {
                        chrome?.openBrowserPreview(buildAssetPreviewDocument(activeClip.asset, activeSrc));
                      }
                    }}
                    disabled={!activeSrc}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-sky-300/18 bg-sky-300/10 px-3 py-2 text-[10px] text-sky-100 transition hover:bg-sky-300/16 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/5 disabled:text-stone-500"
                  >
                    <Eye className="h-3 w-3" />
                    Open in Browser
                  </button>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(activeClip.asset.filePath)}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-200 transition hover:bg-white/10"
                  >
                    <Copy className="h-3 w-3" />
                    Copy Path
                  </button>
                </div>
              </section>
            ) : null}
          </aside>

          <section className="flex min-h-[260px] flex-col overflow-hidden rounded-[24px] border border-white/8 bg-white/[0.03] xl:col-span-2">
            <div className="flex items-center justify-between gap-3 border-b border-white/6 px-3 py-2.5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[#84a09b]">Tracks</p>
                <h3 className="mt-1 text-[13px] font-semibold text-stone-100">Visual and audio lanes</h3>
              </div>
              <p className="max-w-sm text-right text-[10px] leading-5 text-stone-500">
                Visual clips chain left-to-right on the top lane. Audio clips build their own parallel lane so they overlap the picture from time zero.
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-2.5 py-2.5">
              <TimelineScale duration={timelineDuration} />
              <div className="mt-2.5 space-y-2.5">
                <TimelineTrack
                  label="Visual"
                  emptyLabel="Add image or video assets from Image & Video or Voice & Audio."
                  items={visualTrack.items}
                  timelineDuration={timelineDuration}
                  activeClipId={activeClipId}
                  onSelectClip={onSelectClip}
                  onUpdateClip={onUpdateClip}
                />
                <TimelineTrack
                  label="Audio"
                  emptyLabel="Queue speech or audio clips to build the soundtrack."
                  items={audioTrack.items}
                  timelineDuration={timelineDuration}
                  activeClipId={activeClipId}
                  onSelectClip={onSelectClip}
                  onUpdateClip={onUpdateClip}
                />
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="px-3 py-3">
          <EmptyPanel
            eyebrow="Editor"
            title="No clips queued yet."
            body="Use the Editor button on any gallery card to send assets here, then shape the timeline and export the cut."
          />
        </div>
      )}
    </section>
  );
}

function EditorPreview({ clip, src }: { clip?: EditorClip; src?: string }) {
  if (!clip) {
    return <div className="text-[11px] text-stone-500">Select a clip to preview it here.</div>;
  }

  if (!src) {
    return <div className="text-[11px] text-stone-500">Loading clip preview…</div>;
  }

  if (clip.asset.kind === "video") {
    return (
      <video
        src={src}
        controls
        className="max-h-full max-w-full rounded-[20px] border border-white/8 bg-black object-contain"
      />
    );
  }

  if (clip.asset.kind === "audio") {
    return (
      <div className="flex w-full max-w-3xl flex-col items-center justify-center gap-4 rounded-[28px] border border-white/8 bg-black/25 px-6 py-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-300/10 text-emerald-100">
          <AudioLines className="h-7 w-7" />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-[#84a09b]">Audio clip</p>
          <p className="mt-2 text-[13px] font-semibold text-stone-100">{clip.asset.prompt}</p>
        </div>
        <audio src={src} controls className="w-full" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={clip.asset.prompt}
      className="max-h-full max-w-full rounded-[20px] border border-white/8 bg-black object-contain"
    />
  );
}

function TimelineScale({ duration }: { duration: number }) {
  const markers = Array.from({ length: 7 }, (_, index) => {
    const ratio = index / 6;
    return {
      left: `${ratio * 100}%`,
      value: duration * ratio,
    };
  });

  return (
    <div className="relative h-6 rounded-[14px] border border-white/6 bg-black/20">
      {markers.map((marker) => (
        <div key={marker.left} className="absolute inset-y-0" style={{ left: marker.left }}>
          <div className="h-full w-px bg-white/8" />
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 font-['IBM_Plex_Mono'] text-[8px] text-stone-500">
            {formatTimelineSeconds(marker.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TimelineTrack({
  label,
  emptyLabel,
  items,
  timelineDuration,
  activeClipId,
  onSelectClip,
  onUpdateClip,
}: {
  label: string;
  emptyLabel: string;
  items: TimelineTrackItem[];
  timelineDuration: number;
  activeClipId?: string;
  onSelectClip: (clipId?: string) => void;
  onUpdateClip: (clipId: string, patch: Partial<EditorClip>) => void;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [trimDrag, setTrimDrag] = useState<{
    clip: EditorClip;
    side: "start" | "end";
    startX: number;
  }>();

  useEffect(() => {
    if (!trimDrag) {
      return undefined;
    }

    const onPointerMove = (event: PointerEvent) => {
      const width = laneRef.current?.getBoundingClientRect().width;
      if (!width || width <= 0) {
        return;
      }
      const deltaRatio = (event.clientX - trimDrag.startX) / width;
      const deltaSeconds = deltaRatio * timelineDuration;
      onUpdateClip(trimDrag.clip.id, buildClipTrimPatch(trimDrag.clip, trimDrag.side, deltaSeconds));
    };

    const onPointerUp = () => setTrimDrag(undefined);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onUpdateClip, timelineDuration, trimDrag]);

  return (
    <div className="grid gap-2 md:grid-cols-[88px_minmax(0,1fr)]">
      <div className="flex items-center rounded-[16px] border border-white/8 bg-black/20 px-3 py-3">
        <p className="font-['IBM_Plex_Mono'] text-[10px] uppercase tracking-[0.22em] text-stone-400">{label}</p>
      </div>
      <div
        ref={laneRef}
        className="relative min-h-[84px] rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,10,12,0.95),rgba(6,7,9,0.98))] p-2.5"
      >
        {items.length ? (
          items.map((item) => {
            const width = Math.max((item.duration / timelineDuration) * 100, 10);
            const left = (item.start / timelineDuration) * 100;
            const accent =
              item.clip.asset.kind === "image"
                ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                : item.clip.asset.kind === "video"
                  ? "border-sky-300/20 bg-sky-300/12 text-sky-50"
                  : "border-amber-300/20 bg-amber-300/12 text-amber-50";

            return (
              <button
                key={item.clip.id}
                type="button"
                onClick={() => onSelectClip(item.clip.id)}
                className={clsx(
                  "absolute bottom-2.5 top-2.5 overflow-hidden rounded-[16px] border px-2.5 py-1.5 text-left transition",
                  item.clip.id === activeClipId ? accent : "border-white/10 bg-white/[0.04] text-stone-200 hover:bg-white/[0.08]",
                )}
                style={{
                  left: `${Math.min(left, 92)}%`,
                  width: `${Math.min(width, 100 - left)}%`,
                }}
              >
                <span
                  className="absolute inset-y-1.5 left-0 w-2 cursor-ew-resize rounded-l-[16px] bg-white/0 transition hover:bg-white/10"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setTrimDrag({ clip: item.clip, side: "start", startX: event.clientX });
                  }}
                />
                <span
                  className="absolute inset-y-1.5 right-0 w-2 cursor-ew-resize rounded-r-[16px] bg-white/0 transition hover:bg-white/10"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setTrimDrag({ clip: item.clip, side: "end", startX: event.clientX });
                  }}
                />
                <p className="font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.18em] text-current/75">
                  {formatTimelineSeconds(item.start)} - {formatTimelineSeconds(item.end)}
                </p>
                <p className="mt-1 line-clamp-2 text-[10px] leading-5">{item.clip.asset.prompt}</p>
              </button>
            );
          })
        ) : (
          <div className="flex h-full min-h-[78px] items-center justify-center rounded-[14px] border border-dashed border-white/8 bg-white/[0.02] text-[10px] text-stone-500">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
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

type TileLayout = 2 | 4 | 9;

// ---------------------------------------------------------------------------
// Music player components
// ---------------------------------------------------------------------------

function formatDuration(secs: number | null | undefined) {
  if (!secs || !Number.isFinite(secs)) return "--:--";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function MusicMiniPlayer({ onExpand }: { onExpand: () => void }) {
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
    </div>
  );
}

function MusicPage() {
  const musicTracks = useAppStore((state) => state.musicTracks);
  const currentIndex = useAppStore((state) => state.musicCurrentIndex);
  const playing = useAppStore((state) => state.musicPlaying);
  const setCurrentIndex = useAppStore((state) => state.setMusicCurrentIndex);
  const setPlaying = useAppStore((state) => state.setMusicPlaying);
  const musicNext = useAppStore((state) => state.musicNext);
  const musicPrevious = useAppStore((state) => state.musicPrevious);
  const shuffleEnabled = useAppStore((state) => state.musicShuffleEnabled);
  const setShuffle = useAppStore((state) => state.setMusicShuffle);
  const repeatMode = useAppStore((state) => state.musicRepeatMode);
  const setRepeatMode = useAppStore((state) => state.setMusicRepeatMode);
  const volume = useAppStore((state) => state.musicVolume);
  const setVolume = useAppStore((state) => state.setMusicVolume);
  const refreshMusicLibrary = useAppStore((state) => state.refreshMusicLibrary);
  const setMusicFolder = useAppStore((state) => state.setMusicFolder);
  const musicFolderPath = useAppStore((state) => state.musicFolderPath);
  const [searchQuery, setSearchQuery] = useState("");
  const [folderDisplay, setFolderDisplay] = useState("");

  const track = currentIndex >= 0 && currentIndex < musicTracks.length ? musicTracks[currentIndex] : null;

  // Load the default folder path on mount so we can display it
  useEffect(() => {
    void (async () => {
      if (!musicFolderPath) {
        try {
          const defaultFolder = await api.getDefaultMusicFolder();
          setFolderDisplay(defaultFolder);
        } catch { /* ignore */ }
      } else {
        setFolderDisplay(musicFolderPath);
      }
      if (!musicTracks.length) {
        void refreshMusicLibrary();
      }
    })();
  }, []);

  useEffect(() => {
    if (musicFolderPath) setFolderDisplay(musicFolderPath);
  }, [musicFolderPath]);

  const [scanning, setScanning] = useState(false);
  const handleOpenFolder = async () => {
    try {
      const selection = await openDialog({ directory: true, multiple: false });
      if (typeof selection === "string") {
        setScanning(true);
        try {
          await setMusicFolder(selection);
        } finally {
          setScanning(false);
        }
      }
    } catch (err) {
      console.error("Failed to open folder dialog:", err);
    }
  };

  const handleRevealFolder = () => {
    const path = musicFolderPath ?? folderDisplay;
    if (path) void api.revealMusicFolder(path);
  };

  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return musicTracks;
    return musicTracks.filter(
      (t) =>
        (t.title?.toLowerCase().includes(q)) ||
        (t.artist?.toLowerCase().includes(q)) ||
        (t.album?.toLowerCase().includes(q)) ||
        t.fileName.toLowerCase().includes(q),
    );
  }, [musicTracks, searchQuery]);

  const cycleRepeat = () => {
    const modes: Array<"off" | "all" | "one"> = ["off", "all", "one"];
    const next = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
    setRepeatMode(next);
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-white/6 px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">Music</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold text-stone-100">Music Player</h2>
            <p className="mt-1 text-[11px] text-stone-500">
              {scanning ? (
                <>Scanning… <span className="font-['IBM_Plex_Mono'] text-stone-400">{folderDisplay?.replace(/^\/Users\/[^/]+/, "~")}</span></>
              ) : folderDisplay ? (
                <>Browsing <span className="font-['IBM_Plex_Mono'] text-stone-400">{folderDisplay.replace(/^\/Users\/[^/]+/, "~")}</span></>
              ) : "Play audio files from any folder on your Mac."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleOpenFolder()}
              disabled={scanning}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300/18 bg-emerald-300/10 px-3 py-2 text-[10px] text-emerald-50 transition hover:bg-emerald-300/16 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FolderOpen className="h-3 w-3" />
              {scanning ? "Scanning…" : "Open Folder"}
            </button>
            <button
              type="button"
              onClick={handleRevealFolder}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-200 transition hover:bg-white/10"
            >
              <Folder className="h-3 w-3" />
              Show in Finder
            </button>
            <button
              type="button"
              onClick={() => void refreshMusicLibrary()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-200 transition hover:bg-white/10"
            >
              <RefreshCcw className="h-3 w-3" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-0 overflow-hidden xl:grid-cols-[minmax(340px,0.7fr)_minmax(0,1.3fr)]">
        {/* Now Playing panel */}
        <section className="flex min-h-0 flex-col border-r border-white/6 overflow-hidden">
          <div className="flex flex-col items-center gap-4 px-6 py-6">
            {/* Album art */}
            {track?.coverArtDataUrl ? (
              <img
                src={track.coverArtDataUrl}
                alt=""
                className="h-48 w-48 rounded-2xl object-cover shadow-[0_24px_64px_rgba(0,0,0,0.4)] border border-white/8"
              />
            ) : (
              <div className="flex h-48 w-48 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-500/15 via-purple-500/10 to-sky-500/15 shadow-[0_24px_64px_rgba(0,0,0,0.4)]">
                <Disc3
                  className={clsx("h-20 w-20 text-emerald-200/60", playing && "animate-spin")}
                  style={{ animationDuration: "3s" }}
                />
              </div>
            )}

            {/* Track info */}
            <div className="w-full text-center">
              <p className="truncate text-[16px] font-semibold text-stone-100">
                {track?.title ?? track?.fileName ?? "No track selected"}
              </p>
              <p className="mt-1 truncate text-[12px] text-stone-400">
                {track?.artist ?? "Unknown artist"}
              </p>
              {track?.album ? (
                <p className="mt-0.5 truncate text-[11px] text-stone-500">{track.album}</p>
              ) : null}
            </div>

            {/* Transport controls */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShuffle(!shuffleEnabled)}
                className={clsx(
                  "rounded-lg p-2 transition",
                  shuffleEnabled
                    ? "text-emerald-300 bg-emerald-300/10"
                    : "text-stone-400 hover:text-stone-200 hover:bg-white/5",
                )}
              >
                <Shuffle className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={musicPrevious}
                className="rounded-lg p-2 text-stone-200 transition hover:bg-white/8"
              >
                <SkipBack className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setPlaying(!playing)}
                className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-300/25 bg-emerald-300/15 text-emerald-50 shadow-[0_0_32px_rgba(16,185,129,0.2)] transition hover:bg-emerald-300/25"
              >
                {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
              </button>
              <button
                type="button"
                onClick={musicNext}
                className="rounded-lg p-2 text-stone-200 transition hover:bg-white/8"
              >
                <SkipForward className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={cycleRepeat}
                className={clsx(
                  "rounded-lg p-2 transition",
                  repeatMode !== "off"
                    ? "text-emerald-300 bg-emerald-300/10"
                    : "text-stone-400 hover:text-stone-200 hover:bg-white/5",
                )}
              >
                {repeatMode === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
              </button>
            </div>

            {/* Volume */}
            <div className="flex w-full items-center gap-2 px-4">
              <button type="button" onClick={() => setVolume(volume > 0 ? 0 : 0.8)} className="text-stone-400 hover:text-stone-200">
                {volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-400 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-300"
              />
              <span className="font-['IBM_Plex_Mono'] text-[9px] text-stone-500 w-6 text-right">
                {Math.round(volume * 100)}
              </span>
            </div>
          </div>
        </section>

        {/* Playlist */}
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
            <ListMusic className="h-4 w-4 text-emerald-300/70" />
            <span className="text-[11px] font-semibold tracking-wide text-stone-300">
              Library ({musicTracks.length} track{musicTracks.length !== 1 ? "s" : ""})
            </span>
            <div className="ml-auto flex-1 max-w-xs">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tracks..."
                className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-1.5 text-[11px] text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/30"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredTracks.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
                  <Music className="h-7 w-7 text-stone-500" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-stone-200">
                    {musicTracks.length ? "No matching tracks" : "No music files found"}
                  </p>
                  <p className="mt-2 max-w-xs text-[11px] leading-5 text-stone-500">
                    {musicTracks.length
                      ? "Try a different search term."
                      : "Click \"Open Folder\" above to pick a folder with audio files, or drop MP3s into ~/Music/SuperASCIIVision/."}
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {filteredTracks.map((t) => {
                  const globalIdx = musicTracks.indexOf(t);
                  const isActive = globalIdx === currentIndex;
                  return (
                    <button
                      key={t.filePath}
                      type="button"
                      onClick={() => {
                        setCurrentIndex(globalIdx);
                      }}
                      className={clsx(
                        "flex w-full items-center gap-3 px-4 py-2.5 text-left transition",
                        isActive
                          ? "bg-emerald-300/[0.06]"
                          : "hover:bg-white/[0.03]",
                      )}
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center">
                        {isActive && playing ? (
                          <div className="flex items-end gap-[2px]">
                            <span className="h-3 w-[3px] rounded-full bg-emerald-400 animate-pulse" />
                            <span className="h-5 w-[3px] rounded-full bg-emerald-300 animate-pulse [animation-delay:120ms]" />
                            <span className="h-4 w-[3px] rounded-full bg-emerald-400 animate-pulse [animation-delay:240ms]" />
                          </div>
                        ) : t.coverArtDataUrl ? (
                          <img src={t.coverArtDataUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/8 bg-white/[0.03]">
                            <Music className="h-4 w-4 text-stone-500" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={clsx("truncate text-[11px] font-medium", isActive ? "text-emerald-200" : "text-stone-200")}>
                          {t.title ?? t.fileName}
                        </p>
                        <p className="truncate text-[9px] text-stone-500">
                          {t.artist ?? "Unknown artist"}
                          {t.album ? ` · ${t.album}` : ""}
                        </p>
                      </div>
                      <span className="font-['IBM_Plex_Mono'] text-[9px] text-stone-500">
                        {formatDuration(t.durationSecs)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function TilesPage() {
  const layout = useAppStore((state) => state.tileLayout);
  const setLayout = useAppStore((state) => state.setTileLayout);
  const sessions = useAppStore((state) => state.tileSessionIds);
  const setSessions = useAppStore((state) => state.setTileSessionIds);
  const sessionsRef = useRef<string[]>(sessions);
  sessionsRef.current = sessions;

  // Reconcile sessions when layout changes: keep existing, spawn/kill the diff
  useEffect(() => {
    let cancelled = false;

    const current = useAppStore.getState().tileSessionIds;

    if (current.length > layout) {
      // Downsizing: kill excess, keep the rest
      const keep = current.slice(0, layout);
      const excess = current.slice(layout);
      for (const sid of excess) {
        void api.killTerminal(sid);
      }
      setSessions(keep);
    } else if (current.length < layout) {
      // Upsizing: spawn only the additional sessions needed, saving incrementally
      const spawnExtra = async () => {
        for (let i = useAppStore.getState().tileSessionIds.length; i < layout; i++) {
          if (cancelled) return;
          const handle = await api.createTerminal();
          if (cancelled) {
            void api.killTerminal(handle.sessionId);
            return;
          }
          // Save each session immediately so cancelled spawns don't create zombies
          const latest = useAppStore.getState().tileSessionIds;
          setSessions([...latest, handle.sessionId]);
        }
      };
      void spawnExtra();
    }

    return () => {
      cancelled = true;
    };
  }, [layout, setSessions]);

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
        {sessions.map((sessionId) => (
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

      // Replay any early output (e.g. shell prompt) that was emitted before
      // the listener was ready — fixes the missing-prompt timing gap.
      try {
        const earlyOutput = await api.getTerminalBuffer(sessionId);
        if (!disposed && xtermRef.current) {
          if (earlyOutput) {
            xtermRef.current.write(earlyOutput);
          } else {
            // Session already existed (re-mount after navigation) — the early
            // buffer was already drained, so nudge the shell to redraw its prompt.
            void api.writeTerminalInput(sessionId, "\n");
          }
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

    // Fit and resize helper
    const doFitAndResize = () => {
      fitAddon.fit();
      if (sessionIdRef.current && terminal.cols > 0 && terminal.rows > 0) {
        void api.resizeTerminal(sessionIdRef.current, terminal.cols, terminal.rows);
      }
    };

    // Initial fit
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

        // Now launch the process
        const handle = await api.launchAsciivision();
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

        // Fit again now that loading overlay is gone, then send resize
        requestAnimationFrame(() => {
          if (disposed) return;
          fitAddon.fit();
          if (terminal.cols > 0 && terminal.rows > 0) {
            void api.resizeTerminal(handle.sessionId, terminal.cols, terminal.rows);
          }
          terminal.focus();
          // One more fit after a short delay to ensure layout is fully settled
          setTimeout(() => {
            if (disposed) return;
            fitAddon.fit();
            if (terminal.cols > 0 && terminal.rows > 0) {
              void api.resizeTerminal(handle.sessionId, terminal.cols, terminal.rows);
            }
          }, 200);
        });
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    };

    void launch();

    // Resize handling — debounced
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => doFitAndResize(), 50);
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
        <div ref={hostRef} className="absolute inset-0 overflow-hidden p-1" />
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
  const [draft, setDraft] = useState<Settings | undefined>(settings);
  const [xAiKey, setXAiKey] = useState("");

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  if (!draft) {
    return null;
  }

  const xAiConfigured = providerStatuses.find((status) => status.providerId === "xai")?.configured;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden rounded-[34px] bg-black/60 px-6 py-8 backdrop-blur-xl">
      <div className="w-full max-w-4xl rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,#0b0b0d_0%,#090a0c_100%)] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.6)]">
        <div className="mb-6 flex items-start justify-between gap-4 border-b border-white/6 pb-5">
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

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
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
          <button
            type="button"
            onClick={() => void saveSettings(draft)}
            className="rounded-xl border border-emerald-300/20 bg-emerald-300/12 px-4 py-2 text-[11px] text-emerald-50 transition hover:bg-emerald-300/20"
          >
            Save preferences
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[22px] border border-dashed border-white/8 bg-white/[0.02] p-4">
      <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">{eyebrow}</p>
      <h3 className="mt-2.5 text-[13px] font-semibold text-stone-100">{title}</h3>
      <p className="mt-2 text-[11px] leading-6 text-stone-500">{body}</p>
    </div>
  );
}

function ResizeHandle({
  orientation,
  onPointerDown,
}: {
  orientation: "vertical" | "horizontal";
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      className={clsx("relative bg-transparent", orientation === "vertical" ? "cursor-col-resize" : "cursor-row-resize")}
    >
      <div
        className={clsx(
          "absolute inset-0 m-auto rounded-full bg-white/6 transition hover:bg-white/12",
          orientation === "vertical" ? "h-16 w-[2px]" : "h-[2px] w-16",
        )}
      />
    </div>
  );
}

export default App;
