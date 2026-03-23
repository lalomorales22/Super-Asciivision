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

This repository includes a root-level [`render.yaml`](../render.yaml) Blueprint for `hands-relay`.

### Step 1 — Pick a unique service name

Open `render.yaml` in the root of this repo. Find the `name` field near the top:

```yaml
services:
  - type: web
    name: my-asciivision-relay   # <-- change this
```

Change `my-asciivision-relay` to something unique to you. Render turns this name into your public URL, so whatever you pick becomes `https://<your-name>.onrender.com`. Names are globally unique across all of Render — if someone else already took a name you'll get an error.

Good examples: `alex-ascii-relay`, `studio42-relay`, `my-hands-relay-2024`

### Step 2 — Fork or push to GitHub

Push your repo (with the updated `render.yaml`) to your own GitHub account. Render needs access to the repo to build from it.

### Step 3 — Create the service on Render

1. Go to [render.com](https://render.com) and sign in (free account works).
2. Click **New** > **Blueprint** (or **New** > **Web Service**).
3. Connect your GitHub repo.
4. If you chose Blueprint, Render auto-detects `render.yaml` and shows the service it will create. Confirm the name matches what you set in Step 1.
5. If you chose Web Service manually instead:
   - **Root Directory**: `hands-relay`
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start`
   - **Plan**: Free
6. Click **Deploy**.

### Step 4 — Copy your relay URL

After the deploy finishes, Render shows your service URL at the top of the dashboard. It looks like:

```text
https://alex-ascii-relay.onrender.com
```

Copy this URL — you'll paste it into the app next.

### Step 5 — Connect Super ASCIIVision

1. Open Super ASCIIVision and go to the **Hands** page.
2. In the **Tunnel Setup** section at the bottom:
   - Set **Provider** to `Hands Relay`
   - Paste your Render URL into **Hands Relay URL**
3. Click **Save**, then click **Start Hands**.
4. The status should change to "Hands relay connected" and you'll see a QR code and pairing code.
5. Scan the QR code on your phone to connect.

### Notes

- **Free-tier Render services sleep after inactivity.** The first phone connection after idle may take 30-60 seconds while Render wakes up the service.
- **Custom domain**: If you attach your own domain in Render (e.g. `hands.yourdomain.com`), set the `HANDS_PUBLIC_BASE_URL` environment variable in your Render service settings to that domain so the relay advertises the correct URL.
- **HTTPS and WSS** are handled automatically by Render — no extra config needed.
