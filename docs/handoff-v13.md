# Handoff v13 — ASCIIVision Terminal Focus

## Session Summary (2026-03-22, session v13)

Fixed the Ollama default model bug (pickModel + IDE page now respect settings.ollamaModel). Added a 6-theme system (Emerald, Ocean, Sunset, Violet, Golden, Crimson) with full CSS override coverage across all emerald/sky accent classes. Added hideable music mini-player (X button, auto-unhides on Music page). Upgraded the header — removed "xAI key ready" subtitle, added animated blue glow to "Super ASCIIVision" logo text that adapts per theme. Updated install scripts and README to remove manual .env API key instructions (now "use Settings"). Updated asciivision-core README with dual instructions (embedded vs standalone). All compiles clean.

---

## THIS SESSION: ASCIIVision Terminal Deep Dive

This session is dedicated entirely to the ASCIIVision terminal experience (`asciivision-core/`). The desktop shell (Chat, IDE, Music, etc.) is in good shape — all work below is inside the ratatui TUI.

---

### 1. Code Review First

Before making changes, do a review pass of the ASCIIVision codebase to understand the current state. Key entry points:

- **`asciivision-core/src/main.rs`** (~4000 lines) — main loop, UI rendering, keybindings, tiling
- **`asciivision-core/src/ai.rs`** — multi-provider AI chat (Claude, Grok, GPT, Gemini, Ollama)
- **`asciivision-core/src/tiling.rs`** — tiling window manager, tile layouts, focus/swap
- **`asciivision-core/src/games.rs`** — game launcher (OpenTUI + built-in fallback)
- **`asciivision-core/src/themes.rs`** — F9/F10 theme system, color palette definitions
- **`asciivision-core/src/modules.rs`** — module registry (video, webcam, sysmon, etc.)
- **`asciivision-core/src/ops.rs`** — ops deck / recent operations log

---

### 2. Border Rendering — `???` Characters

