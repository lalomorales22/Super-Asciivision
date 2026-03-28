# Super ASCIIVision - Improvement Plan

## Phase 1: Quick Fixes (bugs, Hands UX, deploy friction) -- COMPLETE

- [x] **Fix EditorPage memory leak** — `keydown` listener in context menu dismiss effect now properly removed in cleanup.
- [x] **Add "Deploy to Render" button to README** — one-click deploy link with collapsible manual setup details.
- [x] **Add "Deploy to Render" button to Hands page README** — same button in `hands-relay/README.md` with streamlined steps.
- [x] **Improve Hands page tunnel setup UX** — provider dropdown shows "(recommended)" / "(advanced)", descriptions explain each option, relay mode shows inline deploy button + 3-step quick-setup guide, cloudflare mode shows install hint, right panel explains all three concepts clearly.
- [x] **Add copy button to pairing code** — already present, no changes needed.

## Phase 2: First-Run Experience -- COMPLETE

- [x] **Detect missing API key on launch** — when no xAI key is configured and no Ollama is detected, Chat page shows a `SetupPrompt` with two clear options (xAI cloud vs Ollama local), each with actionable steps. The "Open API Keys" button opens Settings directly to the Keys tab.
- [x] **First-run welcome banner** — dismissible `WelcomeBanner` appears on Chat page when there are no conversations. Shows all 8 pages with descriptions, an "Open Settings" button, and a tip about the rainbow ASCIIVision button. Dismissal persisted to localStorage so it only shows once.
- [x] **Settings page: section tabs** — split into 4 tabs: Shell, Models, API Keys, ASCIIVision. Each tab shows only its relevant content. Settings can be opened to a specific tab via `toggleSettings(true, "keys")`. Added Ollama guidance in the API Keys tab and ASCIIVision key context in the ASCIIVision tab.

## Phase 3: UX Polish -- COMPLETE

- [x] **ASCIIVision shortcuts overlay** — shows automatically on first launch (persisted to localStorage). Lists all function keys and key slash commands organized in 5 sections (AI, Media, Terminal, System, Appearance). A "Shortcuts" button in the bottom-right corner re-opens it anytime. Closes to reveal the terminal underneath.
- [x] **Error toast duration** — increased from 5s to 8s so users don't miss error messages.
- [x] **Voice page mode explanations** — renamed "Auto (back & forth)" to "Auto (hands-free)", added contextual help text under the toggle explaining each mode: Push = "Hold to speak, release to send. Best for noisy environments." Auto = "Listens continuously, responds when you stop. Best for quiet spaces."
- [x] **IDE dirty indicator** — already existed (amber dot on tab bar, line 959). No changes needed.
- [x] **Tiles focus indicator** — clicking a terminal pane highlights it with an emerald border + subtle glow. Unfocused panes have the default border with a hover hint. Focus state tracked in TilesPage.

## Phase 4: Built-in LAN Relay (zero-setup Hands for local network) -- COMPLETE

- [x] **Embed relay logic in Tauri** — the local Axum server in `hands.rs` already had all the endpoints (chat, image/video/audio gen, pairing, terminal WebSocket). Changed it to bind to `0.0.0.0` in local mode so phones on the same WiFi can reach it directly. No Node.js relay needed for LAN use.
- [x] **Auto-detect LAN IP** — added `detect_lan_ip()` using the UDP socket trick (zero dependencies). Detects the machine's LAN IP via OS routing table and sets public URL to `http://{lan_ip}:{port}` automatically.
- [x] **"Local Network" provider option** — added as the first and default choice. New users get zero-setup Hands out of the box. Relay is now the second option ("remote access"), Cloudflare third ("advanced").
- [x] **Update Hands page UI** — Local Network shows inline explainer ("same WiFi, no cloud"). Relay shows deploy button + URL field. Cloudflare shows executable field. Right panel updated with all three modes explained. Defaults changed from "relay" to "local" across appStore, HandsPage, and hands.rs.
