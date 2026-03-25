import clsx from "clsx";
import {
  AudioLines,
  Copy,
  Download,
  Eye,
  ImagePlus,
  Pencil,
  Save,
  Trash2,
  Video,
  WandSparkles,
} from "lucide-react";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/tauri";
import { useAppStore } from "../store/appStore";
import { useMediaStore } from "../store/mediaStore";
import type { MediaAsset } from "../types";
import {
  IMAGE_MODELS,
  IMAGE_ASPECT_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
  OLLAMA_IMAGE_MODELS,
  VIDEO_MODELS,
} from "../constants";
import { leafName } from "../utils/paths";
import { buildAssetPreviewDocument } from "../utils/html";
import { EmptyPanel } from "../components/EmptyPanel";
import { ShellChromeContext } from "../components/ShellChromeContext";

export function ImaginePage({ onShowBrowser }: { onShowBrowser: () => void }) {
  const settings = useAppStore((state) => state.settings);
  const providerStatuses = useAppStore((state) => state.providerStatuses);
  const models = useAppStore((state) => state.models);
  const mediaCategories = useMediaStore((state) => state.mediaCategories);
  const mediaAssets = useMediaStore((state) => state.mediaAssets);
  const generatingImage = useMediaStore((state) => state.generatingImage);
  const generatingVideo = useMediaStore((state) => state.generatingVideo);
  const createMediaCategory = useMediaStore((state) => state.createMediaCategory);
  const renameMediaCategory = useMediaStore((state) => state.renameMediaCategory);
  const deleteMediaCategory = useMediaStore((state) => state.deleteMediaCategory);
  const generateImage = useMediaStore((state) => state.generateImage);
  const generateVideo = useMediaStore((state) => state.generateVideo);
  const ensureMediaLoaded = useMediaStore((state) => state.ensureMediaLoaded);
  const ollamaReady = providerStatuses.find((s) => s.providerId === "ollama")?.available ?? false;
  const ollamaImageAvailable = ollamaReady && models.ollama.some((m) => OLLAMA_IMAGE_MODELS.some((om) => m.modelId.startsWith(om.split(":")[0])));
  const [mode, setMode] = useState<"image" | "video">("image");
  const [mediaPrompt, setMediaPrompt] = useState("");
  const [imageModel, setImageModel] = useState(settings?.xaiImageModel ?? IMAGE_MODELS[1]);
  const [videoModel, setVideoModel] = useState(settings?.xaiVideoModel ?? VIDEO_MODELS[0]);
  const [imageAspectRatio, setImageAspectRatio] = useState("1:1");
  const [imageResolution, setImageResolution] = useState("1k");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [selectedVisualCategoryId, setSelectedVisualCategoryId] = useState<string>();
  const [galleryDensity, setGalleryDensity] = useState<4 | 5 | 6>(5);
  const [catMenu, setCatMenu] = useState<{ id: string; name: string; x: number; y: number }>();
  const [catRename, setCatRename] = useState<{ id: string; draft: string }>();

  useEffect(() => {
    if (!catMenu) return undefined;
    const dismiss = () => setCatMenu(undefined);
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [catMenu]);

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
  const visualCategories = useMemo(
    () => mediaCategories.filter((c) => !c.kind || c.kind === "visual"),
    [mediaCategories],
  );
  const visualCategoryCounts = useMemo(
    () =>
      Object.fromEntries(
        visualCategories.map((category) => [
          category.id,
          mediaAssets.filter((asset) => asset.kind !== "audio" && asset.categoryId === category.id).length,
        ]),
      ),
    [mediaAssets, visualCategories],
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
                {mode === "image" && OLLAMA_IMAGE_MODELS.map((modelId) => (
                  <button
                    key={modelId}
                    type="button"
                    onClick={() => ollamaImageAvailable && setImageModel(modelId)}
                    disabled={!ollamaImageAvailable}
                    title={
                      !ollamaReady
                        ? "Ollama is not running — start with: ollama serve"
                        : !ollamaImageAvailable
                          ? `Model not installed — run: ollama pull ${modelId}`
                          : `Generate with ${modelId} (local, macOS only)`
                    }
                    className={clsx(
                      "rounded-xl border px-3 py-2 text-[10px] font-['IBM_Plex_Mono'] transition",
                      !ollamaImageAvailable
                        ? "cursor-not-allowed border-white/5 bg-black/20 text-stone-600"
                        : imageModel === modelId
                          ? "border-orange-300/20 bg-orange-300/12 text-orange-50"
                          : "border-white/8 bg-black/30 text-stone-300 hover:bg-white/8",
                    )}
                  >
                    {modelId}
                    {!ollamaImageAvailable && (
                      <span className="ml-1 text-[8px] text-stone-600">(unavailable)</span>
                    )}
                  </button>
                ))}
              </div>
              {mode === "image" && !ollamaImageAvailable && (
                <div className="mt-2 rounded-xl border border-orange-300/12 bg-orange-300/5 px-3 py-2.5">
                  <p className="text-[10px] font-medium text-orange-200/80">Local image generation requires Ollama</p>
                  <p className="mt-1 text-[10px] leading-4 text-stone-500">
                    {!ollamaReady
                      ? "Ollama is not running. Start it first, then pull the models:"
                      : "Ollama is running but the models need to be downloaded:"}
                  </p>
                  <div className="mt-2 space-y-1">
                    {!ollamaReady && (
                      <code className="block rounded-lg bg-black/40 px-2 py-1 font-['IBM_Plex_Mono'] text-[9px] text-stone-400">ollama serve</code>
                    )}
                    {OLLAMA_IMAGE_MODELS.map((modelId) => (
                      <code key={modelId} className="block rounded-lg bg-black/40 px-2 py-1 font-['IBM_Plex_Mono'] text-[9px] text-stone-400">
                        ollama pull {modelId}
                      </code>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {mode === "image" && !imageModel.startsWith("x/") ? (
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
                      void createMediaCategory(newCategoryName.trim(), "visual");
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
                    void createMediaCategory(newCategoryName.trim(), "visual");
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
              {visualCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedVisualCategoryId(category.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCatMenu({ id: category.id, name: category.name, x: e.clientX, y: e.clientY });
                  }}
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
      {catMenu ? (
        <div
          className="fixed z-50 w-40 rounded-[18px] border border-white/8 bg-[#0b0c0d] p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.45)]"
          style={{ left: Math.min(catMenu.x, window.innerWidth - 172), top: Math.min(catMenu.y, window.innerHeight - 100) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => { setCatRename({ id: catMenu.id, draft: catMenu.name }); setCatMenu(undefined); }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-stone-200 transition hover:bg-white/7"
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </button>
          <button
            type="button"
            onClick={() => { void deleteMediaCategory(catMenu.id); setCatMenu(undefined); if (selectedVisualCategoryId === catMenu.id) setSelectedVisualCategoryId(undefined); }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-rose-100 transition hover:bg-rose-500/15"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      ) : null}
      {catRename ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onPointerDown={() => setCatRename(undefined)}>
          <div className="w-full max-w-sm rounded-[24px] border border-white/10 bg-[#0b0c0d] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.5)]" onPointerDown={(e) => e.stopPropagation()}>
            <p className="text-[10px] uppercase tracking-[0.28em] text-[#84a09b]">Rename Category</p>
            <input
              autoFocus
              value={catRename.draft}
              onChange={(e) => setCatRename({ ...catRename, draft: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && catRename.draft.trim()) { void renameMediaCategory(catRename.id, catRename.draft.trim()); setCatRename(undefined); }
                if (e.key === "Escape") setCatRename(undefined);
              }}
              className="mt-3 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2.5 text-[12px] text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/35"
              placeholder="Category name"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setCatRename(undefined)} className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-300 transition hover:bg-white/10">Cancel</button>
              <button
                type="button"
                onClick={() => { if (catRename.draft.trim()) { void renameMediaCategory(catRename.id, catRename.draft.trim()); setCatRename(undefined); } }}
                disabled={!catRename.draft.trim()}
                className="rounded-xl border border-emerald-300/20 bg-emerald-300/12 px-3 py-2 text-[10px] font-semibold text-emerald-50 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/5 disabled:text-stone-500"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
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

export const MediaAssetCard = React.memo(function MediaAssetCard({ asset, onShowBrowser }: { asset: MediaAsset; onShowBrowser: () => void }) {
  const chrome = useContext(ShellChromeContext);
  const mediaCategories = useMediaStore((state) => state.mediaCategories);
  const moveMediaAssetToCategory = useMediaStore((state) => state.moveMediaAssetToCategory);
  const renameMediaAsset = useMediaStore((state) => state.renameMediaAsset);
  const deleteMediaAsset = useMediaStore((state) => state.deleteMediaAsset);
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
});
