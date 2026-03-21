# Handoff v8 — Super ASCIIVision

## What Was Done This Session

### ASCIIVision Performance Optimization (Priority 1-4 from v7)

**P1: Removed Mandatory Intro Video Dependency**
- Made `render_wireframe_cube` and `render_plasma` public in `effects.rs`
- When `self.video` is `None` during intro, a spinning wireframe cube renders in the video area with a "SIGNAL // SYNTHETIC RASTER" border — no more blank screen or FFmpeg dependency to show a good intro
- Key change: `asciivision-core/src/main.rs` `render_intro()` now has an `else` branch for the no-video case

**P2: Added `/video <path>` Command**
- `/video /path/to/file.mp4` loads any local video file into the video bus
- Added to `SLASH_COMMANDS` list and `dispatch_input()` handler
- Validates file exists, creates `VideoPlayer`, sets source label and status

**P3: Rendering Performance**
- **Background**: `render_background()` (expensive per-cell animated gradient with sin/cos math) now only runs during Intro. Chat mode uses a simple `Block::default()` solid fill — massive CPU savings
- **Frame rate**: Dropped from 60fps (16ms sleep) to 30fps (33ms sleep). TUI content doesn't need 60fps
- **Double-draw eliminated**: Mode transition code was drawing twice per frame (once in transition block, then unconditionally). Now draws once
- **Sidecar skip-intro**: Added `--skip-intro` to the Tauri sidecar launch in `terminal.rs` so the intro is skipped when running inside the desktop shell
- **Dead code cleanup**: Removed unused `render_synthetic_scope` function

**P4: Video Panel Idle Animation**
- Replaced the old `render_synthetic_scope` (simple sine wave) with a spinning wireframe cube + gradient "NO SIGNAL // /video <path> or /youtube <url>" text when the video panel is visible but no video is loaded

### PTY/Terminal Bug Fixes (macOS)

**ASCIIVision Scroll Fix**
- The PTY was created at hardcoded 50x160 but the xterm.js viewport could be smaller on a MacBook. With `--skip-intro`, the binary immediately rendered at 50 rows — characters beyond the viewport scrolled the alternate screen buffer upward every frame
- Fix: xterm.js calls `fitAddon.fit()` BEFORE launching the binary, then passes actual `cols`/`rows` through the IPC chain (`launchAsciivision` → `create_asciivision_session` → `PtySize`). Defaults to 120x40 if not provided
- Changed files: `src/App.tsx`, `src/lib/tauri.ts`, `src-tauri/src/lib.rs`, `src-tauri/src/terminal.rs`

