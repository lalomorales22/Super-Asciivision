import clsx from "clsx";
import hljs from "highlight.js/lib/core";
import { Copy, Download, Eye } from "lucide-react";
import React, { useContext, useMemo, useState } from "react";
import { extensionForLanguage } from "../utils/paths";
import { buildPreviewDocument } from "../utils/html";
import { ShellChromeContext } from "./ShellChromeContext";

export const CodeBlock = React.memo(function CodeBlock({ code, language }: { code: string; language?: string }) {
  const chrome = useContext(ShellChromeContext);
  const label = (language ?? "code").toLowerCase();
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(code.split("\n").length > 60);
  const lineCount = code.split("\n").length;

  const highlighted = useMemo(() => {
    const lang = (language ?? "").toLowerCase();
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch {
        // fallback
      }
    }
    try {
      return hljs.highlightAuto(code).value;
    } catch {
      return null;
    }
  }, [code, language]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `snippet.${extensionForLanguage(language)}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="my-4 overflow-hidden rounded-[18px] border border-white/8 bg-[#0a0d0f] shadow-[0_10px_30px_rgba(0,0,0,0.24)]">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 bg-white/[0.03] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-['IBM_Plex_Mono'] text-[10px] uppercase tracking-[0.18em] text-stone-400">
            {label}
          </span>
          <span className="font-['IBM_Plex_Mono'] text-[10px] text-stone-500">
            {lineCount} lines
          </span>
          {lineCount > 60 && (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="text-[10px] text-sky-300/70 hover:text-sky-300"
            >
              {collapsed ? "Expand" : "Collapse"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1 rounded-lg border border-white/8 bg-white/5 px-2 py-1 text-[10px] text-stone-300 transition hover:bg-white/10"
          >
            <Copy className="h-3 w-3" />
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1 rounded-lg border border-white/8 bg-white/5 px-2 py-1 text-[10px] text-stone-300 transition hover:bg-white/10"
          >
            <Download className="h-3 w-3" />
            Download
          </button>
          <button
            type="button"
            onClick={() => chrome?.openBrowserPreview(buildPreviewDocument(code, language))}
            className="inline-flex items-center gap-1 rounded-lg border border-sky-300/18 bg-sky-300/10 px-2 py-1 text-[10px] text-sky-100 transition hover:bg-sky-300/16"
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
        </div>
      </div>
      <pre
        className={clsx(
          "m-0 overflow-x-auto px-4 py-4 font-['IBM_Plex_Mono'] text-[10px] leading-6 text-stone-200",
          collapsed && "max-h-48 overflow-y-hidden",
        )}
      >
        {highlighted ? (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code>{code}</code>
        )}
      </pre>
      {collapsed && (
        <div className="border-t border-white/5 bg-gradient-to-t from-[#0a0d0f] to-transparent px-4 py-2 text-center">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="text-[10px] text-sky-300/70 hover:text-sky-300"
          >
            Show all {lineCount} lines
          </button>
        </div>
      )}
    </div>
  );
});
