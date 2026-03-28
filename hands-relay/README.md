# Hands Relay

`hands-relay` is the public relay/control-plane for the Super ASCIIVision `Hands` provider.

It gives desktop machines a public URL without requiring Cloudflare or ngrok. The desktop app opens an outbound websocket to the relay, and phones talk to the relay over HTTPS.

## What It Does

- accepts persistent desktop websocket connections
- exposes public mobile pages at `/m/:machineId`
- handles pairing-code auth and mobile session cookies
- forwards mobile chat/media requests to the connected desktop
- streams binary asset downloads back from the desktop

## Run Locally

```bash
cd hands-relay
npm install
npm run start
```

Default port: `8787`

## Environment

- `PORT`: relay listen port, default `8787`
- `HANDS_PUBLIC_BASE_URL`: public base URL to advertise back to the desktop; defaults to the incoming request host for HTTP pages and `http://127.0.0.1:${PORT}` for local development

## Production

To make `Hands` reachable away from home, this relay must run on a publicly reachable host with HTTPS in front of it.

The desktop app should point `Hands Relay URL` at that deployed origin, for example:

```text
https://hands.yourdomain.com
```

## Deploy On Render

### One-Click Deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/lalomorales22/Super-Asciivision)

This opens Render with the `hands-relay` service pre-configured on the free plan. You just need to:

1. **Sign in** to [render.com](https://render.com) (free account works).
2. **Pick a unique service name** when prompted (e.g. `alex-ascii-relay`). Render turns this into your public URL (`https://<your-name>.onrender.com`). Names are globally unique across all of Render.
3. **Click Deploy.** Wait for the build to finish.
4. **Copy your relay URL** from the top of the Render dashboard (e.g. `https://alex-ascii-relay.onrender.com`).

### Connect Super ASCIIVision

1. Open Super ASCIIVision and go to the **Hands** page.
2. In the **Tunnel Setup** section at the bottom:
   - Set **Provider** to `Hands Relay`
   - Paste your Render URL into **Hands Relay URL**
3. Click **Save**, then click **Start Hands**.
4. The status should change to "Hands relay connected" and you'll see a QR code and pairing code.
5. Scan the QR code on your phone to connect.

<details>
<summary>Manual setup (fork + Blueprint)</summary>

1. Open `render.yaml` in the root of this repo and change the `name` field to something unique (e.g. `alex-ascii-relay`, `studio42-relay`).
2. Push your fork to GitHub.
3. In Render, click **New** > **Blueprint**, connect your repo. Render auto-detects `render.yaml`.
4. Confirm the service name and click **Apply**.
5. Copy your Render HTTPS URL after deploy finishes.

</details>

### Notes

- **Free-tier Render services sleep after inactivity.** The first phone connection after idle may take 30-60 seconds while Render wakes up the service.
- **Custom domain**: If you attach your own domain in Render (e.g. `hands.yourdomain.com`), set the `HANDS_PUBLIC_BASE_URL` environment variable in your Render service settings to that domain so the relay advertises the correct URL.
- **HTTPS and WSS** are handled automatically by Render — no extra config needed.
