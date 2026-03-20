# Handoff v2: grok-desktop-asciivision

> Created 2026-03-17 — context handoff for the next Claude session.
> Previous handoff: `docs/handoff-asciivision-integration.md`

---

## Project Location

```
/Users/megabrain2/Desktop/grok-desktop-asciivision/
```

**GitHub repo:** `github.com/lalomorales22/grok-desktop-asciivision`

---

## What This Project Is

A unified macOS desktop app merging **Grok Desktop** (Tauri 2 / React / Rust — xAI chat, media gen, IDE, terminal tiles, mobile bridge) and **ASCIIVision** (pure Rust terminal app / ratatui — multi-AI chat, video, webcam, 3D effects, OpenTUI games, system monitoring) into a single window.

Click the rainbow **ASCIIVISION** button in the top-right nav bar → full-screen xterm.js overlay running asciivision in a PTY. Ctrl+Esc or "Back to Grok" exits.

---

## Key File Locations

| What | Path |
|------|------|
| React frontend entry | `src/App.tsx` (~6,000 lines, monolithic) |
| ASCIIVision overlay component | `src/App.tsx` → search `function AsciiVisionOverlay` (~line 5591) |
| Rainbow button | `src/App.tsx` → search `asciivision-btn` in TopBar (~line 1080) |
| Rainbow button CSS | `src/styles.css` → bottom of file |
| Tauri API bridge | `src/lib/tauri.ts` |
| Zustand store | `src/store/appStore.ts` |
| Rust commands (Tauri) | `src-tauri/src/lib.rs` (~1,400 lines) |
| PTY terminal management | `src-tauri/src/terminal.rs` |
| Hands mobile bridge | `src-tauri/src/hands.rs` (~1,500 lines) |
| Tauri config | `src-tauri/tauri.conf.json` |
| ASCIIVision source | `asciivision-core/src/` (18 .rs files, ~11K lines) |
| ASCIIVision games | `asciivision-core/src/games.rs` (OpenTUI PTY + built-in fallback) |
| ASCIIVision tiles/PTY infra | `asciivision-core/src/tiles.rs` (public TerminalSession) |
| OpenTUI game scripts | `asciivision-core/games/{PacMan,Space-Invaders,3d-penguin}/index.ts` |
| Demo videos | `asciivision-core/demo-videos/` |
| Build script | `build-asciivision.sh` |
| Sidecar binary | `src-tauri/binaries/asciivision-aarch64-apple-darwin` |
| All markdown docs | `docs/` folder |

---

## Current State — What Works

- Grok Desktop fully functional (chat, imagine, voice, media editor, IDE, hands)
- ASCIIVision launches in full-screen xterm.js overlay with intro video
- Rainbow/galaxy animated button in nav bar
- OpenTUI 3D games integrated into asciivision (PTY-based, falls back to ASCII)
- Event listener race condition fixed (buffered early events, replay on session ID)
- Hands relay credentials verified safe (local SQLite only, no hardcoded URLs)
- Terminal session filtering added to prevent cross-session bleed

---

## ACTIVE BUGS TO FIX NEXT

### 1. Terminal Still Shows ASCIIVision Remnants (PARTIALLY FIXED)

**Status:** A filter was added to `src/store/appStore.ts` line 292 — the global `onTerminal` listener now checks `event.sessionId !== footerSessionId`. However the user reports some characters still leak through.

**Investigation needed:**
- The `TerminalPanel` component (`src/App.tsx` ~line 5831) reads from `terminalOutput` in the store. It uses a cursor-based append (`outputCursorRef`). If any asciivision output snuck into the buffer before the filter was applied (timing issue during app init), it would persist.
- The `TerminalPanel` also has its own `listen` setup in the xterm.js `TileTerminal` component (used by Tiles page) which does NOT filter — check `TileTerminal` (~line 5482).
- **Possible fix:** When the asciivision overlay closes, clear the footer terminal buffer (`clearTerminalOutput()` in store), or better: add a dedicated `asciivisionSessionId` to the store so the filter is explicit rather than relying on "not the footer session."
- **File:** `src/store/appStore.ts` line 292, `src/App.tsx` AsciiVisionOverlay cleanup function (~line 5726)

### 2. DMG Shows Hidden Icon File Behind App Icon

**Status:** Not yet fixed.

**Root cause:** The `externalBin` sidecar binary (`binaries/asciivision`) gets bundled into the DMG and shows as a visible file alongside the `.app` bundle.

