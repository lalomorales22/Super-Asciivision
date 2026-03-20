# Handoff v3: grok-desktop-asciivision

> Created 2026-03-17 — context handoff for the next Claude session.
> Previous handoff: `docs/handoff-v2.md`

---

## Project Location

```
/Users/megabrain2/Desktop/grok-desktop-asciivision/
```

**GitHub repo:** `github.com/lalomorales22/grok-desktop-asciivision`

---

## What This Project Is

A unified macOS desktop app merging **Grok Desktop** (Tauri 2 / React / Rust — xAI chat, media gen, IDE, terminal tiles, mobile bridge) and **ASCIIVision** (pure Rust terminal app / ratatui — multi-AI chat, video, webcam, 3D effects, OpenTUI games, system monitoring) into a single window.

Click the rainbow **ASCIIVISION** button in the top-right nav bar to load ASCIIVision into the main content area below the TopBar. The Grok Desktop chrome (logo, nav tabs, settings) stays visible. Click the button again (now reads "BACK TO GROK") or any nav tab to return.

---

## What Was Done in the Previous Session (v2)

### Bugs Fixed

1. **Terminal bleed (Bug #1)** — ASCIIVision output was leaking into the footer terminal. Changed the `onTerminal` store handler from a denylist to a strict allowlist: `if (event.sessionId !== footerSessionId) return`. Also fixed AsciiVisionOverlay cleanup ordering (remove listener → kill PTY → dispose xterm).
   - **Files:** `src/store/appStore.ts:292-300`, `src/App.tsx` AsciiVisionPanel cleanup

2. **DMG hidden icon (Bug #2)** — Sidecar binary was visible in the DMG window. Added `bundle.macOS.dmg` config with window size and icon positions.
   - **File:** `src-tauri/tauri.conf.json:44-48`

3. **Tiles session persistence (Bug #3)** — Terminal sessions were killed and respawned on every layout change. Rewrote `TilesPage` to use a `sessionsRef` that persists across layout changes — only spawns the difference on upsize, kills excess on downsize.
   - **File:** `src/App.tsx` TilesPage function

4. **Tiles triple-typing** — React StrictMode caused async `listen()` to leak event listeners (mounted before cleanup could capture the unlisten function). Added `disposed` flag pattern: listener callback checks `if (disposed) return`, and after `listen()` resolves, if `disposed` is true, immediately calls `unlisten()`.
   - **File:** `src/App.tsx` TileTerminal function

5. **Hands media not showing in Imagine** — The `onHands` event handler in the store never called `refreshMediaAssets()`. Added `refreshMediaAssets()` and `refreshMediaCategories()` calls. Also added "Open in Imagine" button on each Hands-generated asset that navigates to the Imagine page.
   - **Files:** `src/store/appStore.ts:333-337`, `src/App.tsx` HandsPage (threaded `onNavigate` through CenterStage)

6. **ASCIIVision stuck on "Launching"** — Two root causes:
   - The main `useEffect` depended on `[onClose]`, an inline arrow function. Every parent re-render created a new reference, triggering effect cleanup (kills PTY) + re-launch in an infinite loop. Fixed by using `onCloseRef` (a ref that always holds the latest callback) and `[]` dependency.
   - Also applied the same `disposed` flag pattern from TileTerminal to prevent StrictMode listener leaks.
   - **File:** `src/App.tsx` AsciiVisionPanel function

7. **Demo video not playing** — The CWD logic in `create_asciivision_session()` didn't find `demo-videos/` when the binary was in `src-tauri/target/debug/`. Added `project_root/asciivision-core/` as a CWD candidate.
   - **File:** `src-tauri/src/terminal.rs:295-325`

### UI Changes

8. **ASCIIVision inline panel** — Converted from a full-screen `createPortal` overlay to an inline panel that renders inside the Grok Desktop grid. The TopBar stays visible with logo, nav tabs (dimmed), and the ASCIIVISION button (toggles to "BACK TO GROK" when active). Sidebars and footer terminal hide when ASCIIVision is active.
   - **File:** `src/App.tsx` — GrokShell grid logic, TopBar props, AsciiVisionPanel component

9. **Black background for ASCIIVision** — When ASCIIVision is active, the main grid, TopBar, and content section all switch to pure `bg-black` (no teal/blue gradient tint).
   - **File:** `src/App.tsx` — conditional `clsx()` on grid, TopBar, and section backgrounds

---

## What Was Done in This Session (v3) — 2026-03-18

All four bugs and the music player feature request from the v3 handoff have been completed.

### Bug Fixes

#### ~~PERFORMANCE ISSUE~~ — FIXED: Imagine & Voice/Audio Pages Are Slow

Implemented the top 3 recommended fixes:

1. **IntersectionObserver on MediaAssetCard** — Cards only call `readMediaDataUrl` when they enter the viewport (+ 200px buffer). Previously all cards loaded eagerly on mount.
   - **File:** `src/App.tsx` MediaAssetCard — added `isVisible` state + IntersectionObserver useEffect

2. **Module-level preview cache** — `_mediaPreviewCache` (Map<filePath, dataUrl>) persists across re-renders and page navigations. No re-fetching when returning to Imagine/Voice pages.
   - **File:** `src/App.tsx` — `const _mediaPreviewCache = new Map<string, string>()` above MediaAssetCard

3. **Debounced hover previews** — 150ms delay via `setTimeout` before showing the hover portal, preventing layout thrashing from rapid `getBoundingClientRect()` calls when mousing across the gallery.
   - **File:** `src/App.tsx` MediaAssetCard — `hoverTimerRef` + debounced `handleMouseEnter`/`handleMouseLeave`

**Not done (lower priority):** Virtual scrolling (item 2) and lazy boot loading (item 5). These only matter at 100+ assets and can be added later with `react-window` or `react-virtuoso`.

#### ~~VIDEO PLAYER DOESN'T FIT THE WINDOW~~ — FIXED

Replaced hardcoded `(132, 46)` decode size with `crossterm::terminal::size()` at both video player creation points. Subtracts border/chrome space and clamps to a minimum of (40, 20).

- **File:** `asciivision-core/src/main.rs:384` — local video player now uses terminal size
- **File:** `asciivision-core/src/main.rs:1039` — YouTube video player now uses terminal size

**Not done:** Dynamic resize during playback (rebuilding the FFmpeg scaler). This would require a `resize()` method on `VideoPlayer` that restarts the decode thread. The current fix handles the common case — the video matches the terminal size at launch.

#### ~~WINDOW CANNOT BE MOVED / CLOSE & MINIMIZE BROKEN~~ — FIXED

Root cause: Missing Tauri 2 window permissions in capabilities. The `core:default` permission set does not include window manipulation operations like `startDragging()`, `close()`, or `minimize()`.

Added explicit permissions to `src-tauri/capabilities/default.json`:
- `core:window:allow-close`
- `core:window:allow-minimize`
- `core:window:allow-start-dragging`
- `core:window:allow-set-focus`

#### ~~TILES TERMINALS DON'T SHOW SHELL PROMPT~~ — FIXED

Implemented approach #1 from the handoff (buffer early output on the Rust side):

1. **Rust — early output buffer:** Added `early_buffer: Arc<Mutex<Vec<u8>>>` field to `TerminalSession`. Modified `spawn_reader()` to capture the first 16KB of PTY output into this buffer alongside emitting events.
   - **File:** `src-tauri/src/terminal.rs` — `EARLY_BUFFER_CAP`, modified `TerminalSession`, modified `spawn_reader()`

2. **Rust — drain command:** Added `drain_early_buffer()` function and `get_terminal_buffer` Tauri command that returns and clears the buffered data.
   - **Files:** `src-tauri/src/terminal.rs`, `src-tauri/src/lib.rs`

3. **Frontend — replay:** After the event listener is registered in `TileTerminal`, calls `api.getTerminalBuffer(sessionId)` and writes the result to xterm. This replays the shell prompt that was emitted before the listener was ready.
   - **Files:** `src/App.tsx` TileTerminal, `src/lib/tauri.ts`

ASCIIVision sessions pass `None` for the early buffer (they don't need it — the AsciiVisionPanel already has its own `earlyBuffer` mechanism).

### New Feature: Music Player (Option C)

Implemented the full Option C design: persistent mini-player bar + full Music page.

**Backend (Rust):**
- `list_music_files` command: recursively scans a folder for audio files (.mp3, .wav, .ogg, .flac, .m4a, .aac, .opus, .wma). Default folder: `~/Music/GrokDesktop/`
- `read_music_metadata()`: extracts title, artist, album, duration, and cover art (base64 data URL) using the `lofty` crate
- `get_default_music_folder` command: returns the default music directory path
- `reveal_music_folder` command: opens the folder in Finder
- **Files:** `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` (added `lofty = "0.22"`)

**Store (Zustand):**
- State: `musicTracks`, `musicCurrentIndex`, `musicPlaying`, `musicShuffleEnabled`, `musicRepeatMode`, `musicVolume`, `musicFolderPath`
- Actions: `refreshMusicLibrary`, `setMusicPlaying`, `setMusicCurrentIndex`, `setMusicShuffle`, `setMusicRepeatMode`, `setMusicVolume`, `musicNext`, `musicPrevious`, `setMusicFolder`
- Shuffle and repeat (off/all/one) logic in `musicNext`/`musicPrevious`
- **File:** `src/store/appStore.ts`

**Frontend (React):**
- **MusicPage** — full page with album art, transport controls (play/pause/skip/shuffle/repeat), volume slider, searchable playlist
- **MusicMiniPlayer** — 48px bar above the footer terminal, always visible when a track is selected. Cover art, track info, transport controls, seekable progress bar, volume
- **"Open Folder" button** — native folder picker dialog to scan any folder for music
- **"Show in Finder" button** — reveals the music directory so users can drag files in
- **MUSIC nav tab** in TopBar
- HTML5 `<audio>` with `convertFileSrc()` for playback — no Rust audio libraries needed
- **File:** `src/App.tsx` — MusicMiniPlayer, MusicPage, TopBar nav tab, GrokShell grid row

**Config:**
- CSP updated with `media-src` for `asset:` protocol
- `MusicTrack` type added to `src/types.ts`
- API methods added to `src/lib/tauri.ts`
- **Files:** `src-tauri/tauri.conf.json`, `src/types.ts`, `src/lib/tauri.ts`

---

## Key File Locations

| What | Path |
|------|------|
| React frontend entry | `src/App.tsx` (~6,500 lines, monolithic) |
| ASCIIVision inline panel | `src/App.tsx` → `function AsciiVisionPanel` |
| Music player page | `src/App.tsx` → `function MusicPage` |
| Music mini-player bar | `src/App.tsx` → `function MusicMiniPlayer` |
| Media preview cache | `src/App.tsx` → `_mediaPreviewCache` (module-level Map) |
| Rainbow toggle button | `src/App.tsx` → TopBar → `onToggleAsciivision` |
| Rainbow button CSS | `src/styles.css` → bottom of file |
| Tauri API bridge | `src/lib/tauri.ts` |
| Zustand store | `src/store/appStore.ts` |
| TypeScript types | `src/types.ts` |
| Rust commands (Tauri) | `src-tauri/src/lib.rs` (~1,600 lines) |
| PTY terminal management | `src-tauri/src/terminal.rs` |
| Hands mobile bridge | `src-tauri/src/hands.rs` (~1,500 lines) |
| Tauri config | `src-tauri/tauri.conf.json` |
| Tauri capabilities | `src-tauri/capabilities/default.json` |
| ASCIIVision source | `asciivision-core/src/` (18 .rs files, ~11K lines) |
| ASCIIVision games | `asciivision-core/src/games.rs` |
| OpenTUI game scripts | `asciivision-core/games/{PacMan,Space-Invaders,3d-penguin}/index.ts` |
| Demo videos | `asciivision-core/demo-videos/` |
| Build script | `build-asciivision.sh` |
| Install script | `install.sh` |

---

## Current State — What Works

- Grok Desktop fully functional (chat, imagine, voice, media editor, IDE, hands)
- **Music player** with mini-player bar, full playlist page, folder picker, metadata display
- ASCIIVision loads inline below the TopBar with black background
- Demo intro video plays on launch, **scaled to terminal size** (no longer hardcoded)
- Rainbow/galaxy animated button toggles ASCIIVision on/off
- Nav tabs dim when ASCIIVision is active, clicking any tab exits back to Grok
- Ctrl+Esc exits ASCIIVision
- **Window dragging works** (close and minimize buttons functional)
- **Tiles terminals show shell prompt** (early output buffer replay)
- Tiles terminal sessions persist across layout changes
- No terminal bleed between ASCIIVision/Tiles and footer terminal
- **Imagine/Voice pages load fast** (lazy loading, preview cache, debounced hover)
- Hands-generated media appears in Imagine page automatically
- "Open in Imagine" button on Hands page assets
- React StrictMode listener leaks fixed in TileTerminal and AsciiVisionPanel
- `install.sh` and `build-asciivision.sh` verified working
- README updated with all features

---

## Remaining Ideas / Future Work

These are **not bugs** — everything currently works. These are enhancement ideas for future sessions:

1. **Virtual scrolling for Imagine/Voice galleries** — Add `react-window` or `react-virtuoso` if asset counts grow past ~100. The IntersectionObserver + cache fix handles typical usage well.

2. **Dynamic video resize** — Currently the video decode size is set at startup. Adding a `VideoPlayer::resize()` method that rebuilds the FFmpeg scaler on terminal resize would handle dynamic window resizing during playback.

3. **Music enhancements:**
   - ASCII audio visualizer in ASCIIVision (Web Audio API `AnalyserNode` → FFT bars)
   - Drag-and-drop MP3 files onto the app
   - Keyboard shortcuts (Space = play/pause, N/P = next/prev)
   - Grok DJ mode (AI-generated playlists)
   - Persist music folder path in Settings/SQLite

4. **Lazy asset loading at boot** — `initialize()` in appStore loads all media assets at startup. Could defer to when Imagine/Voice pages are first visited.

---

## Build & Run

```bash
cd /Users/megabrain2/Desktop/grok-desktop-asciivision

# Install frontend deps
npm install

# Build asciivision binary + copy to sidecar
./build-asciivision.sh

# Development
npm run tauri dev

# Production build
npm run tauri build
```

After `cargo clean`, the first build compiles ~525 crates and takes several minutes.

### Requirements
- macOS, Node.js 20+, Rust stable, FFmpeg, LLVM/libclang, pkg-config
- Bun (for OpenTUI games): `curl -fsSL https://bun.sh/install | bash`

---

## React StrictMode Pattern

Multiple components in this app use async `listen()` from `@tauri-apps/api/event`. In React 18 StrictMode (enabled in `src/main.tsx`), effects double-fire: mount → cleanup → mount. If `listen()` hasn't resolved when cleanup runs, the listener leaks.

**Established fix pattern** (used in TileTerminal and AsciiVisionPanel):
```typescript
let disposed = false;
// ...
const unlisten = await listen("terminal://event", ({ payload }) => {
  if (disposed) return;  // Guard against leaked listener
  // ... process event
});
if (disposed) {
  unlisten();  // Clean up immediately if component already unmounted
  return;
}
unlistenFn = unlisten;
// ...
return () => {
  disposed = true;
  unlistenFn?.();
  // ... other cleanup
};
```

Also: **never put inline arrow function callbacks in useEffect dependency arrays**. Use a ref pattern instead:
```typescript
const onCloseRef = useRef(onClose);
onCloseRef.current = onClose;
// useEffect depends on [] not [onClose]
```

---

## Architecture Quick Reference

### ASCIIVision Integration Flow
1. User clicks ASCIIVISION button → `setAsciivisionActive(true)`
2. Grid layout adjusts: sidebars/footer hidden, backgrounds go black
3. `<AsciiVisionPanel>` renders inline in the content section
4. Effect runs: registers `listen("terminal://event")`, calls `api.launchAsciivision()`
5. Rust finds asciivision binary (sidecar → dev build), spawns in PTY
6. PTY output → Tauri events → JS listener → `terminal.write()` in xterm.js
7. Keyboard input → xterm.js `onData` → `api.writeTerminalInput()` → PTY stdin
8. Toggle button or Ctrl+Esc → cleanup kills PTY, `setAsciivisionActive(false)`

### Music Player Flow
1. User navigates to Music page (or first track selected) → `refreshMusicLibrary()`
2. Rust scans folder recursively, extracts metadata with `lofty` crate
3. Track list stored in Zustand store
4. User clicks track → `setMusicCurrentIndex(idx)` → `<audio>` element loads via `convertFileSrc()`
5. MusicMiniPlayer bar appears in grid (48px row), persists across all pages
6. Transport controls update store state → `<audio>` element reacts

### Hands Security Model
- Relay URL: user-configured, stored in local SQLite, defaults to None
- Machine ID + Desktop Token: random UUIDs, local only
- No hardcoded relay URLs in codebase
