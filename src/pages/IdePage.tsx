import clsx from "clsx";
import hljs from "highlight.js/lib/core";
import {
  Bot,
  ChevronRight,
  ChevronDown,
  Code2,
  Copy,
  Eye,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Pencil,
  RefreshCcw,
  Save,
  Send,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDragResize } from "../hooks/useDragResize";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, events } from "../lib/tauri";
import { useAppStore } from "../store/appStore";
import { useTerminalStore } from "../store/terminalStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import type { StreamEvent } from "../types";
import { CHAT_MODELS } from "../constants";
import { clamp, formatFileSize } from "../utils/formatting";
import { extensionForLanguage, leafName, relativeWorkspacePath, renamedPath, replacePathPrefix } from "../utils/paths";
import { buildPreviewDocument } from "../utils/html";
import { buildIdeTree } from "../utils/tree";
import type { IdeTreeNode } from "../utils/tree";
import { EmptyPanel } from "../components/EmptyPanel";
import { ResizeHandle } from "../components/ResizeHandle";
import { ShellChromeContext } from "../components/ShellChromeContext";
import { TypingIndicator } from "../components/TypingIndicator";
import { BrowserPanel } from "../components/BrowserPanel";

interface IdeContextMenuState {
  node: IdeTreeNode;
  x: number;
  y: number;
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
        />
      </div>
    </div>
  );
}

