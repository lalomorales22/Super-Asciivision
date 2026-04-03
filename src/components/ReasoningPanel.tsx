import clsx from "clsx";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { useChatStore } from "../store/chatStore";

/**
 * Collapsible panel that shows the model's reasoning/thinking tokens
 * as they stream in from xAI reasoning models.  The user can toggle
 * it open or closed — collapsed by default to keep the UI clean.
 */
export function ReasoningPanel() {
  const text = useChatStore((s) => s.reasoningText);
  const expanded = useChatStore((s) => s.reasoningExpanded);
  const toggle = useChatStore((s) => s.toggleReasoningExpanded);
  const sending = useChatStore((s) => s.sending);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom while streaming
  useEffect(() => {
    if (expanded && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [text, expanded]);

  if (!text) return null;

  const isStreaming = sending && text.length > 0;
  const lineCount = text.split("\n").length;
  const preview = text.slice(0, 120).replace(/\n/g, " ");

  return (
    <div className="mx-4 mb-2 overflow-hidden rounded-xl border border-violet-400/15 bg-violet-500/[0.04]">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-violet-500/[0.06]"
      >
        <Brain
          className={clsx(
            "h-3.5 w-3.5 shrink-0",
            isStreaming ? "animate-pulse text-violet-400" : "text-violet-400/60",
          )}
        />
        <span className="flex-1 truncate text-[11px] font-medium text-violet-300/80">
          {isStreaming ? "Thinking..." : `Reasoning (${lineCount} lines)`}
        </span>
        {!expanded && (
          <span className="mr-1 max-w-[200px] truncate text-[10px] text-violet-300/40">
            {preview}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-violet-400/50" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-violet-400/50" />
        )}
      </button>

      {expanded && (
        <div className="max-h-72 overflow-auto border-t border-violet-400/10 px-3 py-2">
          <pre className="whitespace-pre-wrap break-words font-['IBM_Plex_Mono'] text-[10px] leading-relaxed text-violet-200/60">
            {text}
            {isStreaming && <span className="animate-pulse text-violet-400">|</span>}
          </pre>
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
