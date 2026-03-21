# Handoff v7 — Super ASCIIVision

## What Was Done This Session

### Ollama Integration (Desktop Shell)
- Added `Ollama` as a second AI provider alongside xAI in the Tauri desktop app
- **Chat page**: xAI / Ollama toggle buttons with model dropdown that swaps between providers. Agent mode works with both (Ollama uses OpenAI-compatible `/v1/chat/completions`). Recommended model: `qwen3.5:2b` (tool use + vision)
- **IDE page**: Same provider toggle for the AI Copilot assistant panel
- **Imagine page**: Added `x/flux2-klein:4b` and `x/flux2-klein:9b` as Ollama image generation options. Greyed out with tooltip when Ollama isn't running or model isn't installed. Resolution/aspect controls hidden for Ollama models (generates at 1024x1024)
- Backend routes: `providers.rs` handles Ollama model listing (`/api/tags`), streaming chat (`/v1/chat/completions`), image generation (`/api/generate` with base64 PNG response), and availability checks
- Agent mode: `agent.rs` accepts configurable `endpoint_url` so the agent loop can target Ollama's endpoint with no auth

### Linux Cross-Platform Support
- Platform-conditional `keyring` crate: `apple-native` on macOS, `linux-native` (libsecret) on Linux
- Sidecar binary lookup detects `aarch64-unknown-linux-gnu` and `x86_64-unknown-linux-gnu`
- `build-asciivision.sh` detects Linux libclang paths (`/usr/lib/llvm-*/lib/`)
- `install-linux.sh`: Full installer for Debian/Ubuntu, Fedora, Arch, openSUSE. Handles pango version conflicts (Jetson L4T), installs libssl-dev, sources cargo env between runs
- Successfully built and launched on Jetson Orin Nano (Ubuntu 22.04, aarch64)

### Intro Title Upgrade
- Replaced flat block-text logos with taller decorative ASCII art fonts
- `render_logo()` now has: deep shadow layer, animated sine-wave color gradient, depth shading (top-bright/bottom-dark), shimmer pulse, and pulsing subtitle glow

---

## Current State

The app builds and runs on both macOS and Linux. The desktop shell (Tauri + React) works well. The main issue is **ASCIIVision performance on lower-powered hardware** — the embedded TUI binary lags significantly during the intro and can be sluggish in normal operation, especially on ARM (Jetson Orin Nano).

---

## Next Session: ASCIIVision Optimization

### Priority 1: Remove Mandatory Intro Video Dependency

The intro plays a demo video (`demo-videos/demo.mp4`) through FFmpeg ASCII decoding. This is the heaviest operation in the app and causes severe lag on ARM.

**What to do:**
1. Replace the intro video with a **lightweight animated 3D ASCII art** idle screen — think a spinning wireframe cube, rotating ASCII logo, or pulsing geometric pattern. Something that looks cool but is pure computation (no FFmpeg decode). The effects engine already has: matrix rain, plasma, starfield, wireframe cube, fire, particle storms (`asciivision-core/src/effects.rs`). One of these (or a new one) could serve as the intro backdrop instead of video.
2. Keep the video **available but optional** — the `--background-video` and `--intro-video` CLI args already exist. Just don't require a video file to show a good intro.
3. The video panel should still work when the user explicitly loads one.

**Key files:**
- `asciivision-core/src/main.rs:2151` — `render_intro()` function. Currently renders video + logo + starburst + info panel
- `asciivision-core/src/main.rs:374-394` — `resolve_video_path()` is called at startup. If no video found, `self.video = None`
- `asciivision-core/src/main.rs:2166-2181` — The video rendering block inside `render_intro()` (guarded by `if let Some(video)`)
- `asciivision-core/src/effects.rs` — All the 3D effects are here. `EffectsEngine` has `render()` method

**Approach:** When `self.video` is `None`, instead of showing nothing in the video area, render a cool animated effect (e.g., wireframe cube or plasma) in that same `video_area` rect. The effects engine already knows how to render into a bounded rect.

### Priority 2: Add `/video path/to/file` Command

Currently `/video` just toggles the video panel on/off. `/youtube <url>` streams YouTube. Add `/video <path>` to load a local video file.

**Key files:**
- `asciivision-core/src/main.rs:1457-1464` — Current `/video` toggle handler
- `asciivision-core/src/main.rs:1467-1510` — `/youtube` handler (good template for `/video <path>`)
- `asciivision-core/src/video.rs` — `VideoPlayer::new(path, dimensions, looping)` constructor

**Implementation:**
```rust
// In handle_command(), after the existing "/video" toggle:
if let Some(path) = input.strip_prefix("/video ") {
    let path = path.trim().to_string();
    if path.is_empty() {
        // toggle behavior (existing)
    } else {
        // Load video from path
        let video_path = PathBuf::from(&path);
        if !video_path.exists() {
            self.add_system_message(format!("file not found: {}", path));
            return;
        }
        // Create new VideoPlayer (similar to how YouTube does it)
        match VideoPlayer::new(video_path, (decode_cols, decode_rows), true) {
            Ok(player) => {
                self.video = Some(player);
                self.video_enabled = true;
                self.status_note = format!("playing: {}", path);
            }
            Err(e) => self.add_system_message(format!("video error: {}", e)),
        }
    }
}
```

