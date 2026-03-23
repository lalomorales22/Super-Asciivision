# Handoff v14 — ASCIIVision Tiling & Border Deep Dive

## Session Summary (2026-03-22, session v14)

Completed all 8 tasks from handoff-v13: switched all `BorderType::Double` to `BorderType::Rounded`, remapped tiling nav to Ctrl+WASD, added 100 rotating sayings banner, made ops deck record all operations, fixed video playback speed (frame pacing via FPS), updated F1 help screen with scrolling support, fixed F4 effects cycle loop, updated tiles inner cycling to Ctrl+W/S, switched from macOS Keychain to file-based secret storage (no more login prompt), fixed xterm.js terminal padding via CSS insets, and fixed negative float-to-u16 underflow in effects.rs rendering.

Despite all of that, **`???` characters still appear in panel borders** and cause alignment shifts. This is the #1 remaining issue.

---

## THIS SESSION: Border & Tiling Deep Dive

This session is a **surgical deep dive** into the `???` border corruption in the ASCIIVision TUI. The issue is persistent, affects multiple panels, shifts when themes change, and was NOT fixed by switching border types or fixing the effects.rs underflow bug. Something else is writing invalid characters into border cells.

---

### What Was Already Tried (and didn't fix it)

1. **Switched all `BorderType::Double` to `BorderType::Rounded`** across every file (main.rs, games.rs, tiles.rs, sysmon.rs, analytics.rs). Did not fix it.

2. **Fixed negative float-to-u16 underflow** in effects.rs — `render_starfield`, `render_particles`, `render_wireframe_cube`, `draw_line` all had a bug where negative screen coordinates wrapped to 65535 when cast to u16, corrupting random buffer cells. Fixed by checking float bounds before casting. Reduced some corruption but **did not eliminate the `???` in borders**.

3. **Clipped header `render_gradient_text` calls** to inner bounds so they can't overwrite border cells. Did not fix it.

4. **Added background fill** in `render_tile_panel` (line ~2376) — each panel fills its entire area with `panel_bg` before rendering content. This should prevent ghost artifacts but does not prevent active writes to border cells.

---

### Symptoms to Reproduce

- Launch ASCIIVision (`./build-asciivision.sh && npm run tauri dev`, click ASCIIVISION in nav)
- `???` characters appear in the borders of panel windows — especially at corners and along edges
- Press F9 (randomize theme) — the `???` characters **move to different positions**
- The border lines themselves become misaligned — shifted left/right or broken
- Affects multiple panels: Transcript, Video, Webcam, Telemetry, Ops Deck, Effects, SysMon
- The issue is **not** in the Tauri shell — it's in the ratatui TUI running inside the PTY

---

### Investigation Strategy

#### Phase 1: Isolate the source

**Start with a minimal layout.** Use `/layout focus` to switch to FullFocus (single Transcript panel). If `???` still appears, the issue is in the header, input box, or saying bar — not tiling. If it goes away, the issue is in multi-panel rendering.

Then incrementally add panels:
- `/layout dual` — 2 panels
- `/layout triple` — 3 columns
- `/layout default` — full default layout

Note which panels trigger the corruption.

#### Phase 2: Direct buffer write audit

Every function that calls `buffer.cell_mut()` is a suspect. Here is the **complete list** of direct buffer writers:

| Function | File | What it does | Bounds checking |
|----------|------|-------------|----------------|
| `render_starburst` | main.rs ~3783 | Animated star burst decorations | Clips to `clip_area` via i16 math — **verify i16 overflow edge cases** |
| `render_gradient_text_clipped` | main.rs ~3822 | Gradient-colored text | Clips to `buf_area` and optional `right_edge` — **already fixed** |
| `render_equalizer` | main.rs ~3844 | Animated bar visualizer in telemetry | Iterates within `area` bounds — **check if area overlaps border** |
| `render_scroller` | main.rs ~3869 | Scrolling text (intro only now) | Iterates within `area` bounds — seems safe |
| `render_saying` | main.rs ~3897 | Static centered saying text | Clips to area — seems safe |
| `render_logo` | main.rs ~3720 | ASCII art logo (intro only) | Uses `saturating_add` — **check carefully** |
| `render_background` | main.rs ~3682 | Animated BG (intro only) | Iterates area bounds — safe |
| `render_raster_bars` | main.rs ~3698 | Horizontal color bars (intro only) | Iterates area bounds — safe |
| `render_ascii_frame` | main.rs ~3602 | ASCII video frame render | Uses `min()` for bounds — safe |
| `render_wireframe_cube` | effects.rs ~449 | 3D wireframe cube | **Fixed in v14** — pre-cast bounds check |
| `draw_line` | effects.rs ~521 | Wireframe edge lines | **Fixed in v14** — pre-cast bounds check |
| `render_starfield` | effects.rs ~245 | 3D starfield | **Fixed in v14** — pre-cast bounds check |
| `render_particles` | effects.rs ~286 | Particle storm | **Fixed in v14** — pre-cast bounds check |
| `render_fire` | effects.rs ~333 | Fire simulation | Uses array indexing within allocated buffer |
| `render_matrix` | effects.rs | Matrix rain columns | Check `column.x` against area width |
| `render_plasma` | effects.rs | Plasma color effect | Iterates within area — safe |
| `VideoPlayer::render` | video.rs | Video panel ASCII render | Calls `render_ascii` which clips — safe |
| `webcam render` | webcam.rs | Webcam ASCII render | Likely safe — check |
| `games render` | games.rs | Game rendering | Multiple games — **check PacMan, Space Invaders, Penguin renderers** |
| `tiles render` | tiles.rs | PTY terminal render | Uses vt100 screen — **check if PTY output can write outside inner area** |
| `sysmon render` | sysmon.rs | System monitor | Uses Paragraph widget — safe |
| `analytics render` | analytics.rs | Analytics dashboard | Uses Paragraph widget — safe |

