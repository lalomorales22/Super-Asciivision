# Grok Desktop — Upgrade Tasks

## 1. Imagine + Audio Gallery — Hover Card Clipping

**Problem:** Hovering over gallery cards in both the Imagine page and Voice & Audio page shows a preview popup that gets cut off at the edges. The `MediaAssetCard` already uses `createPortal(document.body)` (line 2178) to render the hover card outside the DOM tree, but the fixed-position card uses `translate(-50%, -50%)` centered on the card rect with no viewport boundary clamping. Cards near the top, bottom, left, or right edges of the gallery cause the 320px popup to overflow outside the visible viewport.

**Root cause:** The portal positioning at `App.tsx:2050-2055` sets `left` and `top` to the center of the source card and translates by -50%, but never clamps these coordinates against `window.innerWidth` / `window.innerHeight`. The hover card can extend past the viewport edges (especially for cards in the last row or rightmost column).

**Fix:**
1. Replace the raw `translate(-50%, -50%)` centering with clamped coordinates that keep the entire 320px-wide popup within the viewport
2. Calculate the popup's natural position, then clamp: `left = clamp(left, 16, window.innerWidth - popupWidth - 16)` and similar for `top`
3. This fix applies to all `MediaAssetCard` instances across both Imagine and Voice & Audio galleries since they share the same component

**Files:**
- `src/App.tsx` — `MediaAssetCard` component (lines 1951-2183), specifically the portal positioning at lines 2050-2055

---

## 2. Voice & Audio Page — Realtime Voice Broken

### 2a. Button doesn't latch / realtime session fails

**Problem:** Clicking the mic button starts a realtime session but it doesn't stay active. The button should toggle `voiceActive` to `true` and keep the session running until the user clicks again.

**Root cause analysis:** The `startRealtimeConversation()` function at `App.tsx:2309` correctly sets `setVoiceActive(true)` at line 2315, but if the session creation (`createRealtimeSession` at line 2318) or WebSocket connection fails, the catch block at line 2456 sets `setVoiceActive(false)` — and the error status may not be visible enough. Also check:
- Whether `createRealtimeSession` in `providers.rs:363` is hitting the correct endpoint (`XAI_REALTIME_SECRET_ENDPOINT`)
- Whether the WebSocket URL format is correct (`wss://api.x.ai/v1/realtime?model=grok-realtime`)
- Whether the subprotocol auth (`xai-client-secret.{secret}`) is accepted

**Debug steps:**
1. Add console logging at key points: session creation response, WebSocket open/error/close events
2. Check if `realtimeSession` is populated after `createRealtimeSession` resolves (line 2319 re-reads from store)
3. Verify the API key is correctly passed to the realtime endpoint
4. Test the WebSocket connection independently to confirm the xAI realtime API is reachable

**Files:**
- `src/App.tsx` — `startRealtimeConversation()` (lines 2309-2464)
- `src/store/appStore.ts` — `createRealtimeSession` action (line 895)
- `src-tauri/src/providers.rs` — `create_realtime_session()` (lines 363-410)

### 2b. No hands-free / auto-talk mode

**Problem:** The current implementation uses `turn_detection: { type: "server_vad" }` (line 2336), which should enable server-side voice activity detection for automatic turn-taking. If the WebSocket session works, server VAD should already handle auto-talk. The real blocker is likely 2a (session not connecting).

**Fix:** Once the session is working, verify server VAD is functioning. If additional UI is needed, add a toggle for "push-to-talk" vs "hands-free" modes where push-to-talk manually commits the audio buffer.

### 2c. Better error surfacing

**Problem:** Errors from the realtime API are shown only in the small status text below the mic button, which is easy to miss.

**Fix:**
1. Surface realtime errors through the app's main error banner (via `set({ error: ... })` in the store)
2. Show connection state more prominently (connecting spinner, error state with retry button)
3. Log the full WebSocket close event details to help debug

---

## 3. Media Editor — CapCut-Style Upgrade

**Problem:** The current editor (`EditorPage` at line 4558) is a basic timeline with clip ordering, trim in/out, still duration, and ffmpeg export. To become a real CapCut alternative, it needs significant upgrades.

**Current capabilities:**
- Clip list with reorder (up/down buttons)
- Trim start/end and still duration inputs (text fields)
- Visual + Audio track lanes (`TimelineTrack` at line 4977)
- Preview panel (`EditorPreview` at line 4911)
- Timeline ruler (`TimelineScale` at line 4954)
- Export via ffmpeg (`exportEditorTimeline` in store)

**Planned enhancements (priority order):**

### Phase 1 — Core Editing
- [ ] Drag-and-drop clip reordering on the timeline (replace up/down buttons)
- [ ] Visual clip trimming by dragging handles on timeline track items
- [ ] Playback preview with play/pause and scrubber/seek bar
- [ ] Clip splitting (razor tool — click to split a clip at a point)
- [ ] Keyboard shortcuts: Space (play/pause), Delete (remove clip), S (split), Ctrl+Z/Y (undo/redo)

### Phase 2 — Timeline Polish
- [ ] Zoom in/out on timeline (horizontal scale)
- [ ] Snap-to-grid / snap-to-clip edge alignment
- [ ] Audio waveform visualization on audio track clips
- [ ] Undo/redo stack for all timeline edits
- [ ] Drag media from the gallery sidebar directly into timeline

### Phase 3 — Effects & Output
- [ ] Text/caption overlay track with timing and positioning
- [ ] Transitions between clips (crossfade, cut, wipe)
- [ ] Speed/playback rate per clip
- [ ] Basic filters per clip (brightness, contrast, saturation)
- [ ] Export settings panel (resolution, bitrate, codec, format)

