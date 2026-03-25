import clsx from "clsx";
import QRCode from "qrcode";
import { Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../store/appStore";
import { EmptyPanel } from "../components/EmptyPanel";
import { ResizeHandle } from "../components/ResizeHandle";
import { clamp, formatTimestamp } from "../utils/formatting";
import type { AppPage } from "../types";

export function HandsPage({ onNavigate }: { onNavigate: (page: AppPage) => void }) {
  const settings = useAppStore((state) => state.settings);
  const handsStatus = useAppStore((state) => state.handsStatus);
  const handsBusy = useAppStore((state) => state.handsBusy);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const refreshHandsStatus = useAppStore((state) => state.refreshHandsStatus);
  const startHandsService = useAppStore((state) => state.startHandsService);
  const stopHandsService = useAppStore((state) => state.stopHandsService);
  const [provider, setProvider] = useState(settings?.handsTunnelProvider ?? "relay");
  const [tunnelExecutable, setTunnelExecutable] = useState(settings?.handsTunnelExecutable ?? "");
  const [relayUrl, setRelayUrl] = useState(settings?.handsRelayUrl ?? "");
  const [savingSetup, setSavingSetup] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [sidebarDragState, setSidebarDragState] = useState<{ startX: number; startValue: number } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>();

  useEffect(() => {
    setProvider(settings?.handsTunnelProvider ?? "relay");
    setTunnelExecutable(settings?.handsTunnelExecutable ?? "");
    setRelayUrl(settings?.handsRelayUrl ?? "");
  }, [settings?.handsTunnelExecutable, settings?.handsTunnelProvider, settings?.handsRelayUrl]);

  useEffect(() => {
    void refreshHandsStatus();
  }, [refreshHandsStatus]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!sidebarDragState) {
      return undefined;
    }

    const onPointerMove = (event: PointerEvent) => {
      setSidebarWidth(sidebarDragState.startValue - (event.clientX - sidebarDragState.startX));
    };
    const onPointerUp = () => setSidebarDragState(null);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [sidebarDragState]);

  const isRunning = handsStatus?.state === "running";
  const publicUrl = handsStatus?.publicUrl ?? "";
  const localUrl = handsStatus?.localUrl ?? "";
  const pairingCode = handsStatus?.pairingCode ?? "";
  const executableChanged = tunnelExecutable !== (settings?.handsTunnelExecutable ?? "");
  const relayChanged = relayUrl !== (settings?.handsRelayUrl ?? "");
  const providerChanged = provider !== (settings?.handsTunnelProvider ?? "relay");
  const activityItems = handsStatus?.activity ?? [];
  const messageItems = activityItems.filter((item) => ["message", "assistant", "connection", "system"].includes(item.kind));
  const taskItems = activityItems.filter((item) => ["image", "video", "audio", "system"].includes(item.kind));
  const activeTaskCount = taskItems.filter((item) => item.status === "pending").length;
  const recentGeneratedAssets = handsStatus?.assets ?? [];
  const clampedSidebarWidth =
    viewportWidth >= 1024 ? clamp(sidebarWidth, 300, Math.max(300, Math.floor(viewportWidth * 0.38))) : 0;
  const capabilities = [
    "Chat from your phone",
    "Generate images, video, and audio remotely",
    "Keep working against your local workspace and media library",
    "Operate the machine through the same shell and agent surface the desktop app has locally",
  ];

  useEffect(() => {
    let cancelled = false;
    if (!publicUrl) {
      setQrCodeUrl(undefined);
      return undefined;
    }

    void QRCode.toDataURL(publicUrl, {
      margin: 1,
      width: 320,
      color: {
        dark: "#f4f5f4",
        light: "#0000",
      },
    })
      .then((value) => {
        if (!cancelled) {
          setQrCodeUrl(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrCodeUrl(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [publicUrl]);

  const saveTunnelSetup = async () => {
    setSavingSetup(true);
    try {
      await saveSettings({
        handsTunnelProvider: provider,
        handsTunnelExecutable: tunnelExecutable.trim(),
        handsRelayUrl: relayUrl.trim(),
      });
      await refreshHandsStatus();
    } finally {
      setSavingSetup(false);
    }
  };

  const copyValue = async (value?: string | null) => {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can fail in some contexts; the raw value stays visible.
    }
  };

  return (
    <section
      className="grid h-full min-h-0 overflow-hidden p-3"
      style={{
        gridTemplateColumns:
          viewportWidth >= 1024 ? `minmax(0,1fr) 8px ${clampedSidebarWidth}px` : "minmax(0,1fr)",
      }}
    >
      <div className="min-h-0 overflow-y-auto pr-0 lg:pr-3">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(87,180,140,0.14),rgba(12,14,16,0.98)_42%),linear-gradient(180deg,rgba(15,17,19,0.98),rgba(7,8,10,0.98))] shadow-[0_28px_90px_rgba(0,0,0,0.38)]">
            <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
              <div>
                <p className="text-[10px] uppercase tracking-[0.4em] text-[#84a09b]">Hands Agent Console</p>
                <h2 className="mt-3 max-w-3xl text-[27px] font-semibold leading-tight text-stone-100">
                  Your off-site operator page for Super ASCIIVision.
                </h2>
                <p className="mt-3 max-w-3xl text-[12px] leading-6 text-stone-300">
                  Hands is the remote agent surface. When you leave the machine, this page keeps Super ASCIIVision reachable
                  from your phone so you can continue using chat, imaging, voice, audio, local files, and the same
                  machine-level controls that make the desktop shell useful.
                </p>
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {capabilities.map((capability) => (
                    <div
                      key={capability}
                      className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3 text-[11px] leading-5 text-stone-300"
                    >
                      {capability}
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void startHandsService()}
                    disabled={handsBusy || isRunning}
                    className="rounded-2xl border border-emerald-300/18 bg-emerald-300/12 px-4 py-2 text-[11px] font-semibold text-emerald-50 transition hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {handsBusy && !isRunning ? "Starting..." : isRunning ? "Hands live" : "Start secure link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void stopHandsService()}
                    disabled={handsBusy || !isRunning}
                    className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2 text-[11px] font-semibold text-stone-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {handsBusy && isRunning ? "Stopping..." : "Stop Hands"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void refreshHandsStatus()}
                    className="rounded-2xl border border-white/8 bg-transparent px-4 py-2 text-[11px] text-stone-300 transition hover:border-white/12 hover:bg-white/5"
                  >
                    Refresh status
                  </button>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="rounded-[24px] border border-emerald-300/14 bg-emerald-300/8 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.28em] text-emerald-100/80">Link State</p>
                      <p className="mt-2 text-[20px] font-semibold text-stone-100">
                        {publicUrl ? "Secure remote URL live" : isRunning ? "Local bridge online" : "Hands offline"}
                      </p>
                    </div>
                    <div
                      className={clsx(
                        "h-3.5 w-3.5 rounded-full",
                        publicUrl
                          ? "bg-emerald-300 shadow-[0_0_24px_rgba(110,231,183,0.6)]"
                          : isRunning
                            ? "bg-amber-300 shadow-[0_0_24px_rgba(252,211,77,0.35)]"
                            : "bg-stone-600",
                      )}
                    />
                  </div>
                  <p className="mt-3 text-[11px] leading-5 text-stone-200/90">
                    {handsStatus?.tunnelStatus ?? "Hands bridge is offline."}
                  </p>
                  {handsStatus?.lastError ? (
                    <p className="mt-3 rounded-2xl border border-amber-200/18 bg-amber-300/10 px-3 py-2 text-[10px] text-amber-100">
                      {handsStatus.lastError}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[22px] border border-white/8 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Paired Phones</p>
                    <p className="mt-3 text-[28px] font-semibold text-stone-100">{handsStatus?.connections.length ?? 0}</p>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Active Tasks</p>
                    <p className="mt-3 text-[28px] font-semibold text-stone-100">{activeTaskCount}</p>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Generated Files</p>
                    <p className="mt-3 text-[28px] font-semibold text-stone-100">{recentGeneratedAssets.length}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.12fr)_minmax(340px,0.88fr)]">
            <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(12,14,16,0.98),rgba(7,8,10,0.98))] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.32em] text-[#84a09b]">Secure Entry</p>
                  <h3 className="mt-2 text-[16px] font-semibold text-stone-100">Scan or open the mobile link</h3>
                </div>
                {publicUrl ? (
                  <button
                    type="button"
                    onClick={() => void copyValue(publicUrl)}
                    className="rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-[10px] text-stone-200 transition hover:bg-white/10"
                  >
                    Copy link
                  </button>
                ) : null}
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="space-y-3">
                  <div className="rounded-[20px] border border-emerald-300/14 bg-emerald-300/8 p-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-emerald-100/80">Public URL</p>
                    <p className="mt-2 break-all font-['IBM_Plex_Mono'] text-[11px] text-emerald-50">
                      {publicUrl || "Waiting for secure tunnel startup..."}
                    </p>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Pairing Code</p>
                        <p className="mt-2 font-['IBM_Plex_Mono'] text-[18px] tracking-[0.28em] text-stone-100">
                          {pairingCode || "--------"}
                        </p>
                      </div>
                      {pairingCode ? (
                        <button
                          type="button"
                          onClick={() => void copyValue(pairingCode)}
                          className="rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-[10px] text-stone-200 transition hover:bg-white/10"
                        >
                          Copy code
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-stone-400">
                      The QR code or URL only gets the phone to the page. The pairing code is the second gate that
                      grants the session.
                    </p>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Local Bridge</p>
                    <p className="mt-2 break-all font-['IBM_Plex_Mono'] text-[11px] text-stone-200">{localUrl || "Not running"}</p>
                  </div>
                </div>

                <div className="flex flex-col rounded-[22px] border border-white/8 bg-black/20 p-3">
                  <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">QR Access</p>
                  <div className="mt-3 flex flex-1 items-center justify-center rounded-[20px] border border-dashed border-white/8 bg-white/[0.03] p-3">
                    {qrCodeUrl ? (
                      <img src={qrCodeUrl} alt="Hands secure link QR code" className="h-full max-h-[190px] w-full rounded-[16px] object-contain" />
                    ) : (
                      <p className="text-center text-[11px] leading-5 text-stone-500">
                        Start Hands and wait for the secure URL. The QR code will appear here automatically.
                      </p>
                    )}
                  </div>
                  <p className="mt-3 text-[10px] leading-5 text-stone-500">
                    Scan this from your phone, enter the pairing code, then the session can continue while you are away.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(12,14,16,0.98),rgba(7,8,10,0.98))] p-4">
              <p className="text-[10px] uppercase tracking-[0.32em] text-[#84a09b]">Agent Identity</p>
              <h3 className="mt-2 text-[16px] font-semibold text-stone-100">Hands is the page for off-site machine work</h3>
              <div className="mt-4 space-y-3 text-[11px] leading-6 text-stone-300">
                <p>
                  Treat Hands as the remote operator surface for the whole app, not a separate feature silo. From the
                  phone, it should be obvious that Hands can reach chat, imaging, voice, audio, files, generated media,
                  and local command execution.
                </p>
                <p>
                  It is the closest thing in this app to an OpenClaw or Claude Code style machine agent: a remote page
                  for staying attached to the desktop while you are away.
                </p>
                <div className="rounded-[20px] border border-white/8 bg-black/20 p-3">
                  <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Integrated surfaces</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["Chat", "Image & Video", "Voice & Audio", "Media", "Workspace", "Shell", "Files"].map((surface) => (
                      <span
                        key={surface}
                        className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[10px] text-stone-300"
                      >
                        {surface}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.92fr)]">
            <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(11,12,14,0.98),rgba(7,8,10,0.98))] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.32em] text-[#84a09b]">Remote Activity</p>
                  <h3 className="mt-2 text-[16px] font-semibold text-stone-100">Phone conversations and agent events</h3>
                </div>
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 font-['IBM_Plex_Mono'] text-[10px] text-stone-400">
                  {messageItems.length} events
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {messageItems.length ? (
                  messageItems.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 transition hover:bg-white/[0.05]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={clsx(
                              "rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.22em]",
                              item.kind === "assistant"
                                ? "bg-sky-300/12 text-sky-100"
                                : item.kind === "message"
                                  ? "bg-emerald-300/12 text-emerald-100"
                                  : "bg-white/[0.06] text-stone-300",
                            )}
                          >
                            {item.kind}
                          </span>
                          <p className="text-[12px] font-semibold text-stone-100">{item.title}</p>
                        </div>
                        <p className="text-[10px] text-stone-500">{formatTimestamp(item.createdAt)}</p>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-stone-300">{item.body}</p>
                    </article>
                  ))
                ) : (
                  <EmptyPanel
                    eyebrow="Hands"
                    title="Waiting for the first remote event."
                    body="Once a phone pairs, this feed will show mobile prompts, AI replies, tunnel events, and remote work traces."
                  />
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(11,12,14,0.98),rgba(7,8,10,0.98))] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.32em] text-[#84a09b]">Hands Workspace</p>
                  <h3 className="mt-2 text-[16px] font-semibold text-stone-100">Generated files and machine traces</h3>
                </div>
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 font-['IBM_Plex_Mono'] text-[10px] text-stone-400">
                  {recentGeneratedAssets.length} files
                </span>
              </div>
              <p className="mt-2 break-all font-['IBM_Plex_Mono'] text-[10px] text-stone-500">
                {handsStatus?.workspaceDir ?? "hands-workspace"}
              </p>
              <div className="mt-4 space-y-2">
                {recentGeneratedAssets.length ? (
                  recentGeneratedAssets.map((asset) => (
                    <article key={asset.id} className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[12px] font-semibold text-stone-100">{asset.fileName}</p>
                          <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-stone-500">{asset.kind}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {asset.kind !== "audio" ? (
                            <button
                              type="button"
                              onClick={() => onNavigate("imagine")}
                              className="rounded-xl border border-sky-300/18 bg-sky-300/10 px-3 py-1.5 text-[10px] text-sky-100 transition hover:bg-sky-300/16"
                            >
                              Open in Image & Video
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void copyValue(asset.filePath)}
                            className="rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-[10px] text-stone-200 transition hover:bg-white/10"
                          >
                            Copy path
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-stone-300">{asset.prompt}</p>
                      <p className="mt-2 break-all font-['IBM_Plex_Mono'] text-[10px] text-stone-500">{asset.filePath}</p>
                    </article>
                  ))
                ) : (
                  <p className="rounded-[18px] border border-dashed border-white/8 px-3 py-4 text-[11px] leading-5 text-stone-500">
                    Remote image, video, and audio outputs will land here with their on-disk locations.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(12,14,16,0.98),rgba(7,8,10,0.98))] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.32em] text-[#84a09b]">Tunnel Setup</p>
                <h3 className="mt-2 text-[16px] font-semibold text-stone-100">Transport provider and relay setup</h3>
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.75fr)]">
              <div>
                <label className="block">
                  <span className="mb-2 block text-[10px] uppercase tracking-[0.28em] text-stone-500">Provider</span>
                  <select
                    value={provider}
                    onChange={(event) => setProvider(event.target.value)}
                    className="w-full rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2 text-[11px] text-stone-100 outline-none transition focus:border-emerald-300/30"
                  >
                    <option value="relay">Hands Relay</option>
                    <option value="cloudflare">Cloudflare tunnel</option>
                  </select>
                </label>
                <label className="mt-4 block">
                  <span className="mb-2 block text-[10px] uppercase tracking-[0.28em] text-stone-500">Your Relay URL</span>
                  <input
                    value={relayUrl}
                    onChange={(event) => setRelayUrl(event.target.value)}
                    placeholder="https://your-hands-relay.onrender.com"
                    className="w-full rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2 font-['IBM_Plex_Mono'] text-[11px] text-stone-100 outline-none transition focus:border-emerald-300/30"
                  />
                  <span className="mt-1.5 block text-[10px] leading-[1.5] text-amber-300/70">
                    You must deploy your own relay. All Hands traffic (messages, generated files) passes through this server.
                    Never use someone else's relay URL — they could see your data. Deploy the hands-relay folder to Render
                    (free tier) or any HTTPS host you control. See the README for setup steps.
                  </span>
                </label>
                <label className="block">
                  <span className="mb-2 block text-[10px] uppercase tracking-[0.28em] text-stone-500">Tunnel Executable</span>
                  <input
                    value={tunnelExecutable}
                    onChange={(event) => setTunnelExecutable(event.target.value)}
                    placeholder="cloudflared"
                    className="w-full rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2 font-['IBM_Plex_Mono'] text-[11px] text-stone-100 outline-none transition focus:border-emerald-300/30"
                  />
                </label>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void saveTunnelSetup()}
                    disabled={savingSetup || (!executableChanged && !relayChanged && !providerChanged)}
                    className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2 text-[11px] font-semibold text-stone-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {savingSetup ? "Saving..." : "Save setup"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProvider(settings?.handsTunnelProvider ?? "relay");
                      setTunnelExecutable(settings?.handsTunnelExecutable ?? "");
                      setRelayUrl(settings?.handsRelayUrl ?? "");
                    }}
                    disabled={savingSetup || (!executableChanged && !relayChanged && !providerChanged)}
                    className="rounded-2xl border border-white/8 bg-transparent px-4 py-2 text-[11px] text-stone-400 transition hover:border-white/14 hover:text-stone-100 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Reset
                  </button>
                </div>
              </div>
              <div className="rounded-[20px] border border-white/8 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">Short-term recommendation</p>
                <ol className="mt-3 space-y-2 text-[11px] leading-5 text-stone-400">
                  <li>1. Use `Hands Relay` when you control a deployed relay host and want your own public URL layer.</li>
                  <li>2. Use `Cloudflare tunnel` only as a fallback if you still want the binary-based route.</li>
                  <li>3. QR plus pairing code remains the primary phone onboarding flow for both providers.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>

      {viewportWidth >= 1024 ? (
        <>
          <ResizeHandle
            orientation="vertical"
            onPointerDown={(event) =>
              setSidebarDragState({
                startX: event.clientX,
                startValue: clampedSidebarWidth,
              })
            }
          />
          <aside className="min-h-0 overflow-y-auto">
            <div className="space-y-3 rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,11,13,0.99),rgba(7,8,10,0.98))] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
              <div>
                <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">Task Monitor</p>
                <h3 className="mt-2 text-[17px] font-semibold text-stone-100">Live agents and jobs</h3>
                <p className="mt-2 text-[11px] leading-5 text-stone-400">
                  This rail is the operations view for Hands: queued media work, tunnel status, paired devices, and the
                  most recent machine-side events.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">Running Now</p>
                  <p className="mt-2 text-[24px] font-semibold text-stone-100">{activeTaskCount}</p>
                </div>
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">Last Activity</p>
                  <p className="mt-2 text-[11px] leading-5 text-stone-300">{formatTimestamp(handsStatus?.lastActivityAt)}</p>
                </div>
              </div>

              <div className="rounded-[20px] border border-white/8 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">Recent Tasks</p>
                  <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 font-['IBM_Plex_Mono'] text-[9px] text-stone-400">
                    {taskItems.length}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {taskItems.length ? (
                    taskItems.map((item) => (
                      <div key={item.id} className="rounded-[16px] border border-white/8 bg-white/[0.03] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={clsx(
                              "rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.22em]",
                              item.status === "pending"
                                ? "bg-amber-300/12 text-amber-100"
                                : item.status === "error"
                                  ? "bg-rose-300/12 text-rose-100"
                                  : "bg-emerald-300/12 text-emerald-100",
                            )}
                          >
                            {item.status}
                          </span>
                          <p className="text-[10px] text-stone-500">{formatTimestamp(item.createdAt)}</p>
                        </div>
                        <p className="mt-2 text-[11px] font-semibold text-stone-100">{item.title}</p>
                        <p className="mt-1 text-[10px] leading-5 text-stone-400">{item.body}</p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-[16px] border border-dashed border-white/8 px-3 py-4 text-[11px] leading-5 text-stone-500">
                      No remote tasks yet. Start Hands and send work from the phone.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-[20px] border border-white/8 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">Connected Phones</p>
                <div className="mt-3 space-y-2">
                  {handsStatus?.connections.length ? (
                    handsStatus.connections.map((connection) => (
                      <div key={connection.id} className="rounded-[16px] border border-white/8 bg-white/[0.03] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[12px] font-semibold text-stone-100">{connection.label}</p>
                          <Wifi className="h-4 w-4 text-emerald-200" />
                        </div>
                        <p className="mt-2 text-[10px] text-stone-500">Connected {formatTimestamp(connection.connectedAt)}</p>
                        <p className="mt-1 text-[10px] text-stone-500">Last seen {formatTimestamp(connection.lastSeenAt)}</p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-[16px] border border-dashed border-white/8 px-3 py-4 text-[11px] leading-5 text-stone-500">
                      No paired sessions yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </>
      ) : null}
    </section>
  );
}
