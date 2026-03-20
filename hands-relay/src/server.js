import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT || 8787);
const configuredPublicBaseUrl = process.env.HANDS_PUBLIC_BASE_URL?.trim();

const machines = new Map();

function getMachine(machineId) {
  let machine = machines.get(machineId);
  if (!machine) {
    machine = {
      machineId,
      desktopToken: undefined,
      machineLabel: "Super ASCIIVision",
      socket: undefined,
      snapshot: undefined,
      sessions: new Map(),
      pendingRequests: new Map(),
      lastSeenAt: undefined,
    };
    machines.set(machineId, machine);
  }
  return machine;
}

function getPublicBaseUrl(request) {
  if (configuredPublicBaseUrl) {
    return configuredPublicBaseUrl.replace(/\/+$/, "");
  }
  const protocol = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers["x-forwarded-host"] || request.headers.host || `127.0.0.1:${port}`;
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

function getPublicBaseUrlForWebSocketUpgrade(request) {
  if (configuredPublicBaseUrl) {
    return configuredPublicBaseUrl.replace(/\/+$/, "");
  }
  const host = request.headers["x-forwarded-host"] || request.headers.host || `127.0.0.1:${port}`;
  const isLocal = /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(host));
  return `${isLocal ? "http" : "https"}://${host}`.replace(/\/+$/, "");
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 1_000_000) {
        reject(new Error("request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function parseCookies(request) {
  const header = request.headers.cookie;
  if (!header) {
    return {};
  }
  return Object.fromEntries(
    header.split(";").map((entry) => {
      const [key, ...rest] = entry.trim().split("=");
      return [key, decodeURIComponent(rest.join("="))];
    }),
  );
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}

function machineCookieName(machineId) {
  return `hands_relay_session_${machineId}`;
}

function requireMachine(machineId) {
  const machine = machines.get(machineId);
  if (!machine || !machine.socket || machine.socket.readyState !== machine.socket.OPEN) {
    throw new Error("desktop is offline");
  }
  return machine;
}

function requireSession(request, machineId) {
  const machine = requireMachine(machineId);
  const cookies = parseCookies(request);
  const sessionId = cookies[machineCookieName(machineId)];
  if (!sessionId) {
    throw new Error("pair this phone first");
  }
  const session = machine.sessions.get(sessionId);
  if (!session) {
    throw new Error("session expired");
  }
  session.lastSeenAt = new Date().toISOString();
  return { machine, session };
}

function normalizeSnapshot(machine, request) {
  const snapshot = machine.snapshot
    ? JSON.parse(JSON.stringify(machine.snapshot))
    : {
        state: "stopped",
        connections: [],
        activity: [],
        assets: [],
        workspaceDir: "hands-workspace",
        tunnelStatus: "Hands relay is waiting for the desktop connection.",
      };
  snapshot.publicUrl = `${getPublicBaseUrl(request)}/m/${machine.machineId}`;
  snapshot.tunnelProvider = "relay";
  snapshot.tunnelStatus =
    machine.socket && machine.socket.readyState === machine.socket.OPEN
      ? "Hands relay is connected."
      : "Hands relay is waiting for the desktop connection.";
  snapshot.assets = (snapshot.assets || []).map((asset) => ({
    ...asset,
    downloadUrl: `/api/assets/${machine.machineId}/${asset.id}`,
  }));
  return snapshot;
}

function forwardRequest(machine, action, payload) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      machine.pendingRequests.delete(requestId);
      reject(new Error(`desktop request timed out for action ${action}`));
    }, 60_000);

    machine.pendingRequests.set(requestId, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });

    machine.socket.send(
      JSON.stringify({
        type: "relay.request",
        requestId,
        action,
        payload,
      }),
    );
  });
}