### Priority 3: Performance Optimization

The main loop runs at 60fps (`sleep(16ms)` at `main.rs:3911`). Every frame, it:
1. Polls input (`handle_input` — polls with 10ms timeout at line 1127)
2. Runs `tick()` — updates video, games, reveal queue, sysmon
3. Draws the full frame via ratatui

**Bottlenecks to investigate:**

1. **`render_background()`** (`main.rs:3509`) — Fills every cell in the terminal with computed colors every frame. On a large terminal this is thousands of cells with sin/cos math per cell. Consider:
   - Only rendering background on cells that aren't covered by panels
   - Reducing the math complexity (precomputed lookup tables)
   - Skipping background render entirely in Chat mode (only do it during Intro)

2. **`render_raster_bars()`** (`main.rs:3525`) — Another full-area pass with per-cell computation. Only used during Intro — make sure it's not running during Chat mode.

3. **`render_starburst()`** (`main.rs:3610`) — Called multiple times per frame (intro + header + ops panel). Each call does trigonometric math per ray per step.

4. **Video decoding** (`video.rs`) — FFmpeg decode runs in a background thread, which is good. But `video.tick()` + `video.render()` still do per-frame work. When video isn't visible, ensure `tick()` is skipped (currently gated by `self.video_enabled || AppMode::Intro`).

5. **`render_equalizer()`** (`main.rs:3671`) — Per-bar sin computation, called during chat mode in the ops panel.

6. **Double draw on mode transitions** (`main.rs:3907-3910`) — When transitioning from Intro to Chat, there's a `clear()` + `draw()` + another `draw()` (line 3910 runs unconditionally after the transition block). The second draw is redundant.

7. **Frame rate adaptation** — On slow hardware, 60fps is wasteful. Consider:
   - Adaptive frame rate: measure draw time, if > 14ms, increase sleep
   - Or simply use 30fps (`sleep(33ms)`) — most TUI content doesn't benefit from 60fps
   - During Intro (heavy), use 24fps; during Chat (light), use 30fps

8. **`sysmon` polling** — `sysinfo` crate's `refresh_*` methods can be expensive. Check that `SysMonitor::tick()` only refreshes on a timer (every 1-2 seconds), not every frame. Location: `asciivision-core/src/sysmon.rs`

**Quick wins:**
- Skip `render_background()` during `AppMode::Chat` (just use solid `panel_bg`)
- Remove double-draw on mode transition
- Drop to 30fps base rate
- Add `--skip-intro` to the sidecar launch command in `lib.rs` when running inside Tauri (the Tauri shell provides its own UI — the intro is less important)

### Priority 4: Animated Idle State (No Video)

When no video is loaded and the video panel is visible, show an animated placeholder instead of a blank panel. Ideas:
- Spinning wireframe ASCII cube (already exists in effects engine)
- Pulsing "NO SIGNAL" retro TV static pattern
- Rotating 3D ASCII text of "ASCIIVISION"
- Animated film reel / camera icon made of ASCII art

The effects engine (`effects.rs`) already has `EffectKind::WireframeCube` which would look great as a small spinning cube with "DROP A VIDEO" text underneath.

### Priority 5: Hands Mobile Access to Tiles (Remote Terminal)

The Hands mobile bridge currently supports chat, image/video/audio generation, and workspace file operations. Add the ability for a paired phone to access a **single terminal tile** — a PTY session they can type into and see output from, right in the mobile browser.

**Current Hands architecture:**
- `src-tauri/src/hands.rs` — The `HandsService` runs an Axum HTTP + WebSocket server
- Desktop connects via WebSocket, phone connects via HTTPS mobile pages at `/m/:machineId`
- Phone sends requests (chat, generate image, etc.) → relay forwards to desktop WebSocket → desktop executes → result sent back
- `src-tauri/src/terminal.rs` — PTY session management. `create_terminal()` spawns a new PTY, `write_terminal_input()` sends keystrokes, terminal output streams via `terminal://event` Tauri events

**Implementation approach:**
1. Add a new mobile page/route in Hands for "Terminal" (alongside existing Chat, Generate pages)
2. When phone requests a terminal session, the desktop spawns a new PTY via `create_terminal()`
3. Phone sends keystrokes via the relay → desktop writes to PTY
4. PTY output streams back through the relay WebSocket → rendered in the mobile browser
5. Use a simple monospace `<pre>` element on mobile (no full xterm.js needed for basic use)
6. Only expose **one tile** — no tiling layout on mobile, just a single terminal session
7. Security: terminal access should require the existing pairing code auth (already in place)

**Key files:**
- `src-tauri/src/hands.rs` — Add terminal route handlers and WebSocket relay for PTY I/O
- `src-tauri/src/terminal.rs` — Reuse existing `create_terminal()` and PTY infrastructure
- `hands-relay/src/server.js` — May need a new message type for terminal I/O forwarding

