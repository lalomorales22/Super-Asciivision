import { useState } from "react";
import { useTerminalStore } from "../store/terminalStore";

export function BrowserPanel() {
  const browserUrl = useTerminalStore((state) => state.browserUrl);
  const browserDraftUrl = useTerminalStore((state) => state.browserDraftUrl);
  const browserPreviewHtml = useTerminalStore((state) => state.browserPreviewHtml);
  const detectedServerUrl = useTerminalStore((state) => state.detectedServerUrl);
  const setBrowserDraftUrl = useTerminalStore((state) => state.setBrowserDraftUrl);
  const openBrowserUrl = useTerminalStore((state) => state.openBrowserUrl);
  const [reloadKey, setReloadKey] = useState(0);

  const handleOpen = (url?: string) => {
    openBrowserUrl(url);
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/6 px-4 py-4">
        <h2 className="text-[13px] font-semibold text-stone-100">Browser</h2>
        <p className="mt-1 text-[10px] text-stone-500">
          {browserPreviewHtml
            ? "Previewing the current snippet or generated asset."
            : "Load localhost apps started from the footer terminal."}
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={browserDraftUrl}
            onChange={(event) => setBrowserDraftUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleOpen();
              }
            }}
            className="min-w-0 flex-1 rounded-xl border border-white/8 bg-black/35 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none focus:border-sky-300/40"
          />
          <button
            type="button"
            onClick={() => handleOpen()}
            className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-white/10"
          >
            Open
          </button>
        </div>
        {detectedServerUrl ? (
          <button
            type="button"
            onClick={() => handleOpen(detectedServerUrl)}
            className="mt-3 rounded-xl border border-sky-300/18 bg-sky-300/10 px-3 py-2 text-[10px] text-sky-100 transition hover:bg-sky-300/16"
          >
            Use detected server: {detectedServerUrl}
          </button>
        ) : (
          <p className="mt-3 text-[10px] text-stone-500">
            Start a local server in the terminal and this panel will detect localhost URLs.
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 bg-[#0c0d0e]">
        {browserPreviewHtml ? (
          <iframe
            title="Super ASCIIVision browser preview"
            srcDoc={browserPreviewHtml}
            sandbox="allow-scripts allow-same-origin"
            className="h-full w-full border-0 bg-[#050607]"
          />
        ) : (
          <iframe
            key={`${browserUrl}-${reloadKey}`}
            title="Super ASCIIVision browser"
            src={browserUrl}
            className="h-full w-full border-0 bg-[#050607]"
          />
        )}
      </div>
    </div>
  );
}
