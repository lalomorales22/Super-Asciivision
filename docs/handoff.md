# Grok Desktop — Handoff

## What Is This

Grok Desktop is a macOS Tauri app (Rust backend + React/TypeScript frontend) for xAI. It has: Tiles (multi-terminal grid — 2, 4, or 9 independent PTY sessions), Chat, Imagine (image/video gen), Voice & Audio (TTS + realtime voice), Media Editor (timeline + ffmpeg export), IDE (file explorer, editor, terminal, browser, AI assistant), and Hands (mobile phone bridge via relay or Cloudflare tunnel).

The user builds and tests with `npm run tauri dev` during development, then does `npm run tauri build` to produce a DMG for distribution. The app is currently unsigned (no Apple Developer cert), so DMG users need `xattr -cr` before first launch.

## Where Everything Lives

### Frontend (one monolithic file)
- **src/App.tsx** — all pages, all components (~5500+ lines). Every page is a function in this file.
- **src/store/appStore.ts** — Zustand store, all actions and state
- **src/lib/tauri.ts** — Tauri IPC bridge (invoke wrappers)
- **src/types.ts** — TypeScript interfaces
- **src/styles.css** — global styles, titlebar drag CSS, highlight.js theme, scrollbar

### Backend (Rust)
- **src-tauri/src/lib.rs** — Tauri command handlers (the glue)
- **src-tauri/src/providers.rs** — xAI API calls (chat, image, video, TTS, realtime voice)
- **src-tauri/src/terminal.rs** — PTY terminal sessions via portable-pty
- **src-tauri/src/workspace.rs** — file indexing/scanning (WalkDir, TEXT_EXTENSIONS, ignore list)
- **src-tauri/src/hands.rs** — mobile bridge server + relay client
- **src-tauri/src/editor.rs** — ffmpeg-based video export
- **src-tauri/src/agent.rs** — Phase 1 agentic tool execution framework
- **src-tauri/src/tools.rs** — tool definitions (read/write/edit files, bash, git, etc.)
- **src-tauri/src/db.rs** — SQLite operations
- **src-tauri/src/keychain.rs** — macOS Keychain API key storage

