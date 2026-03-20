# Handoff: grok-desktop-asciivision Integration

> Created 2026-03-17 — context handoff document for the next Claude session.

## What This Project Is

A unified desktop app that merges **Grok Desktop** (Tauri 2 / React / Rust) and **ASCIIVision** (pure Rust terminal app / ratatui) into a single window. The user clicks an "ASCIIVISION" button in the top-right nav bar, and ASCIIVision launches inside a full-screen xterm.js overlay. Ctrl+Esc or the "Back to Grok" button exits back to Grok Desktop.

**Neither original project was modified.** Everything lives in `/grok-desktop-asciivision/`, which was built from copies.

---

## Architecture Overview

```
grok-desktop-asciivision/
├── src/                        # React frontend (copied from Grok-Desktop, modified)
│   ├── App.tsx                 # MODIFIED: Added AsciiVisionOverlay component + button
│   ├── styles.css              # MODIFIED: Added rainbow button CSS + overlay xterm styles
│   └── lib/tauri.ts            # MODIFIED: Added launchAsciivision() API call
├── src-tauri/                  # Rust backend (copied from Grok-Desktop, modified)
│   ├── src/lib.rs              # MODIFIED: Added launch_asciivision command
│   ├── src/terminal.rs         # MODIFIED: Added create_asciivision_session()
│   ├── binaries/               # CREATED: Holds asciivision-{target-triple} sidecar
│   └── tauri.conf.json         # MODIFIED: externalBin, beforeBuildCommand, title
├── asciivision-core/           # Full ASCIIVision source (copied, unmodified)
│   ├── src/                    # 18 Rust source files (~11K lines)
│   ├── demo-videos/            # demo.mp4, demo2.mp4 (copied separately)
│   └── Cargo.toml
├── build-asciivision.sh        # CREATED: Builds asciivision + copies to binaries/
└── package.json                # MODIFIED: Added build:asciivision, build:all scripts
```

### How the integration works

1. **Button**: Rainbow/galaxy-styled "ASCIIVISION" button sits in the TopBar between Shell dropdown and Settings
2. **Click**: Sets `asciivisionActive` state → renders `<AsciiVisionOverlay />`
3. **Overlay**: Full-screen portal over entire app, with thin header bar + xterm.js terminal
4. **Backend**: `launch_asciivision` Tauri command finds the asciivision binary and spawns it in a PTY via `create_asciivision_session()`
5. **PTY**: The asciivision ratatui app runs in alternate screen mode inside the PTY. xterm.js renders its output with full color support (truecolor).
6. **CWD**: Set to asciivision-core root so it finds `demo-videos/demo.mp4` for the intro
7. **API keys**: Loaded from `.env` in asciivision-core dir, falling back to parent process env vars
8. **Resize**: ResizeObserver + window resize listener → fitAddon.fit() → `resize_terminal` Tauri command → PTY resize → ratatui picks up `Event::Resize`
9. **Exit**: Ctrl+Esc captured in JS keydown handler, or "Back to Grok" button. Kills PTY session on cleanup. Also auto-closes if asciivision process exits.

---

## Key Files & What Was Changed

### `src/App.tsx` (3 additions)
- **Line ~664**: `asciivisionActive` state in `GrokShell`
- **TopBar**: Added `onLaunchAsciivision` prop, rainbow button before Settings
- **`AsciiVisionOverlay` component** (~160 lines, before `TerminalPanel`): Full-screen portal with xterm.js, loading/error states, resize handling, Ctrl+Esc to exit

### `src/styles.css` (additions at end)
- `@keyframes asciivision-gradient` — shifting gradient for button + text
- `@keyframes asciivision-glow-pulse` — pulsing box-shadow
- `.asciivision-btn`, `.asciivision-btn-bg`, `.asciivision-btn-text` — layered rainbow button
- `.asciivision-title-text` — gradient text for overlay header
- `.fixed .xterm` overrides for proper fill

### `src/lib/tauri.ts`
- Added `launchAsciivision: () => invoke<TerminalHandle>("launch_asciivision")`

### `src-tauri/src/terminal.rs`
- Added `create_asciivision_session()` — spawns asciivision binary in PTY with:
  - CWD set to asciivision-core root (finds demo-videos/)
  - API key passthrough from .env file and parent env
  - Full truecolor terminal env vars

### `src-tauri/src/lib.rs`
- Added `launch_asciivision` command — binary discovery logic:
  1. Tauri sidecar path (next to binary, with target triple suffix)
  2. Next to binary (no suffix)
  3. Development: `asciivision-core/target/release/asciivision`
  4. Development: `asciivision-core/target/debug/asciivision`