**Tile Double-Prompt Fix**
- The early output buffer captured both the initial shell prompt and the post-resize prompt (SIGWINCH redraw), showing two `user@host ~ %` lines
- Fix: drain the early buffer silently (don't replay it) and send Ctrl+L (`\x0c`) to clear the screen and redraw a single clean prompt at the correct viewport size

**Terminal Missing-Prompt Fix**
- The TerminalPanel never drained the early output buffer — the shell prompt was trapped in the buffer and never displayed (just a green cursor visible)
- Fix: added early buffer drain in the `useEffect` that fires when `terminalSessionId` changes, followed by Ctrl+L for a clean prompt

### GitHub Release
- Created release `v0.1.2` at https://github.com/lalomorales22/Super-Asciivision/releases/tag/v0.1.2
- Uploaded Linux ARM64 artifacts: AppImage, .deb, .rpm
- macOS DMG still needs to be built and uploaded (see next session)

---

## Current State

The app builds and runs on both macOS and Linux. The ASCIIVision TUI core is significantly faster on ARM (30fps, no animated background in chat, no double-draw). The intro works without a video file. Terminal/tile PTY sizing is correct on macOS.

**What works:**
- Full desktop shell (Chat, Imagine, Voice, IDE, Tiles, Music, Hands, Settings)
- ASCIIVision TUI with AI chat, video, webcam, 3D effects, games, sysmon
- Ollama local AI provider
- `/video <path>` and `/youtube <url>` commands
- Cross-platform builds (macOS + Linux)
- GitHub release with Linux ARM64 artifacts

**Known issues to verify on macOS:**
- The tile and terminal prompt fixes (Ctrl+L approach) need macOS testing — if the shell doesn't support Ctrl+L (unlikely but check), prompts may not appear
- The ASCIIVision PTY size fix needs macOS validation — scroll issue should be gone

---

## Next Session: macOS Build + Release + Remaining Priorities

### Immediate: Build macOS DMG and Upload to Release

The user will sync the repo on their MacBook Pro. The next Claude session should:

1. Pull latest (`git pull`)
2. Build the app: `npm run tauri build`
3. Upload the DMG to the existing release:
   ```bash
   gh release upload v0.1.2 "src-tauri/target/release/bundle/dmg/Super ASCIIVision_0.1.2_aarch64.dmg"
   ```
4. Test that ASCIIVision, Tiles, and Terminal all work correctly on macOS
5. If the tile/terminal Ctrl+L fix doesn't work on macOS zsh, iterate on the approach

### Remaining Priorities from v7 (Not Yet Done)

**Priority 5: Hands Mobile Terminal Access**
- Add a terminal tile to the mobile bridge so a paired phone can type into a PTY session
- Current Hands architecture: `src-tauri/src/hands.rs` runs Axum HTTP + WebSocket server
- Need: new mobile page/route for "Terminal," relay PTY I/O through WebSocket
- Key files: `hands.rs`, `terminal.rs`, `hands-relay/src/server.js`

**Priority 6: Media Editor Auto-Categorization**
- When Media Editor exports, auto-save to a "Media Editor" category in the gallery
- Image/video exports → Image & Video gallery; audio-only → Voice & Audio gallery
- Key files: `src-tauri/src/lib.rs` (`export_editor_timeline_command`), `src-tauri/src/db.rs`

### Other Improvement Ideas
- **Adaptive frame rate**: Measure draw time, use faster rate when CPU allows, slower when it doesn't
- **AppImage for x86_64**: Currently only ARM64 — add x86_64 build for broader Linux support
- **Code signing**: macOS users need `xattr -cr` on first launch; iOS-style signing would fix this
- **YouTube playback reliability**: `yt-dlp` stream resolution can be flaky — consider caching or retry logic

---

## Architecture Quick Reference

### ASCIIVision Core (`asciivision-core/`, ~11K lines Rust)

| File | What it does | Lines |
|------|-------------|-------|
| `main.rs` | App struct, main loop, all rendering, command handling | ~3900 |
| `ai.rs` | Multi-provider AI chat (Claude, Grok, GPT, Gemini, Ollama) | ~800 |
| `video.rs` | FFmpeg video decode to ASCII frames | ~200 |
| `webcam.rs` | Live camera capture via FFmpeg (avfoundation/v4l2) | ~250 |
| `effects.rs` | 3D effects engine (matrix, plasma, starfield, cube, fire) | ~600 |
| `sysmon.rs` | System monitor (CPU, RAM, network, per-core sparklines) | ~400 |
| `tiles.rs` | PTY-backed terminal tiling (1-8 panes) | ~350 |
| `tiling.rs` | Tiling layout manager (panel arrangement) | ~200 |
| `games.rs` | Pac-Man, Space Invaders, 3D Penguin | ~500 |
| `theme.rs` | Color theme definitions | ~100 |
| `db.rs` | SQLite conversation persistence | ~150 |
| `shell.rs` | Shell command execution for agent tools | ~100 |
| `tools.rs` | AI agent tool definitions and execution | ~300 |
| `message.rs` | Chat message types | ~50 |
| `memory.rs` | Conversation memory/context | ~80 |
| `server.rs` | Video chat WebSocket server | ~200 |
| `client.rs` | Video chat WebSocket client | ~200 |
| `analytics.rs` | Analytics/telemetry panel | ~150 |

### Tauri Desktop Shell (`src-tauri/`, ~8.8K lines Rust + React frontend)

| File | What it does |
|------|-------------|
| `src-tauri/src/lib.rs` | All Tauri commands, app setup, sidecar launch |
| `src-tauri/src/providers.rs` | xAI + Ollama API integration |
| `src-tauri/src/agent.rs` | Agentic tool-use loop (OpenAI-compatible) |
| `src-tauri/src/terminal.rs` | PTY session management (3 session types: singleton, tile, asciivision) |
| `src/App.tsx` | Entire React frontend (~7K lines, single file) |
| `src/store/appStore.ts` | Zustand state management |
| `src/lib/tauri.ts` | IPC bridge to Rust backend |

### Key Rendering Pipeline (main.rs)

```
run_app() loop:
  handle_input()           — polls crossterm events (10ms timeout)
  tick()                   — updates video, games, reveals, sysmon
  terminal.draw(render)    — ratatui diff-based rendering
  sleep(33ms)              — 30fps target

render():
  Intro mode:
    render_background()    — full-screen animated gradient
    render_intro()         — video OR wireframe cube + logo + starburst + raster bars + scroller
  Chat mode:
    Block solid fill       — cheap bg_base fill (no per-cell math)
    render_chat()          — header + tiled panels + input + scroller
```

### PTY Session Creation (terminal.rs)

| Function | Initial Size | Used By |
|----------|-------------|---------|
| `ensure_terminal()` | 30x120 | Main terminal (singleton) |
| `create_terminal_session()` | 30x120 | Tile terminals |
| `create_asciivision_session()` | From caller (defaults 120x40) | ASCIIVision sidecar |

---

## Files Changed This Session

```
asciivision-core/src/effects.rs  — Made render_wireframe_cube and render_plasma pub
asciivision-core/src/main.rs     — P1-P4: intro effect, /video path, perf opts, idle animation
src-tauri/src/terminal.rs        — --skip-intro flag, PTY size from caller
src-tauri/src/lib.rs             — cols/rows params for launch_asciivision
src/App.tsx                      — PTY size passthrough, tile/terminal prompt fixes
src/lib/tauri.ts                 — cols/rows params for launchAsciivision IPC
```

## Important Notes

- The app is **not code-signed** — macOS users need `xattr -cr` on first launch
- Ollama image generation (`x/flux2-klein`) is **macOS only** (Ollama limitation)
- `qwen3.5:2b` is the recommended Ollama model — small, supports tool use for agent mode
- The v0.1.2 release currently only has Linux ARM64 artifacts — macOS DMG needs to be built and uploaded
- This project matters to the user. It's their main creative project. Treat it with care and keep it RAD.
