import clsx from "clsx";
import { ChevronDown, ChevronRight, Check, X, Loader2 } from "lucide-react";
import { useState } from "react";

interface AgentToolCardProps {
  toolName: string;
  args: string;
  result?: string;
  success?: boolean;
  isRunning: boolean;
}

export function AgentToolCard({ toolName, args, result, success, isRunning }: AgentToolCardProps) {
  const [expanded, setExpanded] = useState(false);

  const icon = isRunning ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
  ) : success ? (
    <Check className="h-3.5 w-3.5 text-emerald-400" />
  ) : (
    <X className="h-3.5 w-3.5 text-red-400" />
  );

  // One-line summary for collapsed state
  let summary = toolName;
  try {
    const parsed = JSON.parse(args);
    if (parsed.path) summary += ` ${parsed.path}`;
    else if (parsed.command) summary += ` ${parsed.command.slice(0, 60)}`;
    else if (parsed.pattern) summary += ` ${parsed.pattern}`;
    else if (parsed.label) summary += ` "${parsed.label}"`;
  } catch { /* ignore */ }

  return (
    <div className="my-1 rounded-lg border border-white/8 bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-stone-300 hover:bg-white/5 transition"
      >
        {icon}
        <span className="flex-1 truncate font-['IBM_Plex_Mono'] text-[11px]">{summary}</span>
        {expanded ? <ChevronDown className="h-3 w-3 text-stone-500" /> : <ChevronRight className="h-3 w-3 text-stone-500" />}
      </button>
      {expanded && (
        <div className="border-t border-white/6 px-3 py-2 text-[10px]">
          <div className="mb-1 text-stone-500">Input:</div>
          <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-['IBM_Plex_Mono'] text-[10px] text-stone-400">{args}</pre>
          {result != null && (
            <>
              <div className="mb-1 text-stone-500">Output:</div>
              <pre className={clsx(
                "max-h-60 overflow-auto whitespace-pre-wrap break-all font-['IBM_Plex_Mono'] text-[10px]",
                success === false ? "text-red-300" : "text-stone-400"
              )}>{result}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
