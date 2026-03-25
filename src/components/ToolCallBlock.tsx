import clsx from "clsx";
import { ChevronRight, Code2 } from "lucide-react";
import { useState } from "react";

export function ToolCallBlock({ toolName, args, result, success, isRunning }: {
  toolName: string;
  args: string;
  result?: string;
  success?: boolean;
  isRunning?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = isRunning ? "text-amber-300" : success ? "text-emerald-300" : "text-rose-300";
  const statusBorder = isRunning ? "border-amber-300/20" : success ? "border-emerald-300/20" : "border-rose-300/20";
  const statusBg = isRunning ? "bg-amber-300/5" : success ? "bg-emerald-300/5" : "bg-rose-300/5";

  return (
    <div className={clsx("my-2 overflow-hidden rounded-xl border", statusBorder, statusBg)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Code2 className={clsx("h-3 w-3 shrink-0", statusColor)} />
        <span className={clsx("font-['IBM_Plex_Mono'] text-[10px] font-semibold", statusColor)}>
          {toolName}
        </span>
        <span className="text-[10px] text-stone-500">
          {isRunning ? "running…" : success ? "completed" : "failed"}
        </span>
        <ChevronRight className={clsx("ml-auto h-3 w-3 text-stone-500 transition", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <div className="border-t border-white/5 px-3 py-2">
          {args && (
            <div className="mb-2">
              <p className="mb-1 text-[9px] uppercase tracking-wider text-stone-500">Input</p>
              <pre className="overflow-x-auto rounded-lg bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-300">
                {(() => { try { return JSON.stringify(JSON.parse(args), null, 2); } catch { return args; } })()}
              </pre>
            </div>
          )}
          {result && (
            <div>
              <p className="mb-1 text-[9px] uppercase tracking-wider text-stone-500">Output</p>
              <pre className="max-h-64 overflow-auto rounded-lg bg-black/30 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-300">
                {result.length > 3000 ? `${result.slice(0, 3000)}\n\n... (truncated)` : result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
