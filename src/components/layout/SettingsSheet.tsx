import clsx from "clsx";
import { useEffect, useState } from "react";

import { api } from "../../lib/tauri";
import { useAppStore } from "../../store/appStore";
import { useMediaStore } from "../../store/mediaStore";
import type { Settings } from "../../types";
import { CHAT_MODELS, IMAGE_MODELS, VIDEO_MODELS, XAI_VOICE_OPTIONS } from "../../constants";
import { normalizeVoiceId } from "../../utils/audio";

type SettingsTab = "shell" | "models" | "keys" | "asciivision";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "shell", label: "Shell" },
  { id: "models", label: "Models" },
  { id: "keys", label: "API Keys" },
  { id: "asciivision", label: "ASCIIVision" },
];

export function SettingsSheet({ onClose, initialTab }: { onClose: () => void; initialTab?: SettingsTab }) {
  const settings = useAppStore((state) => state.settings);
  const providerStatuses = useAppStore((state) => state.providerStatuses);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const saveApiKey = useAppStore((state) => state.saveApiKey);
  const deleteApiKey = useAppStore((state) => state.deleteApiKey);
  const ollamaModels = useAppStore((state) => state.models.ollama);
  const refreshModels = useAppStore((state) => state.refreshModels);
  const [draft, setDraft] = useState<Settings | undefined>(settings);
  const [xAiKey, setXAiKey] = useState("");
  const [avEnv, setAvEnv] = useState<Record<string, string>>({});
  const [avEnvSaved, setAvEnvSaved] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? "shell");

  useEffect(() => {
    setDraft(settings);
    void api.readAsciivisionEnv().then(setAvEnv).catch(() => {});
    void refreshModels();
  }, [settings]);

  if (!draft) {
    return null;
  }

  const xAiConfigured = providerStatuses.find((status) => status.providerId === "xai")?.configured;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden rounded-[34px] bg-black/60 px-6 py-8 backdrop-blur-xl">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,#0b0b0d_0%,#090a0c_100%)] shadow-[0_28px_100px_rgba(0,0,0,0.6)]">
        <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-white/6 px-6 pb-4 pt-6">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">Settings</p>
            <h2 className="mt-2 text-xl font-semibold text-stone-100">Shell preferences</h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    "rounded-xl border px-3 py-1.5 text-[10px] font-semibold transition",
                    activeTab === tab.id
                      ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                      : "border-white/8 bg-white/5 text-stone-400 hover:bg-white/10 hover:text-stone-200",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.12)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:my-3 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 hover:[&::-webkit-scrollbar-thumb]:bg-white/20">

        {activeTab === "shell" && (
          <section className="mt-5 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
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

              <div className="space-y-2 text-[11px] text-stone-300">
                <span>Theme</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(["", "ocean", "sunset", "violet", "golden", "crimson"] as const).map((themeId) => {
                    const label = themeId || "Emerald";
                    const active = (draft.theme ?? "") === themeId;
                    const dot = { "": "#6ee7b7", ocean: "#60a5fa", sunset: "#fb923c", violet: "#c084fc", golden: "#fbbf24", crimson: "#f87171" }[themeId];
                    return (
                      <button
                        key={themeId}
                        type="button"
                        onClick={() => {
                          setDraft({ ...draft, theme: themeId });
                          document.documentElement.setAttribute("data-theme", themeId);
                        }}
                        className={clsx(
                          "flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-medium transition",
                          active
                            ? "border-white/20 bg-white/10 text-stone-100"
                            : "border-white/8 bg-black/25 text-stone-400 hover:bg-white/7 hover:text-stone-200",
                        )}
                      >
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: dot }} />
                        {label.charAt(0).toUpperCase() + label.slice(1)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              {prefsSaved ? <span className="text-[10px] text-emerald-400 animate-pulse">Saved</span> : null}
              <button
                type="button"
                onClick={async () => {
                  await saveSettings(draft);
                  setPrefsSaved(true);
                  setTimeout(() => setPrefsSaved(false), 2500);
                }}
                className="rounded-xl border border-emerald-300/20 bg-emerald-300/12 px-4 py-2 text-[11px] text-emerald-50 transition hover:bg-emerald-300/20"
              >
                Save preferences
              </button>
            </div>
          </section>
        )}

        {activeTab === "models" && (
          <section className="mt-5 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
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

            {/* Ollama default model */}
            <div className="mt-4 rounded-2xl border border-white/8 bg-black/25 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.18em] text-stone-500">Default Ollama model</span>
                <span className="rounded-full border border-sky-300/18 bg-sky-300/10 px-2 py-0.5 font-['IBM_Plex_Mono'] text-[8px] uppercase tracking-[0.2em] text-sky-200">
                  Ollama
                </span>
              </div>
              <select
                value={draft.ollamaModel ?? ""}
                onChange={(event) => setDraft({ ...draft, ollamaModel: event.target.value || undefined })}
                className="mt-3 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none transition focus:border-sky-300/40"
              >
                <option value="">Auto (first available)</option>
                {ollamaModels.map((m) => (
                  <option key={m.modelId} value={m.modelId}>
                    {m.modelId}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-[9px] text-stone-500">
                {ollamaModels.length ? `${ollamaModels.length} model${ollamaModels.length !== 1 ? "s" : ""} detected` : "Run 'ollama serve' to detect models"}
              </p>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              {prefsSaved ? <span className="text-[10px] text-emerald-400 animate-pulse">Saved</span> : null}
              <button
                type="button"
                onClick={async () => {
                  await saveSettings(draft);
                  setPrefsSaved(true);
                  setTimeout(() => setPrefsSaved(false), 2500);
                }}
                className="rounded-xl border border-emerald-300/20 bg-emerald-300/12 px-4 py-2 text-[11px] text-emerald-50 transition hover:bg-emerald-300/20"
              >
                Save preferences
              </button>
            </div>
          </section>
        )}

        {activeTab === "keys" && (
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

            <div className="mt-5 rounded-[18px] border border-white/8 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">No API key?</p>
              <p className="mt-2 text-[11px] leading-5 text-stone-400">
                You can use <span className="font-semibold text-stone-200">Ollama</span> for fully local, private AI with no API key needed.
                Run <code className="rounded bg-white/8 px-1 py-0.5">ollama serve</code> and pull a model
                (e.g. <code className="rounded bg-white/8 px-1 py-0.5">ollama pull qwen3.5:2b</code>).
                The app detects it automatically.
              </p>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                onClick={async () => {
                  await api.clearAllMedia();
                  useMediaStore.setState({ mediaAssets: [], mediaCategories: [], mediaLoaded: false });
                }}
                className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-400 transition hover:bg-rose-500/15 hover:text-rose-200"
              >
                Clear media library
              </button>
            </div>
          </div>
        )}

        {activeTab === "asciivision" && (
          <div className="mt-5 rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-stone-500">ASCIIVision API keys</p>
                <p className="mt-1 text-[11px] text-stone-500">Saved to asciivision-core/.env for multi-provider AI chat. Your xAI key is shared automatically.</p>
              </div>
              <div className="rounded-full border border-purple-300/18 bg-purple-300/10 px-3 py-1 font-['IBM_Plex_Mono'] text-[9px] uppercase tracking-[0.2em] text-purple-200">
                Terminal
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {(
                [
                  ["CLAUDE_API_KEY", "Claude (Anthropic)"],
                  ["OPENAI_API_KEY", "GPT (OpenAI)"],
                  ["GEMINI_API_KEY", "Gemini (Google)"],
                ] as const
              ).map(([envKey, label]) => (
                <label key={envKey} className="space-y-1.5 text-[11px] text-stone-300">
                  <span className="text-[9px] text-stone-500">{label}</span>
                  <input
                    type="password"
                    value={avEnv[envKey] ?? ""}
                    onChange={(e) => { setAvEnv((prev) => ({ ...prev, [envKey]: e.target.value })); setAvEnvSaved(false); }}
                    placeholder={`Paste ${label.split(" ")[0]} key`}
                    className="w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none focus:border-purple-300/40"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  await api.writeAsciivisionEnv(avEnv);
                  setAvEnvSaved(true);
                }}
                className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-white/10"
              >
                Save ASCIIVision keys
              </button>
              {avEnvSaved ? <span className="text-[10px] text-emerald-400">Saved</span> : null}
            </div>

            <div className="mt-5 rounded-[18px] border border-white/8 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">About ASCIIVision keys</p>
              <p className="mt-2 text-[11px] leading-5 text-stone-400">
                These keys are used by the ASCIIVision terminal (the rainbow button in the nav bar) for multi-provider AI chat.
                You can switch between Claude, GPT, Gemini, and Grok with <span className="font-semibold text-stone-200">F2</span> while in the terminal.
                Only add keys for providers you want to use.
              </p>
            </div>
          </div>
        )}

        </div>{/* end scroll wrapper */}
      </div>
    </div>
  );
}