**Fix options:**
- Add a DMG configuration in `src-tauri/tauri.conf.json` under `bundle.macOS.dmg` to control the DMG window layout and hide extra files
- Or use a `.dmg-background` image and window settings to position only the .app
- Tauri 2 supports `bundle.macOS.dmg.windowSize`, `bundle.macOS.dmg.appPosition`, `bundle.macOS.dmg.applicationFolderPosition` settings
- Check Tauri docs: https://v2.tauri.app/reference/config/#dmgconfig
- The sidecar binary should still be bundled but hidden in the DMG view

**File:** `src-tauri/tauri.conf.json` → `bundle` section

### 3. Tiles Terminal Sessions Don't Persist on Layout Change

**Status:** Not yet fixed. This is a Grok Desktop bug (pre-existing, not caused by our changes).

**Problem:** When user starts terminals in 1x2 layout and switches to 2x2, all existing terminals are killed and new ones are spawned. Should keep existing sessions and add new ones.

**Root cause:** The `TilesPage` component (`src/App.tsx` ~line 5409) has a `useEffect` that runs when `layout` changes. It kills ALL spawned sessions and creates new ones from scratch:
```typescript
useEffect(() => {
  // ... spawns `layout` new terminals
  return () => {
    // kills ALL terminals in spawned[]
    for (const sid of spawned) {
      void api.killTerminal(sid);
    }
  };
}, [layout]);  // ← re-runs on layout change, kills everything
```

**Fix approach:**
- Track sessions in a ref that persists across layout changes
- On layout change: keep existing sessions, only spawn the difference
- If downsizing (e.g., 2x2 → 1x2), kill the excess sessions
- The `sessions` state should survive layout transitions

**Files:** `src/App.tsx` → `TilesPage` function (~line 5409) and `TileTerminal` (~line 5482)

---

## Architecture Quick Reference

### ASCIIVision Integration Flow
1. User clicks ASCIIVISION button → `setAsciivisionActive(true)`
2. `<AsciiVisionOverlay>` mounts as a full-screen portal
3. Sets up `listen("terminal://event")` with early-event buffer
4. Calls `api.launchAsciivision()` → Rust `launch_asciivision` command
5. Rust finds asciivision binary (sidecar → dev build), spawns in PTY via `create_asciivision_session()`
6. PTY output → Tauri events → JS listener → `terminal.write()` in xterm.js
7. Keyboard input → xterm.js `onData` → `api.writeTerminalInput()` → PTY stdin
8. Ctrl+Esc or "Back to Grok" → kills PTY, unmounts overlay

### OpenTUI Games Flow (inside ASCIIVision)
1. User runs `/games` or focuses Games panel
2. `GamesPanel::activate_selected()` calls `try_launch_opentui()`
3. Finds `bun` binary and `games/*/index.ts` script
4. Spawns `bun games/PacMan/index.ts` in a PTY via `TerminalSession::spawn_command()`
5. vt100 parser processes PTY output (escape codes, colors, half-blocks)
6. `TerminalSession::render()` copies parsed screen to ratatui buffer
7. Falls back to built-in Rust ASCII games if bun/scripts not found

### Hands Security Model
- Relay URL: user-configured, stored in local SQLite, defaults to None
- Machine ID + Desktop Token: random UUIDs, local only, WebSocket auth only
- QR Code: contains only public URL path, no secrets
- Pairing Code: random per-session, not a credential
- No hardcoded relay URLs in codebase

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

### Requirements
- macOS, Node.js 20+, Rust stable, FFmpeg, LLVM/libclang, pkg-config
- Bun (for OpenTUI games): `curl -fsSL https://bun.sh/install | bash`
- Game deps: `for d in asciivision-core/games/*/; do (cd "$d" && bun install); done`

---

## What the User Wants Next

1. **Fix terminal bleed** — asciivision remnants still appearing in footer terminal after closing overlay
2. **Fix DMG hidden icon** — sidecar binary showing in DMG window
3. **Fix tiles persistence** — keep existing terminal sessions when changing grid layout
4. **Polish** — the user likes visual flair (rainbow effects, animations). They're building this for public release on GitHub.

---

## Context from This Session

- Started at 4% context, built entire grok-desktop-asciivision project from scratch
- Integrated OpenTUI 3D games into asciivision via PTY embedding (tiles.rs TerminalSession made public)
- Fixed event listener race condition (early-event buffering)
- Added terminal session filtering to prevent cross-session bleed
- Verified Hands credentials security (all local, nothing hardcoded)
- Updated README.md, install.sh, .gitignore for both projects
- The original projects (`Grok-Desktop/` and `asciivision/`) in `/Users/megabrain2/Desktop/grok-asciivision/` were NOT modified (except asciivision got the OpenTUI games changes)
- The combined project lives at `/Users/megabrain2/Desktop/grok-desktop-asciivision/`
