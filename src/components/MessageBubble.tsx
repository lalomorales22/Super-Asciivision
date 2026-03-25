import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../types";
import { CodeBlock } from "./CodeBlock";
import { TypingIndicator } from "./TypingIndicator";

export function MessageBubble({ message }: { message: Message }) {
  const isAssistant = message.role === "assistant";
  return (
    <article
      className={clsx(
        "max-w-[92%] rounded-[20px] border px-3.5 py-2.5 shadow-[0_16px_30px_rgba(0,0,0,0.18)]",
        isAssistant
          ? "border-white/8 bg-white/[0.04] text-stone-100"
          : "ml-auto border-emerald-200/12 bg-emerald-300/10 text-emerald-50",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-stone-300">
            {isAssistant ? "Assistant" : "You"}
          </p>
          <p className="mt-1 font-['IBM_Plex_Mono'] text-[10px] text-stone-400">
            {message.modelId ?? "local"} · {message.status === "streaming" ? "Generating…" : message.status}
          </p>
        </div>
        {message.usage ? (
          <p className="font-['IBM_Plex_Mono'] text-[10px] text-stone-400">
            in {message.usage.inputTokens ?? 0} / out {message.usage.outputTokens ?? 0}
          </p>
        ) : null}
      </div>

      {isAssistant ? (
        <div className="prose prose-invert prose-pre:rounded-xl prose-pre:border prose-pre:border-white/8 prose-pre:bg-black/40 prose-code:font-['IBM_Plex_Mono'] max-w-none text-[12px] leading-6">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const language = className?.replace("language-", "");
                const code = String(children ?? "").replace(/\n$/, "");
                const inline = !className;
                if (inline) {
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                }
                return <CodeBlock code={code} language={language} />;
              },
            }}
          >
            {message.content || "…"}
          </ReactMarkdown>
          {!message.content && message.status === "streaming" ? <TypingIndicator /> : null}
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-[12px] leading-6">{message.content}</p>
      )}

      {message.error ? <p className="mt-3 text-[10px] text-rose-200">{message.error}</p> : null}
    </article>
  );
}