### Priority 6: Media Editor Auto-Categorization

When the Media Editor exports content, automatically save it into a dedicated "Media Editor" category folder in the appropriate gallery:

- **Image or video exports** → saved to the Image & Video gallery in a "Media Editor" category
- **Audio-only exports** (user only added audio clips, no image/video) → saved to the Voice & Audio gallery in a "Media Editor" category

**Current flow:**
- `src-tauri/src/editor.rs` — `export_timeline()` creates the output file and returns a `MediaAsset`
- `src-tauri/src/lib.rs` — `export_editor_timeline_command` calls `export_timeline()`, then inserts the asset into the DB via `insert_media_asset()`
- `src/store/appStore.ts` — `exportEditorTimeline()` calls the backend, then refreshes media assets/categories
- Categories are created via `create_media_category` and assets assigned via `category_id` field

**Implementation:**
1. In `export_editor_timeline_command` (lib.rs), before inserting the media asset:
   - Check if a "Media Editor" category exists; if not, create it
   - Determine if the export is audio-only by checking if all clips in `request.clips` have `kind == "audio"`
   - Set `asset.category_id` to the "Media Editor" category ID
2. The asset `kind` field already distinguishes "image"/"video"/"audio" — the frontend galleries filter by kind, so:
   - Audio assets with category "Media Editor" will appear in the Voice & Audio page
   - Image/video assets with category "Media Editor" will appear in the Image & Video page
3. The "Media Editor" category should be created once and reused for all subsequent exports

**Key files:**
- `src-tauri/src/lib.rs:~1263` — `export_editor_timeline_command`
- `src-tauri/src/editor.rs` — `export_timeline()` and `export_timeline_inner()`
- `src-tauri/src/db.rs` — Category CRUD operations (`insert_media_category`, `list_media_categories`)
- `src-tauri/src/types.rs` — `ExportEditorTimelineRequest`, `MediaAsset`, `MediaCategory`

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
| `src-tauri/src/terminal.rs` | PTY session management |
| `src/App.tsx` | Entire React frontend (~7K lines, single file) |
| `src/store/appStore.ts` | Zustand state management |
| `src/lib/tauri.ts` | IPC bridge to Rust backend |

### Key Rendering Pipeline (main.rs)

```
run_app() loop (line 3891):
  handle_input()           — polls crossterm events (10ms timeout)
  tick()                   — updates video, games, reveals, sysmon
  terminal.draw(render)    — ratatui diff-based rendering
  sleep(16ms)              — 60fps target

render() (line 2140):
  render_background()      — full-screen gradient fill (EXPENSIVE)
  match mode:
    Intro  → render_intro()   — video + logo + starburst + raster bars + scroller
    Chat   → render_chat()    — header + tiled panels + input + scroller
    Exit   → nothing

render_intro() (line 2151):
  outer border (Double)
  render_raster_bars()     — animated horizontal color bars
  video.render()           — FFmpeg ASCII frame (EXPENSIVE)
  render_starburst()       — animated ray burst
  render_logo()            — ASCII art title with 3D gradient
  info panel (boot note)
  render_scroller()        — horizontal ticker text
```

---

## Files Changed This Session

```
README.md                    — Cross-platform docs, Ollama, Render relay, troubleshooting
install-linux.sh             — NEW: Full Linux installer with pango fix, libssl, cargo env
build-asciivision.sh         — Linux libclang/pkg-config detection
src-tauri/Cargo.toml         — Platform-conditional keyring features
src-tauri/tauri.conf.json    — Added localhost:11434 to CSP
src-tauri/src/types.rs       — ProviderId::Ollama variant
src-tauri/src/providers.rs   — Ollama: model listing, streaming, image gen, availability
src-tauri/src/agent.rs       — Configurable endpoint_url for Ollama agent mode
src-tauri/src/lib.rs         — Ollama routing in send_message, send_agent_message, provider_status, sidecar triple fix
src-tauri/src/editor.rs      — Added /usr/bin/ffmpeg to path resolution
src/types.ts                 — ProviderId union includes "ollama"
src/lib/tauri.ts             — listOllamaModels() API
src/store/appStore.ts        — Provider switching, Ollama models, pickModel
src/App.tsx                  — Ollama buttons in Chat + IDE + Imagine pages
asciivision-core/src/main.rs — Upgraded intro logo art and render_logo() 3D effects
```

## Important Notes

- The app is **not code-signed** — macOS users need `xattr -cr` on first launch, Linux users may need to mark the AppImage as executable
- Ollama image generation (`x/flux2-klein`) is **macOS only** (Ollama limitation as of Jan 2026). On Linux it shows greyed out
- The Jetson Orin Nano successfully builds and runs the full app but ASCIIVision TUI is sluggish — optimization is the #1 priority for next session
- `qwen3.5:2b` is the recommended Ollama model — small enough for modest hardware, supports tool use for agent mode
- This project matters to the user. It's their main creative project. Treat it with care and put real thought into making it great.
