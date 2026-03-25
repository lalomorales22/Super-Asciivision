# Handoff v19 — Linux Build + AppImage Release

**Date:** 2026-03-25
**Branch:** main
**Last commit:** `345de00` chore: bump version to 0.1.4
**Release:** https://github.com/lalomorales22/Super-Asciivision/releases/tag/v0.1.4

---

## Context

We just completed a massive refactoring effort (Sessions 1–6) on macOS. The app is now modular, performant, tested, and the macOS DMG has been built and uploaded to GitHub. The user is now switching to their Linux machine to build the AppImage and upload it to the same v0.1.4 release.

**Nothing is broken.** This is a refactor — the app behaves identically to v0.1.3. All changes were frontend `.ts`/`.tsx` files only. The Rust backend, Tauri config, and install scripts are untouched (except version bump to 0.1.4).

---

## Your task

### 1. Pull the latest code

```bash
cd ~/Desktop/Super-Asciivision   # or wherever the repo lives
git pull origin main
npm install
```

### 2. Build the ASCIIVision sidecar

```bash
./build-asciivision.sh
```

This compiles the Rust `asciivision-core` binary and copies it to `src-tauri/binaries/` with the correct target triple suffix.

### 3. Build Super ASCIIVision (production)

```bash
npm run tauri build
```

This runs `tsc && vite build` then compiles the Rust backend and produces:
- `src-tauri/target/release/bundle/deb/*.deb`
- `src-tauri/target/release/bundle/appimage/*.AppImage`

### 4. Upload the AppImage to the existing v0.1.4 release

```bash
gh release upload v0.1.4 "src-tauri/target/release/bundle/appimage/Super ASCIIVision_0.1.4_amd64.AppImage"
```

If the machine is aarch64 (like the Jetson), the filename will have `aarch64` instead of `amd64`.

### 5. Optionally upload the .deb too

```bash
DEB_FILE=$(find src-tauri/target/release/bundle/deb -name "*.deb" | head -1)
gh release upload v0.1.4 "$DEB_FILE"
```

### 6. Commit if needed

If you had to make any changes to get it building on Linux (unlikely, but possible), commit them:

```bash
git add -A
git commit -m "fix: Linux build adjustments for v0.1.4"
git push origin main
```

---

## What was done in Sessions 1–6 (for context)

| Session | What | Key commits |
|---------|------|-------------|
| **1** | Extracted 8 util files, constants, 9 small components | Various |
| **2** | Extracted all 8 page components to `src/pages/` | Various |
| **3** | Extracted 9 layout components, added React.lazy + Suspense, ErrorBoundary | `d8b30f5`, `5217f53` |
| **4** | Split monolithic Zustand store (1,265 lines) into 8 domain stores | `046e59c` |
| **5** | React.memo (6 components), react-window virtualization, useDragResize hook | `c128b9f` |
| **6** | 122 Vitest tests (utils, stores, page smoke tests), fixed App.test.tsx | `1501629` |

**App.tsx went from 9,002 → 93 lines.**
**appStore.ts went from 1,265 → 272 lines (now settings-only, with 7 sibling stores).**

---

## Current file structure

```
src/
  App.tsx              (93 lines — boot wrapper + hljs registration)
  constants.ts
  types.ts             (30+ interfaces)
  main.tsx
  styles.css
  store/
    appStore.ts        (272 lines — settings, providers, models, init)
    chatStore.ts       (320 lines — conversations, messaging, agent)
    mediaStore.ts      (246 lines — media assets, generation, realtime)
    workspaceStore.ts  (198 lines — workspace CRUD, selection)
    terminalStore.ts   (136 lines — terminal PTY, browser preview)
    musicStore.ts      (127 lines — playback, library, playlists)
    handsStore.ts      (49 lines — Hands service status)
    tileStore.ts       (15 lines — terminal tile layout)
  lib/
    tauri.ts
  utils/
    formatting.ts      paths.ts       html.ts        audio.ts
    editor.ts          dom.ts         tokens.ts      tree.ts
  hooks/
    useDragResize.ts
  components/
    AppMark.tsx         BrowserPanel.tsx   CodeBlock.tsx      EmptyPanel.tsx
    ErrorBoundary.tsx   MessageBubble.tsx  NavTab.tsx         ResizeHandle.tsx
    ShellChromeContext.ts  ToolCallBlock.tsx  TypingIndicator.tsx
  components/layout/
    AsciiVisionPanel.tsx  GrokShell.tsx      HistoryRail.tsx    MusicMiniPlayer.tsx
    MusicSidebar.tsx      SettingsSheet.tsx   TerminalPanel.tsx  TopBar.tsx
    WorkspaceDrawer.tsx
  pages/
    ChatPage.tsx        EditorPage.tsx     HandsPage.tsx      IdePage.tsx
    ImaginePage.tsx     MusicPage.tsx      TilesPage.tsx      VoiceAudioPage.tsx
```

---

## Validation commands

```bash
npx tsc --noEmit          # TypeScript strict — must pass with 0 errors
npm test                  # 122 Vitest tests — all must pass
npm run tauri build       # Full production build
```

---

## Important notes

1. **Install scripts are untouched** — `./install-linux.sh` works as before
2. **The only new npm dependency** is `react-window` (v2.2.7) — `npm install` will pick it up
3. **Test files are excluded from tsc** via `tsconfig.json` exclude pattern — this is intentional so test-only type approximations don't block production builds
4. **All pages are lazy-loaded** via `React.lazy()` in `GrokShell.tsx`
5. **Cross-store pattern:** domain stores use `useAppStore.getState()` for shared state (error, settings). This is standard Zustand.