function mobileHtml(machineId) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Hands Relay</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #040506;
        --panel: rgba(11, 13, 15, 0.96);
        --muted: #7d928d;
        --text: #f4f7f5;
        --accent: #89f0bb;
        --accent-strong: #5dd497;
        --line: rgba(255,255,255,0.08);
        --warn: #fbbf24;
        --error: #fb7185;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
        background:
          radial-gradient(circle at top, rgba(93,212,151,0.16), transparent 38%),
          radial-gradient(circle at bottom, rgba(30,41,59,0.18), transparent 42%),
          linear-gradient(180deg, #090b0d 0%, #030405 76%);
        color: var(--text);
      }
      main { padding: 18px 16px 32px; max-width: 760px; margin: 0 auto; display: grid; gap: 14px; }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 22px;
        padding: 16px;
        backdrop-filter: blur(20px);
        box-shadow: 0 18px 70px rgba(0,0,0,0.28);
      }
      .eyebrow { font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--muted); }
      h1, h2, p { margin: 0; }
      input, textarea, select, button {
        width: 100%;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.035);
        color: var(--text);
        padding: 12px 14px;
        font: inherit;
      }
      textarea { min-height: 110px; resize: vertical; }
      button {
        background: linear-gradient(180deg, rgba(93,212,151,0.26), rgba(64,150,111,0.18));
        border-color: rgba(93,212,151,0.3);
        font-weight: 600;
      }
      .secondary { background: rgba(255,255,255,0.04); border-color: var(--line); }
      .stack { display: grid; gap: 12px; }
      .tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
      .chips { display: flex; flex-wrap: wrap; gap: 8px; }
      .chip { border: 1px solid var(--line); border-radius: 999px; padding: 7px 11px; font-size: 12px; color: #d7e6df; background: rgba(255,255,255,0.02); }
      .item { border: 1px solid var(--line); border-radius: 16px; padding: 12px; background: rgba(255,255,255,0.025); }
      .item small { display: block; margin-bottom: 6px; color: var(--muted); }
      .hidden { display: none !important; }
      .warning { color: var(--warn); }
      .error { color: var(--error); }
      .hero {
        padding: 18px;
        border-radius: 24px;
        border: 1px solid rgba(255,255,255,0.08);
        background:
          radial-gradient(circle at top left, rgba(93,212,151,0.18), transparent 34%),
          linear-gradient(180deg, rgba(12,15,17,0.98), rgba(6,7,8,0.98));
      }
      .status-card {
        border-radius: 18px;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.025);
        padding: 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero stack">
        <div class="eyebrow">Hands Relay</div>
        <h1 style="font-size:28px;line-height:1;">Remote Super ASCIIVision</h1>
        <p style="font-size:14px;line-height:1.5;color:#d4dfda;">
          This page connects to the desktop through Hands Relay. Pair once, then keep chatting and generating while away from the machine.
        </p>
      </section>

      <section id="pair-panel" class="panel stack">
        <div>
          <h2>Pair this phone</h2>
          <p style="margin-top:6px;color:var(--muted);font-size:13px;">Enter the pairing code from the desktop Hands page.</p>
        </div>
        <input id="pair-code" placeholder="PAIR CODE" autocomplete="one-time-code" />
        <button id="pair-button" type="button">Pair phone</button>
        <p id="pair-error" class="warning hidden"></p>
      </section>

      <section id="app-panel" class="hidden stack">
        <div class="panel stack">
          <div class="eyebrow">Status</div>
          <div id="status-chips" class="chips"></div>
          <p id="status-text" style="font-size:13px;color:var(--muted);"></p>
        </div>

        <div class="panel stack">
          <div class="tabs">
            <button class="tab active" data-tab="chat" type="button">Chat</button>
            <button class="tab secondary" data-tab="image" type="button">Image</button>
            <button class="tab secondary" data-tab="video" type="button">Video</button>
            <button class="tab secondary" data-tab="audio" type="button">Audio</button>
          </div>
          <textarea id="prompt" placeholder="Send a message or describe what to generate."></textarea>
          <div id="extra-fields" class="stack"></div>
          <button id="submit" type="button">Send</button>
        </div>

        <div class="panel stack">
          <div class="eyebrow">Activity</div>
          <div id="messages" class="stack"></div>
        </div>

        <div class="panel stack">
          <div class="eyebrow">Generated Files</div>
          <div id="assets" class="stack"></div>
        </div>
      </section>
    </main>

    <script>
      const machineId = ${JSON.stringify(machineId)};
      const apiBase = "/api";
      const state = { mode: "chat", bootstrap: null, lastError: "", paired: false };
      const pairPanel = document.getElementById("pair-panel");
      const appPanel = document.getElementById("app-panel");
      const pairError = document.getElementById("pair-error");
      const promptInput = document.getElementById("prompt");
      const submitButton = document.getElementById("submit");
      const statusChips = document.getElementById("status-chips");
      const statusText = document.getElementById("status-text");
      const messagesEl = document.getElementById("messages");
      const assetsEl = document.getElementById("assets");
      const extraFields = document.getElementById("extra-fields");

      async function request(path, options = {}) {
        const response = await fetch(path, {
          credentials: "include",
          headers: { "Content-Type": "application/json", ...(options.headers || {}) },
          ...options,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const error = new Error(body.error || \`Request failed: \${response.status}\`);
          error.status = response.status;
          throw error;
        }
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          return response.json();
        }
        return response;
      }

      function renderFields() {
        if (state.mode === "image") {
          extraFields.innerHTML = '<select id="aspect"><option value="1:1">1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option></select><select id="resolution"><option value="1k">1k</option><option value="2k">2k</option></select>';
          return;
        }
        if (state.mode === "audio") {
          extraFields.innerHTML = '<select id="voice"><option value="eve">Eve</option><option value="ara">Ara</option><option value="rex">Rex</option><option value="sal">Sal</option><option value="leo">Leo</option></select><select id="format"><option value="mp3">MP3</option><option value="wav">WAV</option></select>';
          return;
        }
        extraFields.innerHTML = "";
      }

      function render() {
        const status = state.bootstrap?.status;
        if (!status) return;
        pairPanel.classList.add("hidden");
        appPanel.classList.remove("hidden");
        statusChips.innerHTML = "";
        [
          status.publicUrl ? "Secure link live" : "Waiting for link",
          \`\${status.connections.length} phone\${status.connections.length === 1 ? "" : "s"}\`,
          status.tunnelProvider || "relay",
        ].forEach((label) => {
          const chip = document.createElement("div");
          chip.className = "chip";
          chip.textContent = label;
          statusChips.appendChild(chip);
        });
        statusText.textContent = state.lastError || status.tunnelStatus;
        statusText.className = state.lastError ? "error" : "";

        messagesEl.innerHTML = "";
        (status.activity || []).slice(0, 12).forEach((item) => {
          const node = document.createElement("div");
          node.className = "item";
          node.innerHTML = \`<small>\${item.kind.toUpperCase()} · \${new Date(item.createdAt).toLocaleString()}</small><strong>\${item.title}</strong><div style="margin-top:6px;white-space:pre-wrap;">\${item.body}</div>\`;
          messagesEl.appendChild(node);
        });
        if (!messagesEl.childElementCount) {
          messagesEl.innerHTML = '<div class="item"><small>Waiting</small><strong>No activity yet.</strong></div>';
        }

        assetsEl.innerHTML = "";
        (status.assets || []).slice(0, 8).forEach((asset) => {
          const node = document.createElement("div");
          node.className = "item";
          node.innerHTML = \`<small>\${asset.kind.toUpperCase()} · \${new Date(asset.createdAt).toLocaleString()}</small><strong>\${asset.fileName}</strong><div style="margin-top:6px;">\${asset.prompt}</div><div style="margin-top:8px;"><a href="\${asset.downloadUrl}" target="_blank" rel="noreferrer" style="color:#7fe7b5;">Open file</a></div>\`;
          assetsEl.appendChild(node);
        });
        if (!assetsEl.childElementCount) {
          assetsEl.innerHTML = '<div class="item"><small>Workspace</small><strong>No generated files yet.</strong></div>';
        }
      }

      async function bootstrap() {
        try {
          state.bootstrap = await request(\`\${apiBase}/bootstrap/\${machineId}\`, { method: "GET" });
          state.lastError = "";
          state.paired = true;
          render();
        } catch (error) {
          if (error.status === 401 || !state.paired) {
            pairPanel.classList.remove("hidden");
            appPanel.classList.add("hidden");
            if (error.status !== 401) {
              pairError.textContent = error.message;
              pairError.classList.remove("hidden");
            }
            return;
          }
          state.lastError = error.message;
          pairPanel.classList.add("hidden");
          appPanel.classList.remove("hidden");
          render();
        }
      }

      document.getElementById("pair-button").addEventListener("click", async () => {
        pairError.classList.add("hidden");
        try {
          await request(\`\${apiBase}/pair/\${machineId}\`, {
            method: "POST",
            body: JSON.stringify({ code: document.getElementById("pair-code").value }),
          });
          state.paired = true;
          await bootstrap();
        } catch (error) {
          pairError.textContent = error.message;
          pairError.classList.remove("hidden");
        }
      });

      document.querySelectorAll(".tab").forEach((button) => {
        button.addEventListener("click", () => {
          state.mode = button.dataset.tab;
          document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
          document.querySelectorAll(".tab").forEach((tab) => tab.classList.add("secondary"));
          button.classList.add("active");
          button.classList.remove("secondary");
          renderFields();
        });
      });

      submitButton.addEventListener("click", async () => {
        const prompt = promptInput.value.trim();
        if (!prompt) return;
        submitButton.disabled = true;
        try {
          if (state.mode === "chat") {
            await request(\`\${apiBase}/chat/\${machineId}\`, { method: "POST", body: JSON.stringify({ text: prompt }) });
          } else if (state.mode === "image") {
            await request(\`\${apiBase}/generate/image/\${machineId}\`, {
              method: "POST",
              body: JSON.stringify({
                prompt,
                aspectRatio: document.getElementById("aspect")?.value,
                resolution: document.getElementById("resolution")?.value,
              }),
            });
          } else if (state.mode === "video") {
            await request(\`\${apiBase}/generate/video/\${machineId}\`, { method: "POST", body: JSON.stringify({ prompt }) });
          } else if (state.mode === "audio") {
            await request(\`\${apiBase}/generate/audio/\${machineId}\`, {
              method: "POST",
              body: JSON.stringify({
                prompt,
                voice: document.getElementById("voice")?.value,
                responseFormat: document.getElementById("format")?.value,
              }),
            });
          }
          promptInput.value = "";
          await bootstrap();
        } catch (error) {
          state.lastError = error.message;
          render();
        } finally {
          submitButton.disabled = false;
        }
      });

      renderFields();
      bootstrap();
      window.setInterval(bootstrap, 4000);
    </script>
  </body>
</html>`;
}

function handleDesktopMessage(machine, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString("utf8"));
  } catch {
    return;
  }

  if (message.type === "desktop.hello") {
    machine.desktopToken = message.desktopToken;
    machine.machineLabel = message.machineLabel || "Super ASCIIVision";
    machine.snapshot = message.snapshot || machine.snapshot;
    machine.lastSeenAt = new Date().toISOString();
    return;
  }

  if (message.type === "desktop.snapshot") {
    machine.snapshot = message.snapshot;
    machine.lastSeenAt = new Date().toISOString();
    return;
  }

  if (message.type === "desktop.response" && message.requestId) {
    const pending = machine.pendingRequests.get(message.requestId);
    if (!pending) {
      return;
    }
    machine.pendingRequests.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message);
    } else {
      pending.reject(new Error(message.error || "desktop request failed"));
    }
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, machines: machines.size });
      return;
    }

    if (request.method === "GET" && parts[0] === "m" && parts[1]) {
      sendHtml(response, 200, mobileHtml(parts[1]));
      return;
    }

    if (request.method === "POST" && parts[0] === "api" && parts[1] === "pair" && parts[2]) {
      const machineId = parts[2];
      const machine = requireMachine(machineId);
      const body = await readJson(request);
      const pairingCode = machine.snapshot?.pairingCode;
      if (!pairingCode || String(body.code || "").trim().toUpperCase() !== String(pairingCode).toUpperCase()) {
        sendJson(response, 401, { error: "pairing code did not match" });
        return;
      }

      const sessionId = crypto.randomUUID();
      const label = String(request.headers["user-agent"] || "Phone");
      const now = new Date().toISOString();
      machine.sessions.set(sessionId, {
        sessionId,
        label,
        createdAt: now,
        lastSeenAt: now,
      });

      sendJson(
        response,
        200,
        { ok: true },
        {
          "Set-Cookie": `${machineCookieName(machineId)}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800`,
        },
      );
      return;
    }

    if (request.method === "GET" && parts[0] === "api" && parts[1] === "bootstrap" && parts[2]) {
      const machineId = parts[2];
      const { machine, session } = requireSession(request, machineId);
      sendJson(response, 200, {
        session,
        status: normalizeSnapshot(machine, request),
      });
      return;
    }

    if (request.method === "POST" && parts[0] === "api" && parts[1] === "chat" && parts[2]) {
      const machineId = parts[2];
      const { machine, session } = requireSession(request, machineId);
      const body = await readJson(request);
      const result = await forwardRequest(machine, "chat", {
        sessionId: session.sessionId,
        sessionLabel: session.label,
        ...body,
      });
      sendJson(response, 200, result.payload || {});
      return;
    }

    if (request.method === "POST" && parts[0] === "api" && parts[1] === "generate" && parts[2] && parts[3]) {
      const machineId = parts[3];
      const actionKind = parts[2];
      const { machine, session } = requireSession(request, machineId);
      const body = await readJson(request);
      const action =
        actionKind === "image"
          ? "generateImage"
          : actionKind === "video"
            ? "generateVideo"
            : actionKind === "audio"
              ? "generateAudio"
              : null;
      if (!action) {
        sendJson(response, 404, { error: "not found" });
        return;
      }
      const result = await forwardRequest(machine, action, {
        sessionId: session.sessionId,
        sessionLabel: session.label,
        ...body,
      });
      sendJson(response, 200, result.payload || {});
      return;
    }

    if (request.method === "GET" && parts[0] === "api" && parts[1] === "assets" && parts[2] && parts[3]) {
      const machineId = parts[2];
      const assetId = parts[3];
      const { machine, session } = requireSession(request, machineId);
      const result = await forwardRequest(machine, "downloadAsset", {
        sessionId: session.sessionId,
        sessionLabel: session.label,
        assetId,
      });
      const bytes = Buffer.from(result.binaryBase64 || "", "base64");
      response.writeHead(200, {
        "Content-Type": result.contentType || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(bytes);
      return;
    }

    sendJson(response, 404, { error: "not found" });
  } catch (error) {
    sendJson(response, 502, { error: error instanceof Error ? error.message : "relay error" });
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
  if (url.pathname !== "/ws/desktop") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (socket, request) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
  const machineId = url.searchParams.get("machineId");
  const desktopToken = url.searchParams.get("desktopToken");
  const machineLabel = url.searchParams.get("label") || "Super ASCIIVision";

  if (!machineId || !desktopToken) {
    socket.close(1008, "missing machine credentials");
    return;
  }

  const machine = getMachine(machineId);
  if (machine.desktopToken && machine.desktopToken !== desktopToken) {
    socket.close(1008, "desktop token mismatch");
    return;
  }

  const publicBaseUrl = getPublicBaseUrlForWebSocketUpgrade(request);
  machine.desktopToken = desktopToken;
  machine.machineLabel = machineLabel;
  machine.socket = socket;
  machine.lastSeenAt = new Date().toISOString();

  socket.send(
    JSON.stringify({
      type: "relay.hello",
      machineId,
      publicUrl: `${publicBaseUrl}/m/${machineId}`,
    }),
  );

  socket.on("message", (raw) => handleDesktopMessage(machine, raw));
  socket.on("close", () => {
    if (machine.socket === socket) {
      machine.socket = undefined;
    }
    for (const pending of machine.pendingRequests.values()) {
      pending.reject(new Error("desktop disconnected"));
    }
    machine.pendingRequests.clear();
  });
});

server.listen(port, () => {
  const localUrl = configuredPublicBaseUrl || `http://127.0.0.1:${port}`;
  console.log(`Hands Relay listening on ${localUrl}`);
});
