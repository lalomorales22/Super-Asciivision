import clsx from "clsx";
import { Bot, Send, Square, Settings, X } from "lucide-react";
import { useMemo, useState } from "react";
import { CHAT_MODELS } from "../constants";
import { EmptyPanel } from "../components/EmptyPanel";
import { MessageBubble } from "../components/MessageBubble";
import { ToolCallBlock } from "../components/ToolCallBlock";
import { useAppStore } from "../store/appStore";
import { useChatStore } from "../store/chatStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { estimateSelectedTokens } from "../utils/tokens";

const WELCOME_DISMISSED_KEY = "superasciivision_welcome_dismissed";

function SetupPrompt() {
  const toggleSettings = useAppStore((state) => state.toggleSettings);
  return (
    <div className="rounded-[22px] border border-amber-300/14 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.08),rgba(12,14,16,0.98)_50%)] p-5">
      <p className="text-[10px] uppercase tracking-[0.35em] text-amber-200/70">Setup needed</p>
      <h3 className="mt-2.5 text-[15px] font-semibold text-stone-100">No AI provider configured</h3>
      <p className="mt-2 max-w-xl text-[11px] leading-6 text-stone-400">
        Super ASCIIVision needs at least one AI provider to work. You have two options:
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-200">Option A: xAI (cloud)</p>
          <p className="mt-2 text-[11px] leading-5 text-stone-400">
            Get an API key from <span className="font-semibold text-stone-200">console.x.ai</span> and paste it in Settings.
            Powers chat, image/video generation, voice, and TTS.
          </p>
          <button
            type="button"
            onClick={() => toggleSettings(true, "keys")}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-sky-300/18 bg-sky-300/10 px-3 py-1.5 text-[10px] font-semibold text-sky-100 transition hover:bg-sky-300/18"
          >
            <Settings className="h-3 w-3" />
            Open API Keys
          </button>
        </div>
        <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-200">Option B: Ollama (local)</p>
          <p className="mt-2 text-[11px] leading-5 text-stone-400">
            Run AI entirely on your machine. No API key, no data leaves your device.
          </p>
          <div className="mt-3 space-y-1.5 rounded-[14px] border border-white/8 bg-black/20 p-2.5 font-['IBM_Plex_Mono'] text-[10px] text-stone-300">
            <p>$ ollama serve</p>
            <p>$ ollama pull qwen3.5:2b</p>
          </div>
          <p className="mt-2 text-[10px] text-stone-500">Then restart the app. Ollama is detected automatically.</p>
        </div>
      </div>
    </div>
  );
}

function WelcomeBanner({ onDismiss }: { onDismiss: () => void }) {
  const toggleSettings = useAppStore((state) => state.toggleSettings);
  return (
    <div className="rounded-[22px] border border-emerald-300/14 bg-[radial-gradient(circle_at_top_left,rgba(110,231,183,0.06),rgba(12,14,16,0.98)_50%)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">Welcome</p>
          <h3 className="mt-2 text-[15px] font-semibold text-stone-100">Welcome to Super ASCIIVision</h3>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-white/8 bg-white/5 p-1.5 text-stone-400 transition hover:bg-white/10 hover:text-stone-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-2 max-w-2xl text-[11px] leading-6 text-stone-400">
        This is your AI-powered desktop shell. Here are the pages in the nav bar above:
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Chat", "AI conversations with workspace context and agent mode"],
          ["Image & Video", "Generate images and video with xAI"],
          ["Voice & Audio", "Text-to-speech and live voice chat"],
          ["Media Editor", "Timeline-based editing with ffmpeg export"],
          ["IDE", "Code editor with AI copilot and browser preview"],
          ["Tiles", "Multi-terminal grid (1x2, 2x2, 3x3)"],
          ["Music", "Built-in player for your local library"],
          ["Hands", "Remote access from your phone"],
        ].map(([title, desc]) => (
          <div key={title} className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
            <p className="text-[10px] font-semibold text-stone-200">{title}</p>
            <p className="mt-1 text-[9px] leading-4 text-stone-500">{desc}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => toggleSettings(true, "keys")}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300/18 bg-emerald-300/10 px-3 py-1.5 text-[10px] font-semibold text-emerald-100 transition hover:bg-emerald-300/18"
        >
          <Settings className="h-3 w-3" />
          Open Settings
        </button>
        <p className="text-[10px] text-stone-500">
          Try the rainbow <span className="font-semibold text-stone-300">ASCIIVISION</span> button in the nav bar for the full terminal experience.
        </p>
      </div>
    </div>
  );
}

