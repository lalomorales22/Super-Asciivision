import { open as openDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { FolderPlus, Hash, ListMusic, Music, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../../store/appStore";

export function MusicSidebar() {
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
