# Handoff v12 — Music Playlists, Settings Overhaul, IDE Fix → Next: ASCIIVision Terminal

## Session Summary (2026-03-22, session v12)

Full Music page upgrade (playlists, categories, drag-and-drop, right-click context menus, symlink dedup), Settings overhaul (icon button, scrollable panel, ASCIIVision API keys, Ollama model picker), IDE empty-state fix, Hands relay README improvements. All changes compile clean (TypeScript + Rust). Vite build passes.

---

## PRIORITY — Carry-Over Bugs (Fix First)

### Default Ollama Model Not Applied to New Chats
The Settings page now has a "Default Ollama model" dropdown that persists to DB (`ollamaModel` field on Settings). However, when the user creates a new chat on the Chat page and switches to Ollama, it still uses the old hardcoded default instead of the saved setting. Same issue on the IDE page's assistant panel.

**What needs to happen:**
- The `pickModel()` function in `src/store/appStore.ts` (~line 200) currently does `models.ollama[0]?.modelId ?? "qwen3.5:2b"` — it should check `settings.ollamaModel` first
- The Chat page's Ollama model selector should default to `settings.ollamaModel` when starting a new conversation
- The IDE page's assistant model selector (`assistantModel` state, ~line 3723 in App.tsx) should also respect `settings.ollamaModel` when the user switches to Ollama
- Anywhere a new chat/conversation is created with Ollama selected, the saved default should be used

**Where to look:**
- `pickModel()` in `src/store/appStore.ts` ~line 198
- Chat page model selector in `src/App.tsx` (search for `selectedModel` or Ollama toggle)
- IDE page assistant: `assistantModel` state and `assistantProvider` toggle ~line 3722
- Settings `ollamaModel` field: stored in DB, available via `useAppStore((s) => s.settings?.ollamaModel)`

---

## Changes Made This Session

### 1. Music Page — Playlist & Category System

**Right Sidebar → MusicSidebar** (replaces browser/workspace on music page):
- "All Tracks" shows full library, "Uncategorized" shows root-level files
- **Playlists & Folders** — each subdirectory of `~/Music/SuperASCIIVision/` appears as a category with track count
- **Create Playlist** — inline input creates a new named folder (slashes sanitized to dashes)
- **Import Files** — file picker filtered to audio extensions, copies into active category or root
- **Add Folder** — picks a directory, creates category with that folder name, imports all audio files
- **Drag & Drop** — drop mp3/wav/flac/etc onto sidebar to import into active category
- **Delete** — hover-visible X on each category, no confirm dialog

**Right-Click Context Menu on Tracks**:
- Right-click any track in the playlist panel → shows all playlists to add to
- Uses symlinks for tracks in multiple playlists (no file duplication)
- Root-level files are **moved** (not symlinked) when added to a playlist → uncategorized count updates correctly
- "Show in Finder" option for each track

**Deduplication**:
- Backend scan (`list_music_files_sync`) resolves canonical paths and deduplicates — if a root file and a categorized symlink point to the same real file, keeps only the categorized entry

**Track Filtering by Category**:
- `filteredTracks` in MusicPage now filters by `activeMusicCategory` from store
- Library header shows active category name and filtered count
- Refresh button refreshes both tracks and categories

**New Rust Commands**: `list_music_categories`, `create_music_category`, `delete_music_category`, `link_tracks_to_category`, `import_music_files` (handles both files and directories)
**New Rust Helpers**: `resolve_music_dir()`, `MusicCategory` struct, `category` field on `MusicTrack`

### 2. Settings Page — Overhaul

**Settings Button**: Now a clean circle icon (no text label), 28px round button in the top bar.

**Scrollable Panel**: Settings sheet capped at 85vh with overflow-y scroll. Thin themed scrollbar (white/10 thumb, transparent track). Header stays pinned, content scrolls.

**ASCIIVision API Keys Section**: New section with password fields for Claude, OpenAI, and Gemini keys. Saves to `asciivision-core/.env`. The xAI key from the system keychain is **auto-synced** as `GROK_API_KEY` — no duplicate input needed.

**Default Ollama Model Dropdown**: Lists all detected Ollama models in the Models section. Persists to DB. Shows model count or hint to run `ollama serve`.

**New Rust Commands**: `read_asciivision_env`, `write_asciivision_env` (with auto xAI→GROK sync from keychain)
**New DB Column**: `ollama_model` in settings table
**New Type Fields**: `ollamaModel` on Settings/SettingsPatch (TS + Rust)

### 3. IDE Page — Empty State Fix