**Priority suspects** (most likely to cause border corruption):

1. **`render_starburst`** — Called in header, ops deck, and telemetry. Uses `i16` math for clipping. If `clip_area` doesn't perfectly match the inner area, it could write on border cells.

2. **`render_equalizer`** — Called in telemetry panel. If its `area` parameter includes border cells, it writes bar characters over them.

3. **`render_matrix` (matrix rain)** — Each column has an `x` position. If columns are initialized for a larger area and the panel shrinks, old x values could be out of bounds.

4. **Games built-in renderers** — PacMan, Space Invaders, and Penguin3D all render directly to the buffer. They may not clip to the inner area properly.

5. **Tiles PTY render** — vt100 screen output rendered to buffer. If the PTY sends cursor positioning that's outside the inner rect, it could corrupt borders.

#### Phase 3: The "nuclear option" — render borders LAST

If the source can't be found through auditing, there's a definitive fix: **render all panel borders AFTER all content**, so border characters always win. Currently each panel renders its Block (with borders) first, then content on top. If content overwrites borders, the borders are gone.

The fix: in `render_tile_panel`, render the Block border as the **last** step, not the first. This means:
1. Fill background
2. Render panel content into the `inner` area
3. Re-render the Block border on top

This guarantees borders are never corrupted by content, regardless of the source. The downside is a slight performance cost from double-rendering the border area.

Implementation:
```rust
fn render_tile_panel(&mut self, frame: &mut Frame, panel: PanelKind, area: Rect, phase: f32, is_focused: bool) {
    // 1. Background fill
    frame.render_widget(Block::default().style(Style::default().bg(t().panel_bg)), area);

    // 2. Render content first (into inner area)
    let inner = area.inner(Margin { horizontal: 1, vertical: 1 });
    match panel {
        PanelKind::Transcript => self.render_messages_inner(frame, inner),
        // ... etc
    }

    // 3. Render border LAST — overwrites any content that leaked into border cells
    let border_color = if is_focused { t().accent4 } else { t().accent1 };
    let block = Block::default()
        .title(panel_title)
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(border_color));
    frame.render_widget(block, area);
}
```

This requires refactoring each panel's render function to accept the `inner` rect directly instead of rendering their own Block. It's a moderate refactor but would be a **definitive fix**.

---

### Key File Locations

| File | What | Lines |
|------|------|-------|
| `asciivision-core/src/main.rs` | Main loop, UI, all render functions | ~3950 |
| `asciivision-core/src/effects.rs` | 3D effects (matrix, starfield, particles, etc.) | ~570 |
| `asciivision-core/src/tiling.rs` | Tiling WM, rect calculations, focus/swap | ~562 |
| `asciivision-core/src/games.rs` | Game renderers (PacMan, Space Invaders, Penguin) | ~500+ |
| `asciivision-core/src/tiles.rs` | PTY terminal rendering | ~250 |
| `asciivision-core/src/sysmon.rs` | System monitor panel | ~200 |
| `asciivision-core/src/theme.rs` | Color theme system | ~150 |
| `asciivision-core/src/video.rs` | ASCII video renderer | ~254 |
| `src-tauri/src/terminal.rs` | PTY spawn + env vars (UTF-8 locale) | ~450 |

### Build & Test

```bash
./build-asciivision.sh && npm run tauri dev
```

Both `cargo check` (asciivision-core) and `cargo check` (src-tauri) pass clean. `npx tsc --noEmit` passes clean.

---

## Changes Made This Session (v14)

### Border Type Standardization
- All `BorderType::Double` replaced with `BorderType::Rounded` across: main.rs, games.rs, tiles.rs, sysmon.rs, analytics.rs
- Header gradient text clipped to inner bounds

### Tiling Navigation — Ctrl+WASD
- Focus: Ctrl+W (up), Ctrl+A (left), Ctrl+S (down), Ctrl+D (right)
- Swap: Ctrl+Shift+W/A/S/D
- Tiles inner cycling: Ctrl+W/S (was Ctrl+J/K)
- Removed Ctrl+L clear transcript shortcut (use `/clear`)

### Sayings Banner
- 100 cute one-liners replace scrolling ticker
- Centered with gentle color pulse, rotates every 45s and on theme change

### Ops Deck Live
- Records: slash commands, shell ops, AI requests, tool calls, provider changes, video/YouTube loads
- Shows up to 12 entries with age-based coloring

### Video Playback Speed
- Frame pacing in `spawn_decode` using source FPS (default 24fps)

### F1 Help Screen
- PageUp/PageDown/Up/Down scrolling support
- Updated keybindings to WASD scheme

### F4 Effects Cycle Fix
- Now properly cycles: Matrix Rain -> Plasma -> Starfield -> Wireframe -> Fire -> Particles -> OFF -> repeat

### Terminal Padding
- xterm.js host div uses inset positioning (`top-0.5 bottom-4 left-2 right-2`)

### Keychain Prompt Eliminated
- Switched from macOS Keychain to file-based secret storage
- Keys stored at `~/.config/superasciivision/secrets/*.key` with 0o600 permissions

### Float-to-u16 Underflow Fix (effects.rs)
- `render_starfield`, `render_particles`, `render_wireframe_cube`, `draw_line` all pre-check float bounds before u16 cast
