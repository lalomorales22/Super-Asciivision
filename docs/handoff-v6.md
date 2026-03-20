# Handoff v6 — Super ASCIIVision

## Current State

The Super ASCIIVision Tauri 2 / React / Rust desktop app is functional. The previous session completed bug fixes and features for the main app (Phases 1-8 from the implementation plan). The outstanding issue is a rendering bug inside the **asciivision-core** TUI binary.

## The Bug: Mystery "???" Characters in ASCIIVision TUI Borders

### Symptom
When the user opens ASCIIVision (the embedded TUI terminal app), **question mark characters (`?`) appear in groups of 3** scattered around the panel borders (TRANSCRIPT, TRANSMIT, WEBCAM, etc.). They **move around dynamically** between frames — they are not static. The user describes them as appearing "3 at a time in different spots" and "moving around the windows in the transmit border, transcript border."

### Where It Runs
- The `asciivision-core` Rust binary is a ratatui TUI app
- It runs inside a PTY, spawned by the Tauri backend (`src-tauri/src/lib.rs` → `launch_asciivision()`)
- Its output is rendered in an **xterm.js** instance in the frontend (`src/App.tsx` → `AsciiVisionPanel`, currently around line ~6299)
- The xterm.js config: `fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"`, `fontSize: 11`

### What Was Already Tried (AND NEEDS TO BE REVERTED)
The previous session made increasingly aggressive Unicode replacements that **did NOT fix the bug** and **degraded the visual quality**. All of these changes need to be **reverted** to restore the original look:

#### Changes to REVERT in `asciivision-core/`:

1. **`src/theme.rs`** — Remove the `ASCII_BORDER` constant and `BorderSet` import that were added. The file originally only had theme color definitions.

2. **`src/main.rs`** — Revert these changes:
   - Remove `use crate::theme::ASCII_BORDER;` (line 13)
   - Restore `BorderType::Double` where `.border_set(ASCII_BORDER)` is now used (8 locations)
   - The original code used `BorderType::Double` for focused/important panels and `BorderType::Plain` for others. The conditional pattern was:
     ```rust
     .border_type(if is_focused { BorderType::Double } else { BorderType::Plain })
     ```
   - Restore `use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph, Wrap};`
   - Restore `LARGE_LOGO` constant — it was an ASCII-art banner using `█╔═╗║╚╝` characters (Unicode box-drawing). It was replaced with a `#`-based ASCII version. Restore the original.
   - Restore `render_gradient_text` — it was split into `render_gradient_text` + `render_gradient_text_clipped`. The original was just `render_gradient_text` with buffer-edge clipping.
   - Restore `'\u{2584}'` (▄) in `render_raster_bars` (was changed to `'='`)
   - Restore `'\u{2588}'` (█) in `render_equalizer` (was changed to `'#'`)
   - Restore `'\u{00B7}'` (·) in `render_synthetic_scope` (was changed to `'.'`)
   - Restore `'\u{2026}'` (…) in `truncate()` function — BUT also revert the `max_chars.saturating_sub(3)` back to `max_chars.saturating_sub(1)` since ellipsis is 1 char

3. **`src/sysmon.rs`** — Revert:
   - Remove `use crate::theme::{t, ASCII_BORDER};` → restore to `use crate::theme::t;`
   - Restore `BorderType::Double`/`Plain` conditional pattern
   - Restore `"\u{2588}".repeat(filled)` and `"\u{2591}".repeat(empty)` in `mini_bar()` (was changed to `"#"` and `"-"`)
   - Restore `"\u{2191}"` (↑) and `"\u{2193}"` (↓) in network display (was changed to `"^"` and `"v"`)
   - Restore quadrant block spinner: `["\u{2596}", "\u{2598}", "\u{259D}", "\u{2597}"]` (was changed to `["-", "\\", "|", "/"]`)
   - Restore sparkline chars: `[' ', '\u{2581}', '\u{2582}', '\u{2583}', '\u{2584}', '\u{2585}', '\u{2586}', '\u{2587}', '\u{2588}']` (was changed to ASCII)

4. **`src/analytics.rs`** — Revert:
   - Remove `use crate::theme::{t, ASCII_BORDER};` → restore to `use crate::theme::t;`
   - Restore `BorderType::Double` (was `ASCII_BORDER`)
   - Restore `"\u{2588}"` and `"\u{2591}"` in `make_bar()` (was changed to `"#"` and `"-"`)

5. **`src/tiles.rs`** — Revert:
   - Remove `use crate::theme::ASCII_BORDER;`
   - Restore `BorderType::Double`/`Plain` conditional patterns (2 locations)

6. **`src/games.rs`** — Revert:
   - Remove `use crate::theme::{t, ASCII_BORDER};` → restore to `use crate::theme::t;`
   - Restore `BorderType::Double`/`Plain` conditional pattern

### What We Know About the Bug

1. **The `???` are NOT caused by Unicode border characters** — replacing ALL Unicode with pure ASCII (`+`, `-`, `|`) did not fix the issue. The `???` persisted even with zero non-ASCII bytes in the entire source.

2. **The `???` move dynamically** — they shift position between frames, which means they're tied to animated/phase-dependent rendering, NOT static border definitions.

3. **They appear "around the borders"** — near the edges of panel tiles, in the border lines of TRANSCRIPT, TRANSMIT, WEBCAM panels.

