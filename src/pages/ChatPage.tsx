import clsx from "clsx";
import { Bot, Send, Square } from "lucide-react";
import { useMemo } from "react";
import { CHAT_MODELS } from "../constants";
import { EmptyPanel } from "../components/EmptyPanel";
import { MessageBubble } from "../components/MessageBubble";
import { ToolCallBlock } from "../components/ToolCallBlock";
import { useAppStore } from "../store/appStore";
import { estimateSelectedTokens } from "../utils/tokens";

export function ChatPage() {
  const conversation = useAppStore((state) => state.activeConversation);
  const composer = useAppStore((state) => state.composer);
  const sending = useAppStore((state) => state.sending);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const models = useAppStore((state) => state.models);
  const providerStatuses = useAppStore((state) => state.providerStatuses);
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
  const workspaceItemsMap = useAppStore((state) => state.workspaceItems);
  const workspaceSelection = useAppStore((state) => state.workspaceSelection);
  const selectedProvider = useAppStore((state) => state.selectedProvider);
  const setSelectedProvider = useAppStore((state) => state.setSelectedProvider);
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
  const ollamaReady = providerStatuses.find((status) => status.providerId === "ollama")?.available ?? false;
  const providerReady = selectedProvider === "ollama" ? ollamaReady : xaiReady;
  const currentModels = selectedProvider === "ollama" ? models.ollama : models.xai;

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
            body="Use xAI or Ollama language models, run local commands in the footer terminal, and send workspace-backed prompts from this page."
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
