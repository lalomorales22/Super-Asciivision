# Handoff v9 — Chat UX, Media Sidebar, Realtime Voice, Zoom, Categories

## Session Summary (2026-03-21, session v9)

Major UX pass across Chat, Image & Video, and Voice & Audio pages. All changes compile clean (Rust + TypeScript).

The architecture is layered: Rust backend (Tauri commands) → TypeScript API (`src/lib/tauri.ts`) → Zustand store (`src/store/appStore.ts`) → React components (`src/App.tsx`).

---

## Changes Made This Session

### 1. Chat Page
- **Workspace context leak fix**: `loadConversation` now clears `activeWorkspaceId` and `workspaceSelection` (appStore.ts:600)
- **Stream timeout**: Ollama/provider streams timeout after 60s via `tokio::time::timeout` (providers.rs:255-264)
- **Typing indicator**: Animated bouncing dots CSS + `TypingIndicator` component replaces static "..." during streaming (styles.css, App.tsx:1793)
- **Workspace sidebar simplified**: Drag-and-drop zone, single "+" button, per-item remove (X) button. Old buttons (Folder, Files, Rescan, Replace folder/files, workspace pills) removed

### 2. Image & Video Page
- **Ollama model notice**: Info box below greyed-out Ollama buttons showing terminal commands to install models (App.tsx, inside ImaginePage around line 2108)
- **Workspace sidebar → media import**: Drag-and-drop stages files as cards with "Add to Gallery" / "Add to Editor" / "Remove" buttons (not auto-import)
- **Category context menu**: Right-click categories → Rename / Delete (App.tsx ImaginePage, bottom)
- **Separate categories**: Categories now have a `kind` field — Image/Video creates `kind: "visual"`, Voice creates `kind: "audio"`. Each page filters to its own categories. Legacy categories (kind=NULL) show on both.

### 3. Voice & Audio Page
- **Voice selector**: 5 voice buttons (Eve, Ara, Rex, Sal, Leo) replaced the dropdown `<select>`
- **Push-to-talk mode**: Hold mic button to talk, release to send. Uses `pushingRef` to avoid stale closure bugs. No server VAD — manual `input_audio_buffer.commit` + `response.create` on release
- **Auto mode**: Server VAD (back-and-forth) — same as before but with proper toggle
- **Mode toggle**: "Push to Talk" / "Auto (back & forth)" buttons above the mic
- **Realtime WebSocket proxy**: New `realtime_proxy.rs` module — local Axum WebSocket server on random port relays to `wss://api.x.ai/v1/realtime` with proper `Authorization: Bearer` header (browser WebSocket can't set headers). CSP updated to allow `ws://127.0.0.1`
- **Default model**: Changed from `grok-realtime` to `grok-3-mini-fast`
- **Category context menu**: Same rename/delete as Image & Video page
- **Sidebar drag-and-drop**: Same staged-file-card pattern as Image & Video

### 4. Global
- **Cmd+/- zoom**: CSS `zoom` on `<main>`, 60%-150% range, Cmd+0 resets. Clickable percentage badge in bottom-right corner. Works on all pages.
- **Workspace toolbar hidden on media pages**: The rescan/delete toolbar only shows when `isTextWorkspace` (chat/ide)
- **Delete confirmation removed**: Workspace delete no longer prompts `window.confirm()`

---

## Key File Locations

### Frontend
- **`src/App.tsx`** (~7000+ lines) — ALL page components live here:
  - `ImaginePage` ~line 2002
  - `GeneratingMediaCard` ~line 2451
  - `MediaAssetCard` ~line 2490
  - `VoiceAudioPage` ~line 2761 (realtime voice logic: start/stop/push-to-talk/audio processing all here)
  - `IdePage` ~line 3435
  - `HandsPage` ~line 4468
  - `WorkspaceDrawer` ~line 5087
  - `WorkspaceItemRow` ~line 5157
  - `EditorPage` ~line 5426
  - `MusicPage` ~line 6207
  - `TilesPage` ~line 6531
  - `TypingIndicator` ~line 1793
  - Audio utilities (PCM16 encode/decode, mic access) ~line 423-553
  - Keyboard shortcuts (zoom, terminal toggle) ~line 758
  - Zoom state + main element zoom style ~line 694, 832

- **`src/store/appStore.ts`** — Zustand store:
  - Workspace actions: `addFilesToWorkspace`, `removeWorkspaceFile` ~line 813
  - Media category actions: `createMediaCategory`, `renameMediaCategory`, `deleteMediaCategory` ~line 992
  - Conversation lifecycle: `loadConversation`, `createConversation` ~line 598

- **`src/lib/tauri.ts`** — All Tauri IPC wrappers (1:1 with Rust commands)
- **`src/types.ts`** — All shared interfaces
- **`src/styles.css`** — Typing dot animation, xterm styles

### Backend (Rust)
- **`src-tauri/src/providers.rs`** — xAI API calls (chat streaming, image/video gen, TTS, realtime session creation with fallback)
- **`src-tauri/src/realtime_proxy.rs`** — NEW: Local WebSocket proxy for xAI realtime (Axum + tokio-tungstenite)
- **`src-tauri/src/db.rs`** — SQLite schema, all CRUD. Categories table has `kind TEXT` column. `ensure_column` pattern for migrations
- **`src-tauri/src/lib.rs`** — All `#[tauri::command]` functions, `AppState` struct (includes `realtime_proxy: Mutex<Option<RealtimeProxy>>`)
- **`src-tauri/src/types.rs`** — Rust structs (serde camelCase). `RealtimeSession` has `proxy_port: Option<u16>`
- **`src-tauri/src/hands.rs`** — Mobile bridge / Hands relay (Axum server, WebSocket terminal proxy)
- **`src-tauri/tauri.conf.json`** — CSP includes `ws://127.0.0.1` for realtime proxy

---

## Known Issues / Next Steps
- Realtime voice may still disconnect depending on xAI API key validity and model availability — the proxy is solid but the API compatibility hasn't been fully validated with a live key
- The `workspaceMedia` loading effect in WorkspaceDrawer is still there but `workspaceMedia` state is unused (only `setWorkspaceMedia` is used by the effect) — could be cleaned up
- Media asset card preview portal (hover popup) on the category move dropdown still shows ALL categories, not filtered by kind — could be improved
- The gallery density controls (4/5/6 buttons) could be tied to the zoom level for a more seamless experience
