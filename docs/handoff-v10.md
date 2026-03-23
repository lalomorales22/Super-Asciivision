# Handoff v10 — Media Editor Remodel + Voice & Audio Fixes

## Session Summary (2026-03-22, session v10)

Massive media editor remodel from scratch, plus realtime voice fixes on the Voice & Audio page. All changes compile clean (Rust + TypeScript).

---

## Changes Made This Session

### 1. Voice & Audio Page
- **Realtime voice 400 fix**: Removed `?model=` param from WebSocket URL — xAI's endpoint is just `wss://api.x.ai/v1/realtime` with no model query param
- **Auto mode (server VAD) fix**: Updated session config to xAI-native `audio` format object, deferred audio capture until `session.updated` event
- **TTS model input → static label**: Replaced editable input with read-only display
- **Removed "Open Browser Pane" button** from Audio Gallery
- **Disconnect message cleanup**: 1005/1000 codes now show "Idle" instead of error codes

### 2. Media Editor — Complete Remodel
**Layout**: Single-column NLE-style editor replacing the old 3-panel grid:
- Fixed-height preview (280px) with aspect ratio toggle (16:9 / 9:16)
- Transport controls: skip back, play/pause, skip forward, time display
- Toolbar: zoom +/−, add subtitle, add overlay, export dropdown, clear
- Four track lanes: Visual, Audio, Overlay, Subtitles

**Playback engine**:
- RAF-based time advancement with playhead (amber vertical line)
- Spacebar play/pause
- Click-to-seek on timeline
- Audio playback via hidden audio elements synced to playhead (throttled at 200ms)
- Video playback synced to playhead with seek/drift correction
- Cmd/Ctrl + scroll wheel zoom on tracks (50%–800%)

**Track features**:
- Clips chain sequentially (no overlap)
- Drag-to-reorder clips within tracks via `onReorderClips`
- Trim handles on left/right edges of all clips (visual, audio, overlay)
- Trim drag uses frozen timeline duration to prevent mouse drift
- Right-click context menu: speed (2x/1.5x/0.5x/0.25x/reset), split at playhead, copy/paste, delete, extract audio (video only), move to overlay/visual
- Actual media duration probed via `loadedmetadata` (no more hardcoded 6s/8s)

**Overlay track**:
- Image overlays with position (x/y %) and size (width %) on preview
- Draggable on preview to reposition
- Resize handle (corner dot) on active overlay
- Copy/paste overlays
- Trim handles on timeline to adjust duration
- Overlays composited into exported video via FFmpeg `overlay` filter

**Subtitle track**:
- Subtitles with text, position (x/y %), and font size
- Draggable on timeline (left/right) and on preview (reposition)
- Font size +/− controls on preview
- Inline text editing on timeline
- Right-click: edit text, delete

**Export**:
- Compact dropdown from toolbar
- Includes overlay compositing via FFmpeg filter graph
- Success/failure toast notification ("Video exported successfully")

### 3. Backend (Rust)
- **Extract audio command**: `extract_audio_command` — extracts audio from video via FFmpeg (`-vn -c:a aac`)
- **Overlay compositing**: `composite_overlays()` in editor.rs — FFmpeg complex filter graph with `overlay` filter, scale, position, time-gating
- **EditorOverlayClip type** added to types.rs

---

## Key File Locations

### Frontend
- **`src/App.tsx`** — EditorPage now at ~line 5600 (rewritten), ~1000 lines
  - EditorClip interface: line ~124 (added `speed`, `mediaDuration`)
  - SubtitleClip interface: line ~133 (added `x`, `y`, `fontSize`)
  - OverlayClip interface: line ~143
  - Helper functions: `getEditorClipSpeed`, `findClipAtTime` ~line 615
  - VoiceAudioPage realtime fixes: ~line 2930
- **`src/types.ts`** — Added `EditorOverlayClip`, updated `ExportEditorTimelineRequest` with `overlays`
- **`src/lib/tauri.ts`** — Added `extractAudio` API call
- **`src/store/appStore.ts`** — `exportEditorTimeline` action (unchanged, still at ~line 1057)

### Backend (Rust)
- **`src-tauri/src/editor.rs`** — Added `composite_overlays()`, `extract_audio()`
- **`src-tauri/src/types.rs`** — Added `EditorOverlayClip` struct
- **`src-tauri/src/lib.rs`** — Added `extract_audio_command`
- **`src-tauri/src/realtime_proxy.rs`** — Unchanged but working (400 was from URL, not proxy)
- **`src-tauri/src/providers.rs`** — Removed `?model=` from realtime WebSocket URL

---

## Known Issues / Next Steps

### IDE Page (Next Priority)
The user wants to work on the IDE page next. Key items:
- **Move "Add Folder" button** next to the Explorer title in the left sidebar
- **Right-click delete** on workspace folders — currently no way to remove added workspaces
- **Remove Browser** from left sidebar (redundant with right sidebar browser)
- **Cmd+S to save** file edits in the IDE
- **Agentic AI sidebar** — upgrade the right sidebar AI assistant to be a full agentic coding assistant (bash commands, file edits, file creation, like modern IDE AI agents)

### Media Editor Known Issues
- Gallery can freeze briefly after export when refreshing many assets (needs pagination/virtualization)
- Preview playback is functional but not frame-perfect (throttled media sync)
- Subtitle export to final video not yet implemented (only overlays are composited)
- Overlay resize on preview only adjusts width (height follows aspect ratio)

### Other
- `MoveUp`/`MoveDown` icons removed from imports (no longer used after reorder refactor)
- `onMoveClip` prop removed from EditorPage (replaced by `onReorderClips`)
