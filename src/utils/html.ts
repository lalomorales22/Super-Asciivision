import type { MediaAsset } from "../types";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildPreviewDocument(code: string, language?: string) {
  const normalized = (language ?? "").toLowerCase();
  if (["html", "htm"].includes(normalized)) {
    return code;
  }
  if (normalized === "css") {
    return `<!doctype html><html><head><style>${code}</style></head><body><main class="preview-root">CSS preview</main></body></html>`;
  }
  if (["javascript", "js", "mjs"].includes(normalized)) {
    return `<!doctype html><html><body><div id="app"></div><script type="module">${code}</script></body></html>`;
  }
  return `<!doctype html><html><body style="margin:0;background:#070809;color:#f5f5f4;font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;"><pre style="margin:0;padding:18px;white-space:pre-wrap;">${escapeHtml(code)}</pre></body></html>`;
}

export function buildAssetPreviewDocument(asset: MediaAsset, src: string) {
  const shell = "margin:0;min-height:100vh;background:#050607;color:#f5f5f4;color-scheme:dark;";
  const scrollbar =
    "html{scrollbar-color:rgba(132,160,155,0.48) #050607;}::-webkit-scrollbar{width:12px;height:12px;background:#050607;}::-webkit-scrollbar-thumb{border-radius:999px;background:linear-gradient(180deg,rgba(132,160,155,0.55),rgba(125,211,252,0.4));border:2px solid #050607;}::-webkit-scrollbar-corner{background:#050607;}";
  const fitStyle =
    "display:block;width:auto;height:auto;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);object-fit:contain;margin:auto;";
  if (asset.kind === "image") {
    return `<!doctype html><html><head><style>${scrollbar}</style></head><body style="${shell}display:grid;place-items:center;padding:12px;overflow:auto;"><img src="${src}" style="${fitStyle}" /></body></html>`;
  }
  if (asset.kind === "video") {
    return `<!doctype html><html><head><style>${scrollbar}</style></head><body style="${shell}display:grid;place-items:center;padding:12px;overflow:auto;"><video src="${src}" controls autoplay style="${fitStyle}" playsinline></video></body></html>`;
  }
  return `<!doctype html><html><head><style>${scrollbar}</style></head><body style="${shell}display:grid;place-items:center;font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;"><audio src="${src}" controls autoplay></audio></body></html>`;
}
