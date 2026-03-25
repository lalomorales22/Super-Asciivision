import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { AudioLines, Files, ImagePlus, Plus, RefreshCcw, Trash2, X } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { ShellChromeContext } from "../ShellChromeContext";
import { api } from "../../lib/tauri";
import { useMediaStore } from "../../store/mediaStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { AppPage, WorkspaceItem, WorkspaceMediaFile } from "../../types";
import { EmptyPanel } from "../EmptyPanel";
import { leafName } from "../../utils/paths";

export function WorkspaceDrawer({ page }: { page: AppPage }) {
  const chrome = useContext(ShellChromeContext);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspaceItemsMap = useWorkspaceStore((state) => state.workspaceItems);
  const workspaceSelection = useWorkspaceStore((state) => state.workspaceSelection);
  const scanningWorkspaceId = useWorkspaceStore((state) => state.scanningWorkspaceId);
  const addFilesToWorkspace = useWorkspaceStore((state) => state.addFilesToWorkspace);
  const removeWorkspaceFile = useWorkspaceStore((state) => state.removeWorkspaceFile);
  const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace);
  const scanWorkspace = useWorkspaceStore((state) => state.scanWorkspace);
  const toggleWorkspaceItem = useWorkspaceStore((state) => state.toggleWorkspaceItem);
  const importLocalMediaAsset = useMediaStore((state) => state.importLocalMediaAsset);
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
