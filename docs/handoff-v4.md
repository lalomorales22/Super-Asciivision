# Handoff v4: Super ASCIIVision

> Created 2026-03-18 — context handoff for the next Claude session.
> Previous handoff: `docs/handoff-v3.md`
>
> **This session's focus:** Rebrand from "Grok Desktop" to "Super ASCIIVision", then optimize the entire app for speed, efficiency, and security.

---

## Project Location

```
/Users/megabrain2/Desktop/grok-desktop-asciivision/
```

**GitHub repo:** `github.com/lalomorales22/grok-desktop-asciivision`

---

## What This Project Is

A unified macOS desktop app merging a **Tauri 2 / React / Rust GUI shell** (xAI chat, media generation, music player, IDE, terminal tiles, mobile bridge) and **ASCIIVision** (pure Rust ratatui terminal app — multi-AI chat, ASCII video, webcam, 3D effects, games, system monitoring) into a single window.

The GUI shell is currently named "Grok Desktop" throughout the codebase. **This session will rebrand it to "Super ASCIIVision"** (see rebrand section below).

Click the rainbow **ASCIIVISION** button in the nav bar to drop into the terminal experience. Press **Ctrl+Esc** or click **BACK TO GROK** to return.

---

## Current State — Everything Works

All bugs from v3 are fixed. All features are functional:

- Chat with xAI models (streamed responses)
- Imagine page (image + video generation via xAI)
- Voice & Audio page (TTS + realtime voice)
- Media Editor page (timeline export via ffmpeg)
- Music Player (mini-player bar + full page, folder picker, metadata via lofty crate)
- IDE page (workspace indexing, file editing)
- Tiles page (1x2 / 2x2 / 3x3 terminal grids, sessions persist across layout changes)
- Hands mobile bridge (relay or Cloudflare tunnel)
- ASCIIVision inline panel (xterm.js PTY, responsive video, all keybinds work)
- Window dragging + close/minimize (Tauri 2 capabilities)
- Imagine/Voice lazy loading (IntersectionObserver + preview cache + debounced hover)
- Tiles shell prompt replay (early output buffer in Rust)
- `install.sh`, `build-asciivision.sh`, `npm run tauri build` all verified working
- TypeScript and Rust compile with zero errors

---

## TASK 1: REBRAND — "Grok Desktop" → "Super ASCIIVision"

### Why
Cannot use the name "Grok Desktop" for legal reasons. The new name is **Super ASCIIVision**.

### New Icon
The app icon should be the letters **sA** — lowercase `s` in white, uppercase `A` glowing (bright/neon glow effect). Clean, simple, dark background.

- Current icon location: `src-tauri/icons/` (contains icon.png, icon.icns, various sizes)
- Tauri uses the icons in this directory for the app bundle, DMG, and dock icon
- Standard sizes needed: 32x32, 128x128, 256x256, 512x512, icon.icns (macOS bundle), icon.ico (Windows)
- Can generate programmatically or create a single high-res PNG and use `tauri icon` CLI to generate all sizes: `npx tauri icon src-tauri/icons/source-icon.png`

### What Needs to Change

**Rust / Tauri config:**

| File | What to change |
|------|----------------|
| `src-tauri/tauri.conf.json` | `productName`, `identifier` (currently `com.megabrain2.grokdesktop`), window `title` |
| `src-tauri/Cargo.toml` | `name`, `description` |
| `src-tauri/src/lib.rs` | `app_storage_dir()` returns `"GrokDesktop"` — change to `"SuperASCIIVision"` |
| `src-tauri/src/lib.rs` | Keychain service name `"com.megabrain2.grokdesktop"` in `MigratingSecretStore::new()` |
| `src-tauri/src/lib.rs` | `info!("Grok Desktop ready")` log message |
| `src-tauri/icons/` | Replace all icon files with new sA icon |

**Frontend:**

