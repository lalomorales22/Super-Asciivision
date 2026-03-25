import { useAppStore } from "../store/appStore";

export function BrowserPanel() {
  const browserUrl = useAppStore((state) => state.browserUrl);
  const browserDraftUrl = useAppStore((state) => state.browserDraftUrl);
  const browserPreviewHtml = useAppStore((state) => state.browserPreviewHtml);
  const detectedServerUrl = useAppStore((state) => state.detectedServerUrl);
  const setBrowserDraftUrl = useAppStore((state) => state.setBrowserDraftUrl);
  const openBrowserUrl = useAppStore((state) => state.openBrowserUrl);

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
                openBrowserUrl();
              }
            }}
            className="min-w-0 flex-1 rounded-xl border border-white/8 bg-black/35 px-3 py-2 font-['IBM_Plex_Mono'] text-[10px] text-stone-100 outline-none focus:border-sky-300/40"
          />
          <button
            type="button"
            onClick={() => openBrowserUrl()}
            className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[11px] text-stone-200 transition hover:bg-white/10"
          >
            Open
          </button>
        </div>
        {detectedServerUrl ? (
          <button
            type="button"
            onClick={() => openBrowserUrl(detectedServerUrl)}
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
          <iframe title="Super ASCIIVision browser" src={browserUrl} className="h-full w-full border-0 bg-[#050607]" />
        )}
      </div>
    </div>
  );
}
