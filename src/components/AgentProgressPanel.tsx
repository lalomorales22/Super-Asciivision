import { Loader2 } from "lucide-react";
import { useChatStore } from "../store/chatStore";

export function AgentProgressPanel() {
  const thinking = useChatStore((s) => s.agentThinking);
  const progress = useChatStore((s) => s.agentProgress);
  const subAgents = useChatStore((s) => s.subAgents);
  const pending = useChatStore((s) => s.pendingApproval);
  const respondToApproval = useChatStore((s) => s.respondToApproval);

  if (!thinking && !progress && subAgents.length === 0 && !pending) return null;

  return (
    <div className="mx-4 mb-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
      {thinking && (
        <div className="flex items-center gap-2 text-[11px] text-stone-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
          <span>{thinking.message}</span>
        </div>
      )}

      {progress && (
        <div className="mt-1 flex items-center gap-3 text-[10px] text-stone-500">
          <span>Iteration {progress.iteration}/{progress.maxIterations}</span>
          <span>{(progress.elapsedMs / 1000).toFixed(1)}s</span>
        </div>
      )}

      {pending && (
        <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
          <div className="text-[11px] font-medium text-amber-300">
            Approval Required: {pending.toolName}
          </div>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-['IBM_Plex_Mono'] text-[10px] text-stone-400">
            {pending.toolArgs}
          </pre>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => respondToApproval(true)}
              className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-medium text-emerald-300 hover:bg-emerald-400/20 transition"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => respondToApproval(false)}
              className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-1 text-[10px] font-medium text-red-300 hover:bg-red-400/20 transition"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {subAgents.length > 0 && (
        <div className="mt-2 space-y-1">
          {subAgents.map((sa) => (
            <div key={sa.agentId} className="flex items-center gap-2 text-[10px]">
              {sa.status === "running" ? (
                <Loader2 className="h-3 w-3 animate-spin text-sky-400" />
              ) : sa.status === "complete" ? (
                <span className="text-emerald-400">&#10003;</span>
              ) : (
                <span className="text-red-400">&#10007;</span>
              )}
              <span className="text-stone-400">{sa.label}</span>
              {sa.summary && <span className="truncate text-stone-500">— {sa.summary.slice(0, 80)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
