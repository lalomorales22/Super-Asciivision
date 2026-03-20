# Handoff v5: Super ASCIIVision

> Created 2026-03-18 — context handoff for the next Claude session.
> Previous handoff: `docs/handoff-v4.md`
>
> **This session's focus:** Fix outstanding bugs, then implement new features listed below.

---

## Project Location

```
/Users/megabrain2/Desktop/Super-Asciivision/
```

**GitHub repo:** `github.com/lalomorales22/grok-desktop-asciivision`

---

## What This Project Is

A unified macOS desktop app called **Super ASCIIVision** (formerly "Grok Desktop"). Tauri 2 / React / Rust GUI shell (xAI chat, media generation, music player, IDE, terminal tiles, mobile bridge) + **ASCIIVision** (pure Rust ratatui terminal app — multi-AI chat, ASCII video, webcam, 3D effects, games, system monitoring).

Click the rainbow **ASCIIVISION** button in the nav bar to drop into the terminal experience. Press **Ctrl+Esc** or click **BACK TO APP** to return.

---

## What Was Done in v4 Session

### Rebrand: "Grok Desktop" → "Super ASCIIVision"

Every reference to "Grok Desktop" was renamed across the entire codebase:

| Area | Files changed |
|------|--------------|
| **Tauri config** | `src-tauri/tauri.conf.json` — productName, identifier (`com.megabrain2.superasciivision`), window title |
| **Rust Cargo** | `src-tauri/Cargo.toml` — package name (`super-asciivision`), lib name (`super_asciivision_lib`) |
| **Rust main** | `src-tauri/src/main.rs` — `super_asciivision_lib::run()` |
| **Rust lib** | `src-tauri/src/lib.rs` — storage dir (`SuperASCIIVision`), DB filename (`superasciivision.sqlite`), keychain service (`com.megabrain2.superasciivision`), log filter, ready message |
| **Rust providers** | `src-tauri/src/providers.rs` — system prompts |
| **Rust window** | `src-tauri/src/window.rs` — tray menu label |
| **Rust hands** | `src-tauri/src/hands.rs` — machine label, mobile page heading, storage dir |
| **Frontend** | `src/App.tsx` — ~30 UI string changes (TopBar, buttons, placeholders, prompts, settings) |
| **Frontend store** | `src/store/appStore.ts` — error messages |
| **Frontend CSS** | `src/styles.css` — `.grok-titlebar` → `.app-titlebar` |
| **Package** | `package.json` — name (`super-asciivision`) |
| **HTML** | `index.html` — `<title>` |
| **Info.plist** | `src-tauri/Info.plist` — microphone usage string |
| **Install script** | `install.sh` — APP_NAME, echo messages |
| **Relay** | `hands-relay/src/server.js` — machine labels, page headings |
| **Relay README** | `hands-relay/README.md` — all references |
| **README** | `README.md` — full rewrite with tables, architecture diagram |

**Migration code added** (these intentionally reference old names):
- `lib.rs:app_storage_dir()` — auto-renames `~/Library/Application Support/GrokDesktop/` → `SuperASCIIVision/`
- `lib.rs:run()` — renames `grokdesktop.sqlite` → `superasciivision.sqlite`
- `lib.rs:run()` — migrates Keychain entries from `com.megabrain2.grokdesktop` to new service

### New App Icon