4. **They appear in groups of 3** — this is the signature of a single 3-byte UTF-8 character being interpreted as 3 separate bytes, each rendered as `?`. BUT since replacing all Unicode didn't fix it, the source might be elsewhere.

### Theories That Haven't Been Explored Yet

1. **crossterm differential rendering bug** — ratatui uses crossterm which only sends changed cells between frames. If there's a character width mismatch between crossterm's cursor tracking and xterm.js's rendering, characters get written to wrong positions. The `???` "moving around" is consistent with cursor position drift that shifts each frame.

2. **xterm.js Unicode version mismatch** — The AsciiVisionPanel xterm.js instance does NOT load `@xterm/addon-unicode11`. By default xterm.js uses Unicode 6 character widths, while Rust's `unicode-width` crate (used by crossterm/ratatui) uses a different version. This mismatch could cause width disagreements for certain characters, leading to rendering artifacts. **Fix to try**: Install and load `@xterm/addon-unicode11` in the AsciiVisionPanel.

3. **The video ASCII art palette contains `?`** — The video renderer (`asciivision-core/src/video.rs` line 18) uses this palette:
   ```
   b" .'`^\",:;Il!i><~+_-?][}{1)(|\\tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"
   ```
   The `?` at index 18 renders for ~26% brightness pixels. If the video content overflows its panel boundary or if crossterm's differential rendering causes video characters to "leak" into adjacent cells, this could explain `?` appearing near borders. The video updates every frame, which would explain the "moving" behavior.

4. **`render_gradient_text` overflow** — The `render_gradient_text()` function in main.rs clips at the full buffer edge, NOT at individual panel boundaries. If text rendered inside a panel (like video metadata "sig:lock source:demo.mp4") exceeds the panel's inner width, it overflows into adjacent panels' border areas. This was partially addressed with `render_gradient_text_clipped` but was reverted.

5. **PTY encoding issue** — The PTY might not be configured for UTF-8 mode. Check if the `create_asciivision_session()` in `src-tauri/src/terminal.rs` sets `LANG=en_US.UTF-8` or similar locale env vars.

### Suggested Investigation Approach

1. **Start with theory #2** — add `@xterm/addon-unicode11` to the AsciiVisionPanel xterm.js. This is a non-invasive frontend-only fix:
   ```bash
   npm install @xterm/addon-unicode11
   ```
   ```typescript
   import { Unicode11Addon } from "@xterm/addon-unicode11";
   // In AsciiVisionPanel, after creating terminal:
   const unicode11 = new Unicode11Addon();
   terminal.loadAddon(unicode11);
   terminal.unicode.activeVersion = '11';
   ```

2. **If that doesn't work, try theory #5** — in `src-tauri/src/terminal.rs`, in the `create_asciivision_session()` function, add:
   ```rust
   command.env("LANG", "en_US.UTF-8");
   command.env("LC_ALL", "en_US.UTF-8");
   ```

3. **If that doesn't work, try theory #3** — replace `?` in the video PALETTE with a different character (like `~` or `:`) to see if the `???` disappear. If they do, the video rendering is leaking.

4. **If that doesn't work, investigate theory #1** — add debug logging to track cursor positions, or try setting xterm.js to use a simpler rendering mode.

## Key Files Reference

| File | Purpose |
|------|---------|
| `asciivision-core/src/main.rs` | Main TUI app, all panel rendering, ~3800 lines |
| `asciivision-core/src/video.rs` | Video decode + ASCII art rendering, PALETTE on line 18 |
| `asciivision-core/src/tiling.rs` | Panel layout/tiling system |
| `asciivision-core/src/theme.rs` | Color theme (currently has ASCII_BORDER that should be removed) |
| `asciivision-core/src/sysmon.rs` | System monitor panel |
| `asciivision-core/src/analytics.rs` | Analytics panel |
| `asciivision-core/src/tiles.rs` | PTY tile sub-terminals |
| `asciivision-core/src/games.rs` | Built-in games panel |
| `src/App.tsx` | Frontend — `AsciiVisionPanel` (~line 6299) is the xterm.js host |
| `src-tauri/src/terminal.rs` | PTY session creation, `create_asciivision_session()` (~line 340) |
| `src-tauri/src/lib.rs` | `launch_asciivision()` command (~line 964) |

## Build Commands

```bash
# Clean rebuild of asciivision sidecar
cd asciivision-core && cargo clean && cd ..
./build-asciivision.sh

# Run the app
npm run tauri dev

# Type checks
npx tsc --noEmit          # TypeScript
cd src-tauri && cargo check  # Tauri Rust backend
cd asciivision-core && cargo check  # ASCIIVision binary
```

## Completed Work (Do Not Redo)

These are done and working in the main Super ASCIIVision app:
- Bug 1: ASCIIVision launch path fix (CWD fallback in lib.rs + terminal.rs)
- Bug 2: TTS `"language": "en"` field + inline error display
- Bug 3: Music folder dialog error handling + scanning indicator
- Bug 4: Tiles persist across navigation (store-based session IDs)
- Bug 5: Double prompt fix (clean build resolved it)
- Feature 6: Relay URL (was already done)
- Feature 7: Close confirmation dialog
- Feature 8: ANSI terminal color theme for syntax highlighting
- Feature 9: Import Media button in Editor
- Rename: "IMAGINE" → "IMAGE & VIDEO" in all user-facing text