export function ChatPage() {
  const conversation = useChatStore((state) => state.activeConversation);
  const conversations = useChatStore((state) => state.conversations);
  const composer = useChatStore((state) => state.composer);
  const sending = useChatStore((state) => state.sending);
  const setComposer = useChatStore((state) => state.setComposer);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const sendAgentMessage = useChatStore((state) => state.sendAgentMessage);
  const stopStream = useChatStore((state) => state.stopStream);
  const agentMode = useChatStore((state) => state.agentMode);
  const toggleAgentMode = useChatStore((state) => state.toggleAgentMode);
  const agentToolCalls = useChatStore((state) => state.agentToolCalls);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const models = useAppStore((state) => state.models);
  const providerStatuses = useAppStore((state) => state.providerStatuses);
  const selectedProvider = useAppStore((state) => state.selectedProvider);
  const setSelectedProvider = useAppStore((state) => state.setSelectedProvider);
  const selectModel = useAppStore((state) => state.selectModel);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspaceItemsMap = useWorkspaceStore((state) => state.workspaceItems);
  const workspaceSelection = useWorkspaceStore((state) => state.workspaceSelection);

  const [welcomeDismissed, setWelcomeDismissed] = useState(
    () => localStorage.getItem(WELCOME_DISMISSED_KEY) === "1",
  );

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
  const ollamaReady = providerStatuses.find((status) => status.providerId === "ollama")?.available ?? false;
  const xaiConfigured = providerStatuses.find((status) => status.providerId === "xai")?.configured ?? false;
  const providerReady = selectedProvider === "ollama" ? ollamaReady : xaiReady;
  const noProviderAtAll = !xaiConfigured && !ollamaReady;
  const currentModels = selectedProvider === "ollama" ? models.ollama : models.xai;
  const isFirstRun = conversations.length === 0 && !conversation?.messages.length;

  const handleSend = agentMode ? sendAgentMessage : sendMessage;

  const dismissWelcome = () => {
    localStorage.setItem(WELCOME_DISMISSED_KEY, "1");
    setWelcomeDismissed(true);
  };

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
          <div className="space-y-3">
            {noProviderAtAll && <SetupPrompt />}
            {isFirstRun && !welcomeDismissed && !noProviderAtAll && (
              <WelcomeBanner onDismiss={dismissWelcome} />
            )}
            {(welcomeDismissed || !isFirstRun) && !noProviderAtAll && (
              <EmptyPanel
                eyebrow="Chat"
                title="Coding shell."
                body="Use xAI or Ollama language models, run local commands in the footer terminal, and send workspace-backed prompts from this page."
              />
            )}
          </div>
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
          {!providerReady ? (
            <span className="rounded-full border border-amber-200/20 bg-amber-300/10 px-3 py-1 text-amber-100">
              {selectedProvider === "ollama" ? "Ollama unavailable" : "xAI unavailable"}
            </span>
          ) : null}
        </div>

        <div className="rounded-[20px] border border-white/7 bg-black/30 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedProvider("xai")}
              className={clsx(
                "rounded-xl border px-2 py-1.5 text-[10px] font-semibold transition",
                selectedProvider === "xai"
                  ? "border-sky-300/30 bg-sky-300/15 text-sky-100"
                  : "border-white/8 bg-black/35 text-stone-400 hover:bg-white/10 hover:text-stone-200",
              )}
            >
              xAI
            </button>
            <button
              type="button"
              onClick={() => setSelectedProvider("ollama")}
              className={clsx(
                "rounded-xl border px-2 py-1.5 text-[10px] font-semibold transition",
                selectedProvider === "ollama"
                  ? "border-orange-300/30 bg-orange-300/15 text-orange-100"
                  : "border-white/8 bg-black/35 text-stone-400 hover:bg-white/10 hover:text-stone-200",
              )}
            >
              Ollama
            </button>
            <select
              value={selectedModel ?? ""}
              onChange={(event) => selectModel(event.target.value)}
              className="min-w-56 rounded-xl border border-white/8 bg-black/35 px-2 py-1.5 font-['IBM_Plex_Mono'] text-[10px] text-stone-300 outline-none transition focus:border-sky-300/40"
            >
              {selectedProvider === "ollama" ? (
                currentModels.length ? (
                  currentModels.map((model) => (
                    <option key={model.modelId} value={model.modelId}>
                      {model.label}
                    </option>
                  ))
                ) : (
                  <option value="">No Ollama models installed</option>
                )
              ) : (
                (currentModels.length ? currentModels : CHAT_MODELS.map((modelId) => ({ modelId, label: modelId } as const))).map(
                  (model) => (
                    <option key={model.modelId} value={model.modelId}>
                      {model.label}
                    </option>
                  ),
                )
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
                disabled={!providerReady}
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