- Source SVG: `src-tauri/icons/source-icon.svg` — "sA" with dark background
- All icon sizes regenerated: 32x32, 64x64, 128x128, 128x128@2x, icon.png, icon.icns, icon.ico, Square*.png, StoreLogo.png, android/*, ios/*
- In-app icon: `AppMark` component in `src/App.tsx` (~line 473) — inline SVG with rainbow gradient "A"
- Old `GrokMark` component removed, all references changed to `AppMark`

### Security Fixes

- `lib.rs:validate_workspace_file_path()` — non-canonical path fallback removed; now rejects paths where parent doesn't exist
- npm audit: 0 vulnerabilities
- cargo audit: 0 vulnerabilities (21 unmaintained warnings from Tauri's GTK deps, Linux-only)

### Performance Optimizations

- `lib.rs:list_music_files()` — moved to `tokio::task::spawn_blocking` (no longer blocks Tauri command thread)
- `appStore.ts:initialize()` — media assets/categories no longer loaded at boot; lazy-loaded via `ensureMediaLoaded()` when Imagine/Voice/Editor pages visited
- `terminal.rs` — early buffer auto-clears after drain (stops growing, frees memory); output only buffered OR emitted, not both (fixes double-prompt)

### Other Fixes

- Asset protocol enabled: `protocol-asset` feature added to Cargo.toml, `assetProtocol.scope` configured in tauri.conf.json with `$HOME/**` access
- Settings modal: changed from `fixed inset-0` to `absolute inset-0` with `rounded-[34px]` so it respects the window's rounded corners
- Tiles: added `mountId` to force fresh session spawning when re-entering the page
- Clear media: added `clear_all_media` Tauri command + "Clear media library" button in Settings
- Folder rename: project directory renamed from `grok-desktop-asciivision` to `Super-Asciivision`

---

## BUGS TO FIX (from user testing)

### 1. ASCIIVision won't launch — stuck on "Launching ASCIIVision" loading screen

The asciivision sidecar binary may not be built or not found at the expected path after the folder rename. Check:

- Run `./build-asciivision.sh` to rebuild the binary
- Check `src-tauri/src/lib.rs:launch_asciivision()` (~line 960) — it searches several candidate paths using `CARGO_MANIFEST_DIR`
- The `CARGO_MANIFEST_DIR` is baked in at compile time — after the folder rename, it points to the old path
- After a clean build (`cargo clean` + rebuild), `CARGO_MANIFEST_DIR` should update

**Files:** `src-tauri/src/lib.rs` (launch_asciivision), `build-asciivision.sh`

### 2. Voice & Audio — speech generation fails

Text-to-speech via `text_to_speech_command` is failing. Investigate:

- Check the xAI TTS endpoint and model in `src-tauri/src/providers.rs`
- The TTS function streams audio from the xAI API and saves to `media/audio/`
- Verify the API key is set (Settings → xAI key)
- Check browser console for error messages

**Files:** `src-tauri/src/providers.rs` (text_to_speech), `src/App.tsx` (VoiceAudioPage ~line 2507)

### 3. Music — "Open Folder" button not working, refresh does nothing

The folder picker dialog may not be opening. Check:

- `openDialog({ directory: true })` requires `dialog:default` permission — already in capabilities
- The `setMusicFolder` action in appStore calls `refreshMusicLibrary(path)` which calls `api.listMusicFiles(folderPath)`
- After folder rename, the default music dir changed to `~/Music/SuperASCIIVision/` — verify this directory exists
- The `list_music_files` command was made async with `spawn_blocking` — verify it still works correctly

**Files:** `src/App.tsx` (MusicPage ~line 5692, handleOpenFolder ~line 5735), `src/store/appStore.ts` (setMusicFolder ~line 1127), `src-tauri/src/lib.rs` (list_music_files ~line 1105)

### 4. Tiles — terminals don't persist when leaving and returning

Current behavior: sessions are killed on unmount, new ones spawned on re-mount. User wants **persistent terminals** that survive page navigation and only close when the app exits.

Fix approach:
- Move tile session state out of the TilesPage component and into the Zustand store (or a module-level ref)
- Don't kill sessions on unmount — keep them alive
- On re-mount, re-attach xterm.js instances to existing sessions
- Add a close confirmation dialog when quitting the app: "Are you sure? This will close all terminal sessions."

**Files:** `src/App.tsx` (TilesPage ~line 6003, TileTerminal ~line 6095), `src-tauri/src/terminal.rs`

### 5. Tiles — double prompt still showing

The spawn_reader fix (buffer-only during early phase, emit-only after drain) was applied in `terminal.rs` but may not have taken effect if the build cache wasn't cleared. After a clean build this should be resolved. If it persists, the issue may be in the frontend replay logic in TileTerminal.

**Files:** `src-tauri/src/terminal.rs` (spawn_reader ~line 229), `src/App.tsx` (TileTerminal ~line 6095)

---

## NEW FEATURES TO IMPLEMENT

### 6. Hands Relay URL field in Settings

Add a text input in the Settings page where the user can paste their Render relay URL. Currently the relay URL is set on the Hands page but it should also be accessible from Settings for convenience.

**Files:** `src/App.tsx` (SettingsSheet ~line 6546), `src/store/appStore.ts`, `src-tauri/src/hands.rs`

### 7. App close confirmation dialog

When the user clicks the close button (red dot), show a themed modal: "Are you sure? This will close all terminal sessions and unsaved work." with Cancel and Close buttons.

**Files:** `src/App.tsx` (TopBar close button ~line 1025), `src-tauri/src/window.rs`

### 8. ANSI color syntax highlighting in IDE code editor

The IDE page code editor currently uses highlight.js for syntax coloring. Add richer ANSI-style coloring to give the displayed code more terminal-like character. Could use a custom theme or enhanced highlight.js configuration.

**Files:** `src/App.tsx` (IdePage ~line 3049), highlight.js registration (~line 77-99)

### 9. Import media button in Media Editor

Add a button to the Media Editor page that lets the user import local audio, video, or image files into the editor timeline. Use the existing `import_local_media_command` Tauri command and file picker dialog.

**Files:** `src/App.tsx` (EditorPage ~line 4935), `src-tauri/src/lib.rs` (import_local_media_command ~line 375), `src/lib/tauri.ts` (importLocalMedia)

---

## Key File Locations

| What | Path |
|------|------|
| React frontend entry | `src/App.tsx` (~6,800 lines) |
| App icon component | `src/App.tsx` → `function AppMark` (~line 473) |
| ASCIIVision inline panel | `src/App.tsx` → `function AsciiVisionPanel` |
| Music player page | `src/App.tsx` → `function MusicPage` (~line 5692) |
| Music mini-player bar | `src/App.tsx` → `function MusicMiniPlayer` (~line 5549) |
| Tiles page | `src/App.tsx` → `function TilesPage` (~line 6003) |
| Tile terminal | `src/App.tsx` → `function TileTerminal` (~line 6095) |
| Settings sheet | `src/App.tsx` → `function SettingsSheet` (~line 6546) |
| Voice & Audio page | `src/App.tsx` → `function VoiceAudioPage` (~line 2507) |
| Imagine page | `src/App.tsx` → `function ImaginePage` (~line 1872) |
| IDE page | `src/App.tsx` → `function IdePage` (~line 3049) |
| Media Editor page | `src/App.tsx` → `function EditorPage` (~line 4935) |
| Hands page | `src/App.tsx` → `function HandsPage` (~line 4038) |
| Rainbow toggle button CSS | `src/styles.css` → bottom of file |
| Tauri API bridge | `src/lib/tauri.ts` |
| Zustand store | `src/store/appStore.ts` (~1,130 lines) |
| TypeScript types | `src/types.ts` |
| Rust commands (Tauri) | `src-tauri/src/lib.rs` (~1,690 lines) |
| PTY terminal management | `src-tauri/src/terminal.rs` |
| Hands mobile bridge | `src-tauri/src/hands.rs` (~1,500 lines) |
| Agent / tool use | `src-tauri/src/agent.rs` |
| xAI providers | `src-tauri/src/providers.rs` |
| Database (SQLite) | `src-tauri/src/db.rs` |
| Keychain + secrets | `src-tauri/src/keychain.rs` |
| Tauri config | `src-tauri/tauri.conf.json` |
| Tauri capabilities | `src-tauri/capabilities/default.json` |
| Tauri icons | `src-tauri/icons/` |
| ASCIIVision source | `asciivision-core/src/` (18 .rs files, ~11K lines) |
| Build script | `build-asciivision.sh` |
| Install script | `install.sh` |

---

## Build & Run

```bash
cd /Users/megabrain2/Desktop/Super-Asciivision

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
npx tsc --noEmit                        # TypeScript check
cd src-tauri && cargo check             # Rust check (Tauri app)
cd ../asciivision-core && cargo check   # Rust check (ASCIIVision)
npm test                                 # Frontend tests (1 test)
cd src-tauri && cargo test              # Backend tests (13 tests)
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
1. `refreshMusicLibrary()` → Rust scans folder with `lofty` metadata extraction (async via spawn_blocking)
2. Track list in Zustand → user clicks track → `<audio>` loads via `convertFileSrc()`
3. MusicMiniPlayer (48px row) persists across pages when a track is selected

### Terminal Early Buffer
1. spawn_reader captures PTY output to early buffer (does NOT emit events while buffering)
2. Frontend registers listener → calls `drain_early_buffer` → replays missed output
3. Buffer set to `None` after drain → all subsequent output flows through events only

### Media Lazy Loading
1. Boot: only settings, conversations, workspaces, provider status loaded
2. First visit to Imagine/Voice/Editor: `ensureMediaLoaded()` fetches categories + assets
3. `mediaLoaded` flag prevents redundant fetches

### Hands Security
- Relay URL: user-configured, stored in local SQLite, defaults to None
- Machine ID + Desktop Token: random UUIDs, local only
- No hardcoded relay URLs in codebase

### Asset Protocol
- Enabled via `protocol-asset` Tauri feature + `assetProtocol.scope` in tauri.conf.json
- Scope allows `$HOME/**` with `.ssh` and `.gnupg` denied
- Used by music player (`convertFileSrc`) and media previews