Removed the `activeWorkspaceId` conditional that hid the entire IDE layout. Now always renders the full IDE grid (icon rail, file explorer, editor area, AI assistant sidebar) regardless of workspace state. Editor area shows contextual empty message: "Open a folder to get started" when no workspace, "Select a file from the explorer" when workspace is open but no file selected.

### 4. Hands Relay — Render Deploy Fix

**`render.yaml`**: Changed hardcoded `name: hands-relay` to `name: my-asciivision-relay` with prominent comment telling users to pick a unique name. Previously every user deploying got a name conflict.

**`hands-relay/README.md`**: Complete rewrite of deploy instructions. Now 5 clear steps with explicit guidance on where to change the name in code, what it becomes on Render, and how to connect the app.

### 5. README & Install Scripts

- Music description updated (playlists, categories, drag-and-drop)
- IDE description updated (multi-tab, opens without workspace)
- Hands deploy instructions updated with unique-name guidance
- Architecture line counts updated (App.tsx ~8.9K, store ~1.3K, backend ~10.2K)
- `install.sh` and `install-linux.sh` post-install messages now mention Music and Hands setup

---

## Key File Locations

### Frontend
- **`src/App.tsx`** (~8960 lines)
  - `MusicSidebar` component: ~line 5000
  - `MusicPage` (with context menu, category filtering): ~line 7648
  - `SettingsSheet` (scrollable, ASCIIVision keys, Ollama picker): ~line 8621
  - `IdePage` (always-render fix): ~line 3694
  - Settings button (icon-only): ~line 1236
- **`src/store/appStore.ts`** (~1257 lines)
  - `musicCategories`, `activeMusicCategory` state
  - `refreshMusicCategories`, `createMusicCategory`, `deleteMusicCategory`, `linkTracksToCategory`, `importMusicFiles` actions
- **`src/lib/tauri.ts`** — new APIs: `listMusicCategories`, `createMusicCategory`, `deleteMusicCategory`, `linkTracksToCategory`, `importMusicFiles`, `readAsciivisionEnv`, `writeAsciivisionEnv`
- **`src/types.ts`** — `MusicCategory` interface, `ollamaModel` on Settings/SettingsPatch

### Backend (Rust)
- **`src-tauri/src/lib.rs`** (~2214 lines) — all new music category commands, asciivision env commands, `resolve_music_dir` helper, `MusicCategory` struct, dedup logic in `list_music_files_sync`
- **`src-tauri/src/db.rs`** — `ollama_model` column, read/write support
- **`src-tauri/src/types.rs`** — `ollama_model` field on Settings + SettingsPatch
- **`src-tauri/src/providers.rs`** — added `get_api_key` public method

### Config / Docs
- **`render.yaml`** — unique service name with instructions
- **`hands-relay/README.md`** — complete deploy walkthrough
- **`README.md`** — updated descriptions, line counts, deploy instructions
- **`install.sh`** / **`install-linux.sh`** — updated post-install messages

---

## Known Issues / Next Steps

### ASCIIVision Terminal (Next Priority)

The ASCIIVision terminal experience needs work. Current issues:

1. **Games not launching**: The `/games` folder contains OpenTUI-style 3D terminal games that worked previously but are now broken. Need to investigate the game launcher path resolution and fix the integration.

2. **Border rendering glitch**: `???` characters appearing on the borders of the input area in ASCIIVision. Likely a Unicode/font rendering issue — could be the terminal not recognizing box-drawing characters, or a mismatch between the expected terminal capabilities and what xterm.js provides.

3. **ASCIIVision API key integration**: The Settings page now writes API keys to `asciivision-core/.env` (Claude, GPT, Gemini auto-saved, xAI auto-synced from keychain as GROK_API_KEY). Need to verify ASCIIVision picks these up correctly when launched as a sidecar.

**Where to look:**
- ASCIIVision sidecar launch: `src-tauri/src/lib.rs` ~line 1081 (`launch_asciivision`)
- ASCIIVision main entry: `asciivision-core/src/main.rs` ~line 3955
- ASCIIVision AI provider config: `asciivision-core/src/ai.rs` ~line 109 (env key mapping)
- Game files: `asciivision-core/games/` directory
- ASCIIVision terminal panel: embedded xterm.js in `src/App.tsx` (search `ASCIIVision Panel` or `launch_asciivision`)
- .env path resolution: `asciivision_env_path()` in `src-tauri/src/lib.rs`

### Other Remaining Items
- Media Editor: gallery can freeze after export (needs pagination), subtitle export not implemented
- Hands page: UX polish, connection status indicators

---

## Build Status
- `npx tsc --noEmit` — 0 errors
- `cargo check` — clean
- `npx vite build` — passes
