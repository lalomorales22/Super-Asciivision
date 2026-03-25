import { open as openDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import {
  Disc3,
  Folder,
  FolderOpen,
  Hash,
  ListMusic,
  Music,
  Pause,
  Play,
  RefreshCcw,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/tauri";
import { useMusicStore } from "../store/musicStore";
import { formatDuration } from "../utils/formatting";

export function MusicPage() {
  const musicTracks = useMusicStore((state) => state.musicTracks);
  const currentIndex = useMusicStore((state) => state.musicCurrentIndex);
  const playing = useMusicStore((state) => state.musicPlaying);
  const setCurrentIndex = useMusicStore((state) => state.setMusicCurrentIndex);
  const setPlaying = useMusicStore((state) => state.setMusicPlaying);
  const musicNext = useMusicStore((state) => state.musicNext);
  const musicPrevious = useMusicStore((state) => state.musicPrevious);
  const shuffleEnabled = useMusicStore((state) => state.musicShuffleEnabled);
  const setShuffle = useMusicStore((state) => state.setMusicShuffle);
  const repeatMode = useMusicStore((state) => state.musicRepeatMode);
  const setRepeatMode = useMusicStore((state) => state.setMusicRepeatMode);
  const volume = useMusicStore((state) => state.musicVolume);
  const setVolume = useMusicStore((state) => state.setMusicVolume);
  const refreshMusicLibrary = useMusicStore((state) => state.refreshMusicLibrary);
  const setMusicFolder = useMusicStore((state) => state.setMusicFolder);
  const musicFolderPath = useMusicStore((state) => state.musicFolderPath);
  const activeMusicCategory = useMusicStore((state) => state.activeMusicCategory);
  const refreshMusicCategories = useMusicStore((state) => state.refreshMusicCategories);
  const musicCategories = useMusicStore((state) => state.musicCategories);
  const linkTracksToCategory = useMusicStore((state) => state.linkTracksToCategory);
  const [searchQuery, setSearchQuery] = useState("");
  const [folderDisplay, setFolderDisplay] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; track: typeof musicTracks[number] } | null>(null);

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
      void refreshMusicCategories();
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
    let tracks = musicTracks;
    // Filter by active category
    if (activeMusicCategory === "__uncategorized__") {
      tracks = tracks.filter((t) => !t.category);
    } else if (activeMusicCategory) {
      tracks = tracks.filter((t) => t.category === activeMusicCategory);
    }
    // Filter by search query
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      tracks = tracks.filter(
        (t) =>
          (t.title?.toLowerCase().includes(q)) ||
          (t.artist?.toLowerCase().includes(q)) ||
          (t.album?.toLowerCase().includes(q)) ||
          t.fileName.toLowerCase().includes(q),
      );
    }
    return tracks;
  }, [musicTracks, searchQuery, activeMusicCategory]);

  const cycleRepeat = () => {
    const modes: Array<"off" | "all" | "one"> = ["off", "all", "one"];
    const next = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
    setRepeatMode(next);
  };

  // Close context menu on click anywhere or Escape
  useEffect(() => {
    if (!ctxMenu) return undefined;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", onKey); };
  }, [ctxMenu]);

  const handleAddToPlaylist = async (track: typeof musicTracks[number], categoryName: string) => {
    try {
      await linkTracksToCategory([track.filePath], categoryName);
    } catch (err) {
      console.error("Failed to add to playlist:", err);
    }
    setCtxMenu(null);
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
              onClick={() => { void refreshMusicLibrary(); void refreshMusicCategories(); }}
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
              {activeMusicCategory && activeMusicCategory !== "__uncategorized__"
                ? activeMusicCategory
                : activeMusicCategory === "__uncategorized__"
                  ? "Uncategorized"
                  : "Library"}{" "}
              ({filteredTracks.length} track{filteredTracks.length !== 1 ? "s" : ""})
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
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCtxMenu({ x: e.clientX, y: e.clientY, track: t });
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

      {/* Right-click context menu */}
      {ctxMenu
        ? createPortal(
            <div
              className="fixed z-[9999] min-w-[180px] rounded-xl border border-white/10 bg-[#1a1b1e]/95 py-1 shadow-2xl backdrop-blur-xl"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="truncate px-3 py-1.5 text-[10px] font-semibold text-stone-300">
                {ctxMenu.track.title ?? ctxMenu.track.fileName}
              </p>
              <div className="my-1 border-t border-white/6" />
              {musicCategories.length > 0 ? (
                <>
                  <p className="px-3 py-1 text-[9px] uppercase tracking-[0.2em] text-stone-500">Add to playlist</p>
                  {musicCategories.map((cat) => (
                    <button
                      key={cat.path}
                      type="button"
                      onClick={() => void handleAddToPlaylist(ctxMenu.track, cat.name)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-stone-200 transition hover:bg-white/8"
                    >
                      <Hash className="h-3 w-3 text-purple-300/70" />
                      {cat.name}
                    </button>
                  ))}
                  <div className="my-1 border-t border-white/6" />
                </>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setCtxMenu(null);
                  // Reveal track in Finder
                  const dir = ctxMenu.track.filePath.substring(0, ctxMenu.track.filePath.lastIndexOf("/"));
                  if (dir) void api.revealMusicFolder(dir);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-stone-300 transition hover:bg-white/8"
              >
                <Folder className="h-3 w-3 text-stone-400" />
                Show in Finder
              </button>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