| File | What to change |
|------|----------------|
| `src/App.tsx` | TopBar logo text, any "Grok Desktop" strings in UI text |
| `src/App.tsx` | The ASCIIVISION toggle button text "BACK TO GROK" → "BACK TO APP" or similar |
| `src/App.tsx` | Music page default folder description mentions "GrokDesktop" |
| `src/App.tsx` | Any footer or help text mentioning "Grok Desktop" |
| `package.json` | `name` field (currently `"grok-desktop"`) |
| `index.html` | `<title>` tag |

**Other files:**

| File | What to change |
|------|----------------|
| `README.md` | Title, all references to "Grok Desktop" |
| `docs/handoff-v3.md` | Historical — can leave as-is or update header |
| `install.sh` | `APP_NAME` variable, echo messages |
| `build-asciivision.sh` | No changes needed (builds asciivision binary, not the GUI) |
| `render.yaml` | If it references the app name |
| `LICENSE` | No changes needed |

**Important migration note:** The `app_storage_dir()` change means existing user data at `~/Library/Application Support/GrokDesktop/` won't be found at the new path. Consider adding a one-time migration: if old dir exists and new dir doesn't, move/symlink it. Same for the Keychain entry — the old service name won't match, so API keys would need to be re-entered unless a migration reads from the old keychain entry.

### Search commands to find all occurrences

```bash
# Find all "Grok Desktop" / "grok-desktop" / "grokdesktop" / "GrokDesktop" references
rg -i "grok.?desktop" --type-add 'config:*.{json,toml,yaml,yml}' -t rust -t ts -t config -t md -t html
```

---

## TASK 2: OPTIMIZE FOR SPEED, EFFICIENCY & SECURITY

### Speed & Efficiency Issues to Investigate

#### Frontend

1. **Monolithic App.tsx (~6,500 lines)** — Every page component is in one file. React re-renders the entire tree on any state change. Consider:
   - Code-splitting pages into separate files with `React.lazy()` + `Suspense`
   - Memoizing heavy components with `React.memo()`
   - Auditing Zustand selectors — each `useAppStore((state) => state.X)` should select the minimum needed

2. **All media assets loaded at boot** — `initialize()` in `appStore.ts` calls `api.listMediaAssets()` unconditionally. Should defer to when Imagine/Voice pages are first visited.

3. **No virtual scrolling** — Imagine/Voice galleries render all assets in a flat `.map()`. With 100+ assets, DOM gets heavy. Add `react-window` or `react-virtuoso`.

4. **Music library scan is synchronous** — `list_music_files` blocks the Tauri command thread while walking the filesystem. Should use `tokio::task::spawn_blocking` or return results incrementally.

5. **xterm.js bundle size** — `vendor-terminal` chunk is 284KB gzipped. Consider lazy-loading xterm only when a terminal page is visited.

6. **Highlight.js loads 13 languages at boot** — All registered in the module top-level. Could lazy-register or use a lighter syntax highlighter.

#### Backend (Rust)

7. **`read_media_data_url` reads entire files** — Reads full image/video into memory, base64-encodes it, sends it over IPC. For large videos this can be hundreds of MB. Consider:
   - Generating thumbnails on the Rust side (e.g., extract first frame for videos)
   - Using the asset protocol directly instead of base64 data URLs
   - Streaming or pagination for large files

8. **SQLite operations are synchronous** — All `rusqlite` calls happen on the Tauri command thread. Consider using `tokio::task::spawn_blocking` for heavy DB operations.

9. **Terminal early buffer never stops growing** — The `EARLY_BUFFER_CAP` (16KB) limits size, but the buffer is never cleared until `drain_early_buffer` is called. If the frontend never calls drain, the buffer stays in memory. Should auto-clear after a timeout or after first drain.

10. **No connection pooling for reqwest** — A new `reqwest::Client` is created at startup but check if it's shared properly across all API calls.

### Security Issues to Audit