**Files:**
- `src/App.tsx` — `EditorPage` (line 4558), `EditorPreview` (line 4911), `TimelineScale` (line 4954), `TimelineTrack` (line 4977)
- `src-tauri/src/editor.rs` — backend export logic

---

## 4. IDE Page — Right-Click "Open in Terminal" for Folders

**Problem:** The context menu already has an "Open in Terminal" option for folders (line 3059), and `handleOpenInTerminal` sends `cd '<path>'` to the terminal (line 3064). The user reports this doesn't work well — they want to be able to right-click and have the terminal navigate to that folder so they can start servers, etc.

**Current implementation:** `handleOpenInTerminal` at line 3059 calls `writeTerminalData("cd '<escapedPath>'\n")`, which writes the `cd` command directly to the PTY. This should work, but:
1. It doesn't switch the UI to show the terminal panel if it's not visible
2. It doesn't create a terminal session if one doesn't exist yet
3. The terminal double-typing bug (task #5) may garble the cd command

**Fix:**
1. Ensure a terminal session exists before writing the cd command (call `ensureTerminal` first)
2. After writing the cd command, auto-switch the IDE to show the terminal panel
3. Consider supporting multiple terminal tabs so the user can keep one terminal in the project root and open others in subfolders

**Files:**
- `src/App.tsx` — `handleOpenInTerminal` (line 3059), IDE context menu (lines 3552-3623)
- `src/store/appStore.ts` — terminal session management

---

## 5. IDE Page — Terminal Double-Typing Bug

**Problem:** Every keystroke in the integrated terminal produces the character twice. Copy-paste also pastes content twice.

**Root cause:** React `StrictMode` in `src/main.tsx:7` causes every component to mount, unmount, and remount in development mode. The `TerminalPanel` `useEffect` at line 5166 creates an xterm.js instance and registers `terminal.onData` → `writeTerminalData`. During the strict-mode double-mount cycle:

1. First mount: creates terminal A, registers onData listener A
2. Cleanup: disposes terminal A (but the PTY session persists in Rust)
3. Second mount: creates terminal B, registers onData listener B
4. Terminal B writes all existing `terminalOutput` (line 5194-5197), replaying what terminal A already showed

The double-typing likely happens because:
- The `writeTerminalData` function from the store calls `api.writeTerminalInput(sessionId, value)` which writes to the Rust PTY
- The PTY echoes the character back
- The echo arrives as a `TerminalEvent` that gets appended to `terminalOutput` in the store
- The useEffect at line 5224 then writes that new output to xterm

If during the strict-mode remount there's a timing window where both the old and new terminal instances are alive, input can be duplicated. Additionally, if `writeTerminalData` or `resizeTerminal` function references change between renders, the effect re-runs and re-registers listeners.

**Fix options (pick one or combine):**
1. **Guard with ref:** Use a ref flag (`initializedRef`) to prevent the double-mount from creating two terminal instances
2. **Remove StrictMode in dev for terminal:** Not recommended globally, but could wrap just the terminal in a non-strict boundary
3. **Stabilize effect deps:** Ensure `writeTerminalData` and `resizeTerminal` are stable references (they should be from Zustand, but verify)
4. **Use `useRef` for the data handler:** Store the `writeTerminalData` in a ref so the effect doesn't need it as a dependency, preventing re-runs

Recommended approach: option 4 — move `writeTerminalData` into a ref and remove it from the useEffect dependency array, so the terminal is only created once per mount cycle.

**Files:**
- `src/main.tsx` — React StrictMode wrapper (line 7)
- `src/App.tsx` — `TerminalPanel` (lines 5156-5262)
- `src/store/appStore.ts` — `writeTerminalData` (line 720)

---

## 6. Window Not Movable — DONE

**Problem:** The app window (`decorations: false`, `transparent: true`) could be resized but not dragged/moved on the desktop. The custom titlebar used `currentWindow.startDragging()` via JavaScript, but lacked the native `-webkit-app-region: drag` CSS that macOS webviews need for reliable drag behavior.

**Fix applied:**
1. Added `-webkit-app-region: drag` CSS rule for `[data-tauri-drag-region]` elements in `src/styles.css`
2. Added `-webkit-app-region: no-drag` for interactive elements (buttons, inputs, `[data-no-drag="true"]`)
3. Extended `data-tauri-drag-region` to the entire top bar container (not just the narrow logo/title area), giving a much larger grab surface

**Files changed:** `src/styles.css`, `src/App.tsx` (top bar div at line ~918)

---

## 7. Install Script — DONE

**Added:** `install.sh` — a one-line install script that:
1. Checks for macOS
2. Installs Xcode CLI Tools, Homebrew, Node.js 20+, Rust, and ffmpeg if missing
3. Runs `npm install`
4. Runs `npm run tauri build`
5. Copies the built `.app` bundle into `/Applications`

**Files added:** `install.sh`
**README updated** with one-line install instructions at the top of the Install section.

---

## 8. README Update — DONE

**Fix applied:** Updated stale hardcoded paths (`/Users/megabrain2/Software/Rust-Apps/Grok-Desktop/`) to relative paths. Added install script section.

---

## 9. Hands Relay — No Changes

Working great. No fixes needed.

---

## Priority Order

1. ~~**#6 Window not movable**~~ — DONE
2. ~~**#7 Install script**~~ — DONE
3. ~~**#8 README update**~~ — DONE
4. **#5 Terminal double-typing** — most disruptive to daily use, blocks #4
5. **#1 Hover card clipping** — visual fix for Imagine + Audio galleries
6. **#2 Realtime voice** — functional fix, debug API connection first
7. **#4 Open folder in terminal** — IDE quality-of-life, depends on #5
8. **#3 Media editor upgrade** — largest scope, phased iterative work
