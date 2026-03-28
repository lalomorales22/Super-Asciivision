import clsx from "clsx";
import {
  AudioLines,
  Mic,
  Pencil,
  Square,
  Trash2,
  Volume2,
  Wifi,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store/appStore";
import { useMediaStore } from "../store/mediaStore";
import {
  REALTIME_AUDIO_RATE,
  XAI_VOICE_OPTIONS,
} from "../constants";
import {
  decodeBase64Bytes,
  encodePcm16Base64,
  normalizeVoiceId,
  pcm16BytesToFloat32,
  requestMicrophoneStream,
} from "../utils/audio";
import { EmptyPanel } from "../components/EmptyPanel";
import { MediaAssetCard } from "../pages/ImaginePage";

export function VoiceAudioPage({ onShowBrowser }: { onShowBrowser: () => void }) {
  const settings = useAppStore((state) => state.settings);
  const mediaCategories = useMediaStore((state) => state.mediaCategories);
  const mediaAssets = useMediaStore((state) => state.mediaAssets);
  const createMediaCategory = useMediaStore((state) => state.createMediaCategory);
  const renameMediaCategory = useMediaStore((state) => state.renameMediaCategory);
  const deleteMediaCategory = useMediaStore((state) => state.deleteMediaCategory);
  const generatingSpeech = useMediaStore((state) => state.generatingSpeech);
  const createRealtimeSession = useMediaStore((state) => state.createRealtimeSession);
  const clearRealtimeSession = useMediaStore((state) => state.clearRealtimeSession);
  const generatingRealtimeSession = useMediaStore((state) => state.creatingRealtimeSession);
  const realtimeSession = useMediaStore((state) => state.realtimeSession);
  const generateSpeech = useMediaStore((state) => state.generateSpeech);
  const ensureMediaLoaded = useMediaStore((state) => state.ensureMediaLoaded);
  const [mode, setMode] = useState<"speech" | "realtime">("speech");
  const [speechError, setSpeechError] = useState<string>();

  useEffect(() => { void ensureMediaLoaded(); }, [ensureMediaLoaded]);
  const [speechInput, setSpeechInput] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [selectedAudioCategoryId, setSelectedAudioCategoryId] = useState<string>();
  const [galleryDensity, setGalleryDensity] = useState<4 | 5 | 6>(6);
  const [catMenu, setCatMenu] = useState<{ id: string; name: string; x: number; y: number }>();
  const [catRename, setCatRename] = useState<{ id: string; draft: string }>();

  useEffect(() => {
    if (!catMenu) return undefined;
    const dismiss = () => setCatMenu(undefined);
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [catMenu]);
  const [voiceName, setVoiceName] = useState(normalizeVoiceId(settings?.xaiVoiceName));
  const [ttsModel, setTtsModel] = useState(settings?.xaiTtsModel ?? "xai-tts");
  const [realtimeModel, setRealtimeModel] = useState(settings?.xaiRealtimeModel ?? "grok-3-mini-fast");
  const [realtimeInstructions, setRealtimeInstructions] = useState(
    "You are the voice assistant inside Super ASCIIVision. Keep responses concise and useful.",
  );
  const [realtimeStatus, setRealtimeStatus] = useState("Idle");
  const [voiceActive, setVoiceActive] = useState(false);
  const [realtimeTalkMode, setRealtimeTalkMode] = useState<"push" | "auto">("push");
  const [pushing, setPushing] = useState(false);
  const talkModeRef = useRef(realtimeTalkMode);
  talkModeRef.current = realtimeTalkMode;
  const pushingRef = useRef(pushing);
  pushingRef.current = pushing;
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
  const audioCategories = useMemo(
    () => mediaCategories.filter((c) => !c.kind || c.kind === "audio"),
    [mediaCategories],
  );
  const audioCategoryCounts = useMemo(
    () =>
      Object.fromEntries(
        audioCategories.map((category) => [
          category.id,
          mediaAssets.filter((asset) => asset.kind === "audio" && asset.categoryId === category.id).length,
        ]),
      ),
    [mediaAssets, audioCategories],
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

  const beginPushToTalk = () => {
    if (!websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) return;
    pushingRef.current = true;
    setPushing(true);
    setRealtimeStatus("Listening");
    websocketRef.current.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
  };

  const endPushToTalk = () => {
    if (!pushingRef.current) return;
    pushingRef.current = false;
    setPushing(false);
    setRealtimeStatus("Thinking");
    const ws = websocketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      ws.send(JSON.stringify({ type: "response.create" }));
    }
  };

  const startRealtimeConversation = async () => {
    if (voiceActive || generatingRealtimeSession) {
      return;
    }

    setRealtimeStatus("Starting");
    setVoiceActive(true);

    try {
      await createRealtimeSession(realtimeModel, normalizeVoiceId(voiceName), realtimeInstructions);
      const session = useMediaStore.getState().realtimeSession ?? realtimeSession;
      if (!session) {
        throw new Error("Realtime session was not created.");
      }

      // Connect via local WebSocket proxy (handles xAI auth headers server-side)
      const socket = session.proxyPort
        ? new WebSocket(`ws://127.0.0.1:${session.proxyPort}/ws`)
        : new WebSocket(session.websocketUrl, [`openai-insecure-api-key.${session.clientSecret}`]);
      websocketRef.current = socket;

      const sessionConfiguredRef2 = { current: false };

      const sendSessionUpdate = () => {
        const sessionConfig: Record<string, unknown> = {
          instructions: realtimeInstructions,
          voice: normalizeVoiceId(voiceName),
          audio: {
            input: { format: { type: "audio/pcm", rate: REALTIME_AUDIO_RATE } },
            output: { format: { type: "audio/pcm", rate: REALTIME_AUDIO_RATE } },
          },
        };
        if (talkModeRef.current === "auto") {
          sessionConfig.turn_detection = {
            type: "server_vad",
            threshold: 0.85,
            silence_duration_ms: 800,
            prefix_padding_ms: 333,
          };
        } else {
          sessionConfig.turn_detection = null;
        }
        socket.send(
          JSON.stringify({
            type: "session.update",
            session: sessionConfig,
          }),
        );
      };

      const startAudioCapture = async () => {
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
          if (socket.readyState !== WebSocket.OPEN || !sessionConfiguredRef2.current) {
            return;
          }
          // In push-to-talk mode, only send audio while the button is held
          if (talkModeRef.current === "push" && !pushingRef.current) {
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

      socket.onopen = () => {
        setRealtimeStatus("Connecting…");
        // Send session config immediately — xAI accepts it on open
        sendSessionUpdate();
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
        if (type === "conversation.created") {
          // xAI sends this first — if we haven't configured yet, send session.update now
          return;
        }
        if (type === "session.created") {
          // Some xAI flows send session.created — send config if not already sent
          return;
        }
        if (type === "session.updated") {
          sessionConfiguredRef2.current = true;
          setRealtimeStatus(talkModeRef.current === "push" ? "Hold mic to talk" : "Listening");
          void startAudioCapture();
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
          setRealtimeStatus(talkModeRef.current === "push" ? "Hold mic to talk" : "Listening");
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
        if (closeEvent.code !== 1000 && closeEvent.code !== 1005) {
          setRealtimeStatus(
            closeEvent.reason
              ? `Disconnected: ${closeEvent.reason}`
              : "Disconnected",
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
            <div className="rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-400">
              Model: {mode === "speech" ? ttsModel : realtimeModel}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {XAI_VOICE_OPTIONS.map((voice) => (
                <button
                  key={voice.id}
                  type="button"
                  onClick={() => setVoiceName(voice.id)}
                  className={clsx(
                    "rounded-xl border px-3 py-1.5 text-[10px] transition",
                    normalizeVoiceId(voiceName) === voice.id
                      ? "border-sky-300/20 bg-sky-300/12 text-sky-50"
                      : "border-white/8 bg-white/5 text-stone-300 hover:bg-white/8",
                  )}
                >
                  {voice.label}
                </button>
              ))}
            </div>

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
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRealtimeTalkMode("push")}
                      className={clsx(
                        "rounded-xl border px-3 py-1.5 text-[10px] transition",
                        realtimeTalkMode === "push"
                          ? "border-sky-300/20 bg-sky-300/12 text-sky-50"
                          : "border-white/8 bg-white/5 text-stone-400 hover:bg-white/8",
                      )}
                    >
                      Push to Talk
                    </button>
                    <button
                      type="button"
                      onClick={() => setRealtimeTalkMode("auto")}
                      className={clsx(
                        "rounded-xl border px-3 py-1.5 text-[10px] transition",
                        realtimeTalkMode === "auto"
                          ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                          : "border-white/8 bg-white/5 text-stone-400 hover:bg-white/8",
                      )}
                    >
                      Auto (hands-free)
                    </button>
                  </div>
                  <p className="text-center text-[9px] leading-4 text-stone-500">
                    {realtimeTalkMode === "push"
                      ? "Hold the mic button to speak, release to send. Best for noisy environments."
                      : "The AI listens continuously and responds when you stop talking. Best for quiet spaces."}
                  </p>
                </div>

                <div className="rounded-[22px] border border-white/8 bg-black/30 px-4 py-5">
                  <div className="flex flex-col items-center text-center">
                    {!voiceActive ? (
                      <button
                        type="button"
                        onClick={() => void startRealtimeConversation()}
                        disabled={generatingRealtimeSession}
                        className="flex h-28 w-28 items-center justify-center rounded-full border border-sky-300/24 bg-sky-300/12 text-sky-50 shadow-[0_0_0_10px_rgba(56,189,248,0.08)] transition hover:bg-sky-300/18"
                      >
                        <Mic className="h-9 w-9" />
                      </button>
                    ) : realtimeTalkMode === "push" ? (
                      <button
                        type="button"
                        onPointerDown={(e) => { e.preventDefault(); beginPushToTalk(); }}
                        onPointerUp={() => endPushToTalk()}
                        onPointerLeave={() => { if (pushing) endPushToTalk(); }}
                        className={clsx(
                          "flex h-28 w-28 select-none items-center justify-center rounded-full border transition",
                          pushing
                            ? "animate-pulse border-emerald-300/30 bg-emerald-400/20 text-emerald-50 shadow-[0_0_0_14px_rgba(52,211,153,0.12)]"
                            : "border-sky-300/24 bg-sky-300/12 text-sky-50 shadow-[0_0_0_10px_rgba(56,189,248,0.08)]",
                        )}
                      >
                        <Mic className="h-9 w-9" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void stopRealtimeConversation()}
                        className="animate-pulse flex h-28 w-28 items-center justify-center rounded-full border border-rose-300/30 bg-rose-400/15 text-rose-50 shadow-[0_0_0_10px_rgba(251,113,133,0.12)] transition"
                      >
                        <Square className="h-8 w-8" />
                      </button>
                    )}
                    <p className="mt-4 text-[12px] font-semibold text-stone-100">
                      {!voiceActive
                        ? "Tap to connect"
                        : realtimeTalkMode === "push"
                          ? pushing ? "Release to send" : "Hold to talk"
                          : "Tap to disconnect"}
                    </p>
                    <p className={clsx(
                      "mt-1 text-[11px]",
                      realtimeStatus === "Listening" || realtimeStatus === "Hold mic to talk" ? "text-emerald-300" :
                      realtimeStatus === "Responding" ? "text-sky-300" :
                      realtimeStatus === "Thinking" ? "text-amber-300" :
                      realtimeStatus.includes("error") || realtimeStatus.includes("Error") || realtimeStatus.includes("Disconnected") ? "text-rose-300" :
                      "text-stone-500",
                    )}>
                      {generatingRealtimeSession ? "Creating secure session…" : realtimeStatus}
                    </p>
                    {voiceActive ? (
                      <button
                        type="button"
                        onClick={() => void stopRealtimeConversation()}
                        className="mt-3 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-[10px] text-rose-200 transition hover:bg-rose-500/15"
                      >
                        Disconnect
                      </button>
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
                      void createMediaCategory(newCategoryName.trim(), "audio");
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
                      void createMediaCategory(newCategoryName.trim(), "audio");
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
                {audioCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedAudioCategoryId(category.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCatMenu({ id: category.id, name: category.name, x: e.clientX, y: e.clientY });
                    }}
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
            onClick={() => { void deleteMediaCategory(catMenu.id); setCatMenu(undefined); if (selectedAudioCategoryId === catMenu.id) setSelectedAudioCategoryId(undefined); }}
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