11. **CSP audit** — Current CSP has `'unsafe-inline'` for both `script-src` and `style-src`. Tailwind CSS requires `style-src 'unsafe-inline'` but `script-src 'unsafe-inline'` should be tightened if possible.

12. **API key storage** — xAI key is in macOS Keychain (good). ASCIIVision keys are in a plaintext `.env` file (less good). Consider migrating ASCIIVision keys to Keychain too.

13. **`read_media_data_url` path traversal** — Currently validates that the path is within the app media directory. Verify this check is robust against symlink attacks and canonicalization bypasses.

14. **Hands relay security** — All traffic through the relay is plaintext (documented). Consider adding E2E encryption or at minimum TLS verification.

15. **Terminal command injection** — PTY sessions run with the user's shell. Verify that `writeTerminalInput` doesn't allow any escape sequences that could break out of the PTY or inject commands.

16. **`validate_workspace_file_path`** — Verify this can't be bypassed to read/write files outside workspace roots (symlink following, `..` traversal, etc.).

17. **IPC command access** — All Tauri commands are accessible from the webview. Verify no command can be abused if called with unexpected arguments.

18. **Dependencies audit** — Run `cargo audit` and `npm audit` to check for known vulnerabilities in the dependency tree.

19. **Music folder scan** — `list_music_files` follows the filesystem wherever the user points it. The `walkdir` max depth is 5 which is good. Verify it doesn't follow symlinks into sensitive directories (it has `follow_links: false` — good).

20. **`reveal_music_folder` command injection** — Uses `std::process::Command::new("open").arg(&folder_path)`. The `arg()` method is safe against shell injection, but verify the path can't be crafted to execute something unexpected.

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
| Tauri icons | `src-tauri/icons/` |
| ASCIIVision source | `asciivision-core/src/` (18 .rs files, ~11K lines) |
| ASCIIVision video player | `asciivision-core/src/video.rs` |
| ASCIIVision main | `asciivision-core/src/main.rs` |
| ASCIIVision games | `asciivision-core/src/games.rs` |
| Demo videos | `asciivision-core/demo-videos/` |
| Build script | `build-asciivision.sh` |
| Install script | `install.sh` |

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

### Validation
```bash
npx tsc --noEmit           # TypeScript check
cd src-tauri && cargo check # Rust check (Tauri app)
cd ../asciivision-core && cargo check  # Rust check (ASCIIVision)
npm test                    # Unit tests
npm run build               # Full frontend build (tsc + vite)
```

---

## React StrictMode Pattern

Multiple components use async `listen()` from `@tauri-apps/api/event`. In React 18 StrictMode, effects double-fire. The established fix:

```typescript
let disposed = false;
const unlisten = await listen("terminal://event", ({ payload }) => {
  if (disposed) return;
  // ... process event
});
if (disposed) { unlisten(); return; }
unlistenFn = unlisten;
return () => { disposed = true; unlistenFn?.(); };
```

Never put inline callbacks in useEffect dependency arrays — use refs instead.

---

## Architecture Quick Reference

### GUI Shell ↔ ASCIIVision
1. User clicks ASCIIVISION button → `setAsciivisionActive(true)`
2. Grid hides sidebars/footer, backgrounds go black
3. `<AsciiVisionPanel>` renders inline, spawns PTY via Rust sidecar
4. PTY output → Tauri events → xterm.js; keyboard → PTY stdin
5. Toggle button or Ctrl+Esc → kills PTY, returns to GUI shell

### Music Player
1. `refreshMusicLibrary()` → Rust scans folder with `lofty` metadata extraction
2. Track list in Zustand → user clicks track → `<audio>` loads via `convertFileSrc()`
3. MusicMiniPlayer (48px row) persists across pages when a track is selected

### Hands Security
- Relay URL: user-configured, stored in local SQLite, defaults to None
- Machine ID + Desktop Token: random UUIDs, local only
- No hardcoded relay URLs in codebase