export function IdePage({ onShowBrowser }: { onShowBrowser: () => void }) {
  const chrome = useContext(ShellChromeContext);
  const settings = useAppStore((state) => state.settings);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspaceItemsMap = useWorkspaceStore((state) => state.workspaceItems);
  const scanningWorkspaceId = useWorkspaceStore((state) => state.scanningWorkspaceId);
  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
  const scanWorkspace = useWorkspaceStore((state) => state.scanWorkspace);
  const createWorkspaceFromFolder = useWorkspaceStore((state) => state.createWorkspaceFromFolder);
  const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace);
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
  const [assistantModel, setAssistantModel] = useState(settings?.xaiModel ?? "grok-4-1-fast-reasoning");
  const [assistantComposer, setAssistantComposer] = useState("");
  const [assistantConversationId, setAssistantConversationId] = useState<string>();
  const [assistantSending, setAssistantSending] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<
    Array<{ id: string; role: "user" | "assistant"; content: string; status: string }>
  >([]);
  const assistantStreamRef = useRef<string | null>(null);
  const [contextMenu, setContextMenu] = useState<IdeContextMenuState>();
  const [promptConfig, setPromptConfig] = useState<{
    label: string;
    value: string;
    resolve: (value: string | null) => void;
  } | null>(null);
  const [ideLeftWidth, setIdeLeftWidth] = useState(240);
  const [ideRightWidth, setIdeRightWidth] = useState(340);
  const [ideViewportWidth, setIdeViewportWidth] = useState(() => window.innerWidth);
  const [, startIdeLeftDrag] = useDragResize("x", useCallback((sv: number, d: number) => setIdeLeftWidth(sv + d), []));
  const [, startIdeRightDrag] = useDragResize("x", useCallback((sv: number, d: number) => setIdeRightWidth(sv - d), []));

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
    // Guard against React Strict Mode double-registration: if the cleanup
    // fires before the listen promise resolves, the first listener leaks
    // and every delta is appended twice (garbling the output). We use a
    // cancelled flag so the stale listener becomes a no-op.
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void events.onStream((event: StreamEvent) => {
      if (cancelled) return;

      setAssistantMessages((current) => {
        const idx = current.findIndex(
          (m) =>
            m.id === event.messageId ||
            (m.role === "assistant" &&
              m.status === "streaming" &&
              assistantStreamRef.current === event.messageId),
        );
        if (idx === -1) return current;

        return current.map((message, i) => {
          if (i !== idx) return message;
          const m = message.id !== event.messageId ? { ...message, id: event.messageId } : message;
          switch (event.kind) {
            case "delta":
              return { ...m, content: `${m.content}${event.textDelta ?? ""}`, status: "streaming" as const };
            case "completed":
              return { ...m, status: "complete" };
            case "cancelled":
              return { ...m, status: "cancelled" };
            case "error":
              return { ...m, status: "error", content: event.error ?? m.content };
            default:
              return m;
          }
        });
      });
      if (event.kind === "completed" || event.kind === "cancelled" || event.kind === "error") {
        setAssistantSending(false);
        assistantStreamRef.current = null;
      }
    }).then((unlisten: () => void) => {
      if (cancelled) {
        unlisten();
      } else {
        dispose = unlisten;
      }
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
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

  const showPrompt = useCallback(
    (label: string, defaultValue: string): Promise<string | null> =>
      new Promise((resolve) => {
        setPromptConfig({ label, value: defaultValue, resolve });
      }),
    [],
  );

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

    const nextName = (await showPrompt("New file name", "new-file.ts"))?.trim();
    if (!nextName) {
      return;
    }
    if (nextName.includes("/") || nextName.includes("\\")) {
      window.alert("Use a file name only, not a full path.");
      return;
    }

    const nextPath = `${node.path.replace(/\/+$/, "")}/${nextName}`;
    try {
      await api.createWorkspaceTextFile(nextPath, "");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
      return;
    }
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

    const nextName = (await showPrompt(`Rename ${node.kind}`, node.name))?.trim();
    if (!nextName || nextName === node.name) {
      return;
    }

    try {
      await api.renameWorkspacePath(node.path, nextName);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
      return;
    }

    const nextPath = renamedPath(node.path, nextName);
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

  const writeTerminalData = useTerminalStore((state) => state.writeTerminalData);

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
    const root = activeWorkspace.roots[0];
    if (!root) return;

    // Default to the directory of the currently open file, or workspace root
    let defaultName = "new-file.ts";
    if (activeFilePath) {
      const dir = activeFilePath.substring(0, activeFilePath.lastIndexOf("/") + 1);
      const relDir = dir.startsWith(root) ? dir.substring(root.replace(/\/+$/, "").length + 1) : "";
      defaultName = relDir ? `${relDir}new-file.ts` : "new-file.ts";
    }

    const fileName = (await showPrompt("File path (relative to workspace root)", defaultName))?.trim();
    if (!fileName) return;

    const newPath = `${root.replace(/\/+$/, "")}/${fileName.replace(/^\/+/, "")}`;
    try {
      await api.createWorkspaceTextFile(newPath, code);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
      return;
    }
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

    // Validate model — saved settings may reference a retired model
    const effectiveModel =
      assistantProvider === "xai" && !CHAT_MODELS.includes(assistantModel)
        ? CHAT_MODELS[0] ?? "grok-4-1-fast-reasoning"
        : assistantModel;
    if (effectiveModel !== assistantModel) {
      setAssistantModel(effectiveModel);
    }

    setAssistantSending(true);
    let conversationId = assistantConversationId;
    if (!conversationId) {
      try {
        const conversation = await api.createConversation({
          title: activeItem ? `IDE • ${leafName(activeItem.path)}` : "IDE Assistant",
        });
        conversationId = conversation.id;
        setAssistantConversationId(conversation.id);
      } catch (err) {
        setAssistantSending(false);
        return;
      }
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

    // Add placeholder assistant message BEFORE the API call so the stream
    // listener always has a target to update — eliminates the race where
    // fast error/delta events arrive before the message is in state.
    const placeholderId = `pending-${Date.now()}`;
    setAssistantMessages((current) => [
      ...current,
      { id: placeholderId, role: "assistant", content: "", status: "streaming" },
    ]);

    try {
      const handle = await api.sendMessage({
        conversationId,
        providerId: assistantProvider,
        modelId: effectiveModel,
        userText: prompt,
        selectedWorkspaceItems: activeItem ? [activeItem.id] : [],
      });
      // Store the real messageId so the stream listener can match events
      // that arrive before React reconciles the placeholder ID.
      assistantStreamRef.current = handle.messageId;
      setAssistantMessages((current) =>
        current.map((msg) =>
          msg.id === placeholderId ? { ...msg, id: handle.messageId } : msg,
        ),
      );
    } catch (err) {
      setAssistantMessages((current) =>
        current.map((msg) =>
          msg.id === placeholderId
            ? { ...msg, status: "error", content: err instanceof Error ? err.message : String(err) }
            : msg,
        ),
      );
      setAssistantSending(false);
    }
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
            onPointerDown={(event) => startIdeLeftDrag(event, clampedIdeLeftWidth)}
          />

          <section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-[linear-gradient(180deg,rgba(8,9,11,0.99),rgba(6,7,9,0.98))]">
            {/* Tab bar */}
            <div className="flex items-center gap-0 overflow-x-auto border-b border-white/6 bg-[rgba(6,7,9,0.98)] [scrollbar-width:none]">
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
            onPointerDown={(event) => startIdeRightDrag(event, clampedIdeRightWidth)}
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
                          setAssistantModel(settings?.xaiModel ?? "grok-4-1-fast-reasoning");
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
                              >
                                {message.content}
                              </ReactMarkdown>
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

      {promptConfig ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onPointerDown={() => {
            promptConfig.resolve(null);
            setPromptConfig(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              promptConfig.resolve(promptConfig.value.trim() || null);
              setPromptConfig(null);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-80 rounded-2xl border border-white/10 bg-[#0e0f11] p-5 shadow-2xl"
          >
            <label className="mb-2 block text-xs font-medium text-stone-300">
              {promptConfig.label}
            </label>
            <input
              autoFocus
              value={promptConfig.value}
              onChange={(e) =>
                setPromptConfig((s) => (s ? { ...s, value: e.target.value } : null))
              }
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  promptConfig.resolve(null);
                  setPromptConfig(null);
                }
              }}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-['IBM_Plex_Mono'] text-[11px] text-stone-100 outline-none focus:border-emerald-400/30"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  promptConfig.resolve(null);
                  setPromptConfig(null);
                }}
                className="rounded-xl px-3 py-1.5 text-[10px] text-stone-400 transition hover:text-stone-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-emerald-500/20 px-3 py-1.5 text-[10px] text-emerald-200 transition hover:bg-emerald-500/30"
              >
                OK
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
