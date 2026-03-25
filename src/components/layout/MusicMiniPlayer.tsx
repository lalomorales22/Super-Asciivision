import { convertFileSrc } from "@tauri-apps/api/core";
import clsx from "clsx";
import { Disc3, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMusicStore } from "../../store/musicStore";
import { formatDuration } from "../../utils/formatting";

export function MusicMiniPlayer({ onExpand, onHide }: { onExpand: () => void; onHide: () => void }) {
  const musicTracks = useMusicStore((state) => state.musicTracks);
  const currentIndex = useMusicStore((state) => state.musicCurrentIndex);
  const playing = useMusicStore((state) => state.musicPlaying);
  const setPlaying = useMusicStore((state) => state.setMusicPlaying);
  const musicNext = useMusicStore((state) => state.musicNext);
  const musicPrevious = useMusicStore((state) => state.musicPrevious);
  const volume = useMusicStore((state) => state.musicVolume);
  const setVolume = useMusicStore((state) => state.setMusicVolume);
  const repeatMode = useMusicStore((state) => state.musicRepeatMode);
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
            <Disc3 className={clsx("h-4 w-4 text-emerald-200", playing && "animate-spin [animation-duration:3s]")} />
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
