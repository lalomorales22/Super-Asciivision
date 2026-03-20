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

Deploy flow:

1. Push the latest repo state to GitHub.
2. In Render, create a new Blueprint or Web Service from the repo.
3. Render will detect `render.yaml` at the repository root.
4. Deploy the `hands-relay` web service.
5. After deploy, copy the Render HTTPS URL, for example:

```text
https://hands-relay.onrender.com
```

6. In Super ASCIIVision `Hands`, set:
   - `Provider`: `Hands Relay`
   - `Hands Relay URL`: your Render HTTPS URL
7. Start `Hands` again so the desktop opens the relay websocket and receives a QR-ready public URL.

Optional:

- Set `HANDS_PUBLIC_BASE_URL` in Render if you later attach a custom domain and want to force the exact external origin.
- Render web services provide public HTTPS, and public websocket traffic should use `wss` automatically from the deployed origin.
- Free-tier services may sleep; the first mobile hit after idle can take a little longer.