**The problem:** Box-drawing border characters (╔═╗║╚═╝ from ratatui's `BorderType::Double` and similar) render as `???` or misaligned characters in certain windows. The issue shifts around when cycling themes with F9 — some borders fix while others break. Corner characters are especially affected.

**Investigation areas:**
- Check if mixed `BorderType` usage (Double vs Plain vs Rounded) causes inconsistent rendering
- Check if theme color changes affect the border symbol sets (they shouldn't, but verify)
- The PTY environment is already set correctly: `TERM=xterm-256color`, `LANG=en_US.UTF-8`, `LC_ALL=en_US.UTF-8` (set in `src-tauri/src/terminal.rs` ~line 393)
- xterm.js has Unicode11 addon loaded and IBM Plex Mono font
- Could be a ratatui rendering artifact where border cells overlap or get partially overwritten by adjacent widgets
- Check `Rect` calculations — if a widget's area overlaps another's border area by even 1 cell, it can corrupt the border characters

**Most likely cause:** Widget layout `Rect` calculations where adjacent panels share or overlap border cells. When themes change and widget sizes/positions shift slightly, the corruption moves to different borders.

---

### 3. Tiling Navigation — Remap to Ctrl+WASD

**Current state:** Ctrl+J/K works to move focus up/down between tiled windows, but Ctrl+H/L are mapped to other actions (H = unclear, L = clear transcript).

**New keybinding plan:**
- **Ctrl+W** — focus up
- **Ctrl+A** — focus left
- **Ctrl+S** — focus down
- **Ctrl+D** — focus right
- **Ctrl+Shift+W/A/S/D** — swap current window in that direction
- Keep **Ctrl+N** (new tile) as-is
- **Ctrl+/** currently does nothing — investigate what it should do, or remove it

**Where to look:**
- Keybinding handling in `main.rs` — search for `KeyCode` and `KeyModifiers::CONTROL`
- Tiling focus/swap logic in `tiling.rs`
- Remove or remap the Ctrl+L (clear transcript) and Ctrl+H conflicts

---

### 4. Scrolling Banner — Replace with Cute Sayings

**Current state:** There's a scrolling text banner at the bottom of the ASCIIVision UI.

**What to do:** Either remove it entirely or replace it with a rotating display of fun/cute one-liner sayings (1 of ~100+ sayings, picked randomly, displayed statically or with a gentle fade transition). Think fortune cookie meets friendly AI personality.

**Examples of the vibe:**
- "Your code is valid and so are you"
- "Compiling happiness..."
- "This terminal believes in you"
- "sudo make me a sandwich"
- "git commit -m 'things are going well'"
- "The bits are strong with this one"

Add ~50-100 of these. Pick a new one on each theme change, or rotate every 30-60 seconds.

---

### 5. Ops Deck — Not Showing Recent Ops

**The problem:** The ops deck panel is supposed to show recent operations (commands run, files changed, API calls made, etc.) but currently displays nothing.

**Where to look:**
- `asciivision-core/src/ops.rs` — ops tracking and display
- Check if ops are being recorded but not rendered, or if the recording mechanism is broken
- The ops deck may need to hook into the AI tool-use loop, shell command execution, and file operations

---

### 6. Video Playback — Too Fast

**The problem:** Videos played in ASCIIVision (ASCII art rendering) play back way too fast — not at the correct framerate.

**Where to look:**
- `asciivision-core/src/video.rs` or similar — ASCII video decoder/renderer
- FFmpeg frame extraction timing — likely missing frame delay or not respecting the source FPS
- The frame render loop may be dumping frames as fast as it can decode them instead of pacing to the video's native framerate

---

### 7. Modules — Add YouTube and Video Support

**Current modules:** Check `modules.rs` for the registry of available modules.

**YouTube:** ASCIIVision already has `yt-dlp` as a dependency. Need to wire up a YouTube module that:
- Accepts a YouTube URL
- Downloads via yt-dlp to a temp file
- Feeds the downloaded video into the existing ASCII video renderer
- Shows download progress

**Video playback in general:** Verify the video module works for local files, fix the framerate issue (item 6 above), then extend to YouTube.

---

### 8. F1 Help Screen

Review the F1 help screen to make sure it reflects the new keybindings (WASD navigation) and any other changes made this session. The help screen should be the authoritative reference for all keyboard shortcuts.

---

## Key File Locations

| File | What | Lines |
|------|------|-------|
| `asciivision-core/src/main.rs` | Main loop, UI, keybindings | ~4000 |
| `asciivision-core/src/ai.rs` | Multi-provider AI chat | ~600 |
| `asciivision-core/src/tiling.rs` | Tiling WM, focus, swap | ~400 |
| `asciivision-core/src/themes.rs` | Color themes, F9/F10 | ~200 |
| `asciivision-core/src/games.rs` | Game launcher | ~500 |
| `asciivision-core/src/ops.rs` | Ops deck | ~200 |
| `asciivision-core/src/modules.rs` | Module registry | ~300 |
| `asciivision-core/src/video.rs` | ASCII video rendering | ~400 |
| `src-tauri/src/terminal.rs` | PTY spawn + env vars | ~450 |

## Changes Made This Session (v13)

### Ollama Default Model Bug — Fixed
- `pickModel()` in `appStore.ts` now accepts optional `ollamaDefault` param, checks `settings.ollamaModel` first
- `setSelectedProvider` passes the setting through
- IDE page Ollama toggle uses `settings.ollamaModel` instead of hardcoding `models.ollama[0]`

### Theme System — 6 Themes
- **Emerald** (default), **Ocean**, **Sunset**, **Violet**, **Golden**, **Crimson**
- CSS override approach: `[data-theme="X"]` selectors remap all emerald/sky Tailwind classes (50+ per theme)
- Covers: bg, border, text, caret, accent, focus, hover, gradient, arbitrary opacity values
- Nav indicator uses `.nav-indicator` CSS class (themed shadow + background)
- Logo glow animation adapts per theme
- Theme stored in DB (`theme` column), applied on boot via `data-theme` attribute on `<html>`
- Live preview in Settings — theme applies on click, persists on save

### Music Mini-Player — Hide Button
- X button on the right edge of the mini-player bar
- `miniPlayerHidden` state hides the bar (music continues playing)
- Auto-unhides when navigating to the Music page

### Header Cleanup
- Removed "xAI key ready" / "Add an xAI API key" subtitle
- "Super ASCIIVision" title: larger (13px), bolder, animated gradient glow

### Docs & Install Scripts
- README: added Themes section, updated Settings description, updated Privacy table
- install.sh / install-linux.sh: removed manual .env instructions, now says "use Settings"
- asciivision-core/README.md: split API key instructions (embedded vs standalone)

---

## Build Status
- `npx tsc --noEmit` — 0 errors
- `cargo check` — clean
- `npx vite build` — passes
