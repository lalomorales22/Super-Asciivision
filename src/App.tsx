import hljs from "highlight.js/lib/core";
import hljsBash from "highlight.js/lib/languages/bash";
import hljsGo from "highlight.js/lib/languages/go";
import hljsJava from "highlight.js/lib/languages/java";
import hljsJs from "highlight.js/lib/languages/javascript";
import hljsJson from "highlight.js/lib/languages/json";
import hljsMarkdown from "highlight.js/lib/languages/markdown";
import hljsPython from "highlight.js/lib/languages/python";
import hljsRust from "highlight.js/lib/languages/rust";
import hljsSql from "highlight.js/lib/languages/sql";
import hljsTs from "highlight.js/lib/languages/typescript";
import hljsXml from "highlight.js/lib/languages/xml";
import hljsYaml from "highlight.js/lib/languages/yaml";
import { useEffect } from "react";

import { useAppStore } from "./store/appStore";
import { GrokShell } from "./components/layout/GrokShell";

// Register highlight.js languages
hljs.registerLanguage("bash", hljsBash);
hljs.registerLanguage("sh", hljsBash);
hljs.registerLanguage("shell", hljsBash);
hljs.registerLanguage("go", hljsGo);
hljs.registerLanguage("java", hljsJava);
hljs.registerLanguage("javascript", hljsJs);
hljs.registerLanguage("js", hljsJs);
hljs.registerLanguage("json", hljsJson);
hljs.registerLanguage("markdown", hljsMarkdown);
hljs.registerLanguage("md", hljsMarkdown);
hljs.registerLanguage("python", hljsPython);
hljs.registerLanguage("py", hljsPython);
hljs.registerLanguage("rust", hljsRust);
hljs.registerLanguage("rs", hljsRust);
hljs.registerLanguage("sql", hljsSql);
hljs.registerLanguage("typescript", hljsTs);
hljs.registerLanguage("ts", hljsTs);
hljs.registerLanguage("tsx", hljsTs);
hljs.registerLanguage("xml", hljsXml);
hljs.registerLanguage("html", hljsXml);
hljs.registerLanguage("yaml", hljsYaml);
hljs.registerLanguage("yml", hljsYaml);

function App() {
  const initialize = useAppStore((state) => state.initialize);
  const booting = useAppStore((state) => state.booting);
  const error = useAppStore((state) => state.error);
  const clearError = useAppStore((state) => state.clearError);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const suppress = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", suppress);
    return () => document.removeEventListener("contextmenu", suppress);
  }, []);

  useEffect(() => {
    if (!error) {
      return undefined;
    }
    const timer = window.setTimeout(() => clearError(), 5000);
    return () => window.clearTimeout(timer);
  }, [clearError, error]);

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent px-4 py-6 font-['Manrope'] text-stone-200">
        <div className="w-full max-w-3xl rounded-[30px] border border-white/8 bg-[#070809] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.62)]">
          <p className="text-[10px] uppercase tracking-[0.42em] text-[#7a9a96]">Super ASCIIVision</p>
          <h1 className="mt-4 text-[26px] font-semibold text-stone-100">Loading…</h1>
          <p className="mt-2 text-[12px] text-stone-500">
            Restoring chats, gallery, terminal session, and workspace state.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent p-1 font-['Manrope'] text-[11px] text-stone-100">
      <GrokShell />
      {error ? (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto w-fit rounded-full border border-rose-300/18 bg-rose-500/12 px-3 py-1.5 text-[11px] text-rose-100 shadow-lg backdrop-blur-xl">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export default App;