### Other
- **hands-relay/** — standalone Node.js WebSocket relay for Hands mobile access
- **install.sh** — one-line macOS install script (checks prereqs, builds, installs to /Applications)
- **tasks.md** — detailed task tracker with code-level analysis for each bug/feature
- **render.yaml** — Render Blueprint for deploying hands-relay

## What Was Done This Session

### Fixes Applied
1. **Window dragging** — added `-webkit-app-region: drag` CSS on `.grok-titlebar` class. The app uses `decorations: false` + `transparent: true` so native drag needs this CSS.
2. **Close/minimize buttons** — fixed by using CSS class approach instead of `data-tauri-drag-region` on the outer container (which was intercepting clicks before React handlers fired).
3. **TTS audio generation** — added missing `model` field to the xAI TTS API request body in providers.rs.
4. **Timeline trim snap-to-minimum** — `parseSecondsInput("")` returned 0 instead of fallback because `Number("") === 0`. New clips have `trimEnd = ""`, so `buildClipTrimPatch` thought `currentEnd = 0`. Fixed by returning fallback for empty strings.
5. **IDE file explorer missing files** — raised `MAX_FILES` from 200 to 2000 in workspace.rs, added ignore patterns for `__pycache__`, `.venv`, `venv`, `.mypy_cache`, `.pytest_cache`, `.DS_Store`, `.idea`, `.vscode`, `build`, etc.
6. **Native right-click "Reload" menu** — added global `contextmenu` event listener with `preventDefault()` in the App component.
7. **agent.rs compile errors** — fixed ToolResult usage (was using `Ok()`/`Err()` pattern on a struct, not a Result enum).
8. **install.sh unicode crash** — replaced unicode ellipsis `…` with ASCII `...` to fix bash `unbound variable` error on some machines.

### Features Added
1. **install.sh** — full macOS install script (Xcode CLI Tools, Homebrew, Node 20+, Rust, ffmpeg, build, install)
2. **IDE right panel toggle** — Assistant and Browser tabs in the IDE's right sidebar. User can now start a server in the terminal and view it in the Browser tab without leaving the IDE page.
3. **README overhaul** — added clone+install instructions, Gatekeeper/xattr bypass docs for DMG users, fixed stale absolute paths to relative.
4. **Syntax highlighting** — highlight.js integrated (from merged PR)
5. **Agent framework** — Phase 1 agentic architecture with tool execution (from merged PR)

### Current Version
- v0.1.2 on GitHub Releases (DMG is slightly behind the latest commits)
- When ready to ship next: bump to v0.1.3, rebuild, push, create release

## What Still Needs Work (see tasks.md for details)

### Active Bugs
- **Terminal double-typing** — React StrictMode in `src/main.tsx:7` double-mounts TerminalPanel in dev mode, potentially duplicating xterm.js `onData` listeners. Fix: stabilize the useEffect by moving `writeTerminalData` into a ref. May only affect `tauri dev`, not production builds.
- **Realtime voice** — session creation + WebSocket may be failing silently. Needs debug logging. Server VAD (`turn_detection: server_vad`) is already configured but untested end-to-end.
- **Gallery hover cards** — `MediaAssetCard` portals to `document.body` but doesn't clamp position to viewport bounds. Cards near edges overflow off-screen.

### Planned Features
- **Media Editor CapCut upgrade** — drag-drop reorder, visual trim handles, playback preview with scrubber, clip splitting, transitions, text overlays, undo/redo, zoom, waveforms, export settings. See tasks.md Phase 1/2/3 breakdown.
- **IDE "Open in Terminal"** — handler exists (`handleOpenInTerminal`) but needs to ensure terminal session is alive first and auto-switch UI to show terminal.

### Features Added (This Session)
1. **Hands relay security overhaul** — removed all hardcoded `http://127.0.0.1:8787` defaults from backend (types.rs, db.rs, hands.rs) and frontend (App.tsx, appStore.ts). The app now ships with no default relay URL — users must deploy their own relay before Hands will work. Added an amber security warning in the Hands settings UI explaining that all traffic passes through the relay in plaintext and users should never use someone else's URL. Rewrote the README Hands sections with security-first guidance and step-by-step self-deploy instructions.
2. **Tiles page** — new top-level page (first nav tab) that opens a grid of independent terminal windows on the user's machine. The user can choose between 3 layouts: 1×2 (2 terminals side-by-side), 2×2 (4 terminals), or 3×3 (9 terminals). Each tile is a fully functional PTY terminal session (xterm.js + portable-pty) that supports everything a normal terminal does — run Claude, ssh, scripts, etc. Switching layouts kills the old sessions and spawns fresh ones. Leaving the Tiles page cleans up all sessions.
   - **Backend**: added `create_terminal_session` in `terminal.rs` (always spawns a new PTY, unlike `ensure_terminal` which reuses) and `create_terminal` Tauri command in `lib.rs`.
   - **Frontend**: `TilesPage` component with layout selector, `TileTerminal` component with per-session event listening via `listen("terminal://event")` filtered by `sessionId`. Added to `CenterStage` routing. Tiles page hides the footer terminal and right sidebar for a full-screen terminal grid experience.

## Next Session Plan

1. User will be testing the app and reporting issues — fix as they come.
2. Still iterating — don't rebuild DMG/release after every change. Batch them.
3. When the user says they're ready, bump version, build, push, create GitHub release.
4. Continue working through tasks.md priority list.

## Future Idea: Agent Environment Canvas

The user wants to add a visual "agent environment" page — a canvas with animated characters (little penguins in an office) that represent the AI agents working. When agents are coding, reading files, running tools, etc., the penguin characters would visually act out those tasks in a cute office setting. Think: a fun, animated dashboard that makes the agentic tool execution framework (agent.rs/tools.rs) visually tangible. This is a creative/UI project that would build on top of the existing agent event system (`onAgent` in the store) to drive the animations.

## Quick Reference

```bash
# Development
npm run tauri dev

# Production build
npm run tauri build

# Install to /Applications
ditto "src-tauri/target/release/bundle/macos/Grok Desktop.app" "/Applications/Grok Desktop.app"

# Validation
npm test && npm run build && cd src-tauri && cargo check
```