### `src-tauri/tauri.conf.json`
- `externalBin: ["binaries/asciivision"]` for Tauri bundling
- `beforeBuildCommand: "npm run build:all"` to build both projects
- Window title: "Grok Desktop + ASCIIVision"

### `package.json`
- `build:asciivision`: runs `build-asciivision.sh`
- `build:all`: builds asciivision then frontend

---

## Known Issues & Things to Fix

### Sizing / Rendering
- **Font size tradeoff**: xterm.js uses fontSize 11 to fit more cols/rows. ASCIIVision's tiling layout was designed for a large terminal (~160+ cols). If the Grok Desktop window is small, panels may look cramped. Consider making font size dynamic based on window dimensions.
- **Initial resize race**: The PTY starts at 50x160 before xterm.js sends the real size. There's a multi-stage fit (requestAnimationFrame + setTimeout 100ms). If ASCIIVision still renders at wrong size initially, increase the delay or add a resize after first output chunk.
- **Intro video**: Plays from `demo-videos/demo.mp4` relative to CWD. If the binary is bundled as a sidecar, the CWD heuristic (walk up from binary dir) may not find it. For production builds, consider bundling demo-videos as a Tauri resource or making the video path configurable.

### Terminal Behavior
- **Scroll**: The xterm.js viewport has `overflow-y: hidden` in the overlay CSS to prevent scrollbar conflicts with ratatui's own scroll. If users need to scroll back in the asciivision transcript, this might need adjustment.
- **Keyboard capture**: All keyboard input goes to xterm.js → PTY when the overlay is active. Only Ctrl+Esc is intercepted for exit. ASCIIVision's own keybindings (F1-F10, Ctrl+hjkl, etc.) should work normally through the PTY.
- **Double-typing in dev mode**: React StrictMode causes effects to mount/unmount/remount. The terminal session is killed on unmount, which can cause a brief flicker. In production builds this doesn't happen.

### Build & Bundling
- **Sidecar binary size**: asciivision release binary is ~8.9MB. Consider stripping symbols (`strip = true` in Cargo.toml profile) to reduce.
- **FFmpeg dependency**: asciivision links against ffmpeg-next/ffmpeg-sys-next which requires ffmpeg libraries at runtime. The user needs ffmpeg installed. For a fully portable bundle, would need to statically link or bundle dylibs.
- **Cross-platform**: Currently macOS only (aarch64-apple-darwin). The build script gets target triple from `rustc -vV`. For universal macOS binary, would need to build for both aarch64 and x86_64.

### UX Polish Ideas
- **Transition animation**: Add a fade-in/zoom for the overlay appearing, and fade-out when closing
- **State persistence**: When closing ASCIIVision and reopening, it currently kills the process and starts fresh. Could keep the PTY alive in the background instead.
- **Shared API keys**: Grok Desktop stores xAI keys in macOS Keychain. ASCIIVision reads from .env. Could wire up the Keychain keys to pass as env vars to asciivision.
- **Theme sync**: ASCIIVision has its own theme system (F9/F10). The xterm.js theme is hardcoded. Could expose theme sync between them.

---

## How to Build & Run

```bash
cd grok-desktop-asciivision

# 1. Install frontend deps
npm install

# 2. Build asciivision binary + copy to sidecar location
./build-asciivision.sh

# 3. Run in development
npm run tauri dev

# 4. Build for production
npm run tauri build
```

### API Keys for ASCIIVision

Create `asciivision-core/.env`:
```
CLAUDE_API_KEY=sk-ant-...
GROK_API_KEY=xai-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
```

Or set them as environment variables before launching.

---

## What the User Wants Next

The user (megabrain2) is building an ambitious unified AI desktop app. They created Grok Desktop (full xAI integration) and ASCIIVision (terminal powerhouse with multi-provider AI, games, effects, video) separately and want them merged. This is the first iteration. Likely next steps:

- Polish the overlay experience (sizing, transitions, theme)
- Potentially deeper integration (shared conversations, shared API keys from Keychain)
- Mobile bridge (Hands) working with ASCIIVision
- Production builds & distribution

---

## File Line Counts (for orientation)

| File | Lines | Notes |
|------|-------|-------|
| `src/App.tsx` | ~5,900 + ~160 added | Monolithic React UI |
| `src-tauri/src/lib.rs` | ~1,380 | All Tauri commands |
| `src-tauri/src/terminal.rs` | ~380 | PTY management |
| `asciivision-core/src/main.rs` | ~3,920 | ASCIIVision app core |
| `asciivision-core/src/ai.rs` | ~1,632 | Multi-provider AI |
| `asciivision-core/src/games.rs` | ~1,442 | Pac-Man, Space Invaders, 3D Penguin |
| `src/styles.css` | ~250 | Includes new rainbow button CSS |
