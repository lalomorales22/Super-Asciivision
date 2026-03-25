# Handoff v18 — Remaining Refactoring Work (Sessions 4–6)

**Date:** 2026-03-25
**Branch:** main
**Last commit:** `d8b30f5` feat: add ErrorBoundary component and wrap page content

---

## What's been completed (Sessions 1–3)

| Session | What was done |
|---------|---------------|
| **Session 1** | Extracted utils (8 files), constants, small components (9 files), quick fixes |
| **Session 2** | Extracted all 8 page components to `src/pages/` |
| **Session 3** | Extracted 9 layout components to `src/components/layout/`, added React.lazy() + Suspense, added ErrorBoundary, deduplicated SubtitleClip/OverlayClip into types.ts |

**App.tsx went from 9,002 → 93 lines** across all sessions. Phase 1 file extraction is 100% complete.

---

## What remains — your tasks

Read `docs/new-tasks.md` for the full plan and `docs/review32426.md` for the original review. Below is a focused summary of what's left.

### Session 4 — Split Zustand store (HIGHEST PRIORITY, HIGHEST RISK)

**Task 3.1 — Split `src/store/appStore.ts` (1,265 lines) into domain stores:**

| New store file | Domain | Key state |
|---------------|--------|-----------|
| `src/store/chatStore.ts` | Chat | conversations, activeConversation, messages, streaming, agent mode |
| `src/store/mediaStore.ts` | Media | categories, assets, generation state, mediaLoaded |
| `src/store/workspaceStore.ts` | Workspace | workspaces, items, selection, scanning |
| `src/store/musicStore.ts` | Music | tracks, playback, categories, folder, volume, repeat |
| `src/store/terminalStore.ts` | Terminal | sessionId, output buffer |
| `src/store/settingsStore.ts` | Settings | settings, providers, models, UI (settingsOpen, booting, error) |
| `src/store/handsStore.ts` | Hands | status, busy state |
| `src/store/tileStore.ts` | Tiles | session IDs, layout |

**Strategy:**
1. Read `src/store/appStore.ts` thoroughly first — understand all 45+ state fields and 67+ actions
2. Map which fields belong to which domain
3. Identify cross-domain dependencies (e.g., settings store needs to know provider status)
4. Extract one domain at a time, starting with the most independent (music, terminal, tiles)
5. Cross-store references use `getState()` from the other store
6. Update all component imports — use `Grep` to find every `useAppStore` call
7. Run `npx tsc --noEmit` after each extraction

**Risk:** High. This is the most complex refactor. Cross-domain dependencies can be tricky.

**Task 3.2 — Add Zustand selectors** (do after 3.1):
Use shallow selectors so components only re-render when their specific fields change:
```typescript
const messages = useChatStore(state => state.activeConversation?.messages);
```

---

### Session 5 — Performance polish

**Task 2.2 — Add React.memo() to list items:**
- `src/components/MessageBubble.tsx`
- `src/components/CodeBlock.tsx`
- `src/components/ToolCallBlock.tsx`
- `src/components/NavTab.tsx`
- `MediaAssetCard` in `src/pages/ImaginePage.tsx`
- Track items in `src/pages/MusicPage.tsx`

**Task 2.3 — Add react-window virtualization:**
- Install: `npm install react-window @types/react-window`
- Apply to message list in ChatPage, media gallery in ImaginePage, track list in MusicPage
- Risk: Medium — variable-height items need measurement

**Task 4.1 — Extract custom hooks:**
- `src/hooks/useDragResize.ts` — Panel resize logic (used 4+ places)
- `src/hooks/useTerminalSession.ts` — xterm lifecycle management
- `src/hooks/useContextMenu.ts` — Right-click menu positioning + cleanup
- `src/hooks/useKeyboardShortcuts.ts` — Global hotkey handling
- `src/hooks/useMediaGallery.ts` — Gallery CRUD operations

**Task 4.2 — Replace inline styles with Tailwind** (1,183 instances, do page-by-page)

---

### Session 6 — Testing

**Task 5.1 — Unit tests for utility functions:**
- Framework: Vitest (already configured in project)
- Files: everything in `src/utils/` — pure functions, easiest to test
- Cover edge cases for path manipulation, formatting, audio encoding

**Task 5.2 — Store action tests:**
- Mock the Tauri API layer (`src/lib/tauri.ts`)
- Test store actions (create conversation, send message, etc.)

**Task 5.3 — Component smoke tests:**
- Basic render tests for each page component — verify they mount without crashing

---

## Current file structure

```
src/
  App.tsx              (93 lines — boot wrapper + hljs registration only)
  constants.ts
  types.ts             (includes AppPage, SubtitleClip, OverlayClip, 30+ interfaces)
  main.tsx
  styles.css
  store/
    appStore.ts        (1,265 lines — NEXT TARGET for splitting)
  lib/
    tauri.ts
  utils/
    formatting.ts      paths.ts       html.ts        audio.ts
    editor.ts          dom.ts         tokens.ts      tree.ts
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

## Rules (same as always)

1. **Do NOT change behavior.** This is a refactor, not a feature pass.
2. **Compile after every extraction.** Run `npx tsc --noEmit` after each change.
3. **One domain per commit** for the store split. Keep commits small and reversible.
4. **Read the store thoroughly before splitting.** Understand cross-domain deps first.
5. **Full context:** `docs/new-tasks.md` (plan), `docs/review32426.md` (review findings)

---

## Important notes

1. **All pages are lazy-loaded** via `React.lazy()` in `GrokShell.tsx` — don't revert to static imports
2. **ErrorBoundary wraps page content** in CenterStage (inside GrokShell.tsx)
3. **hljs language registration** lives in `App.tsx` as a top-level side-effect
4. **GrokShell.tsx** (519 lines) is the layout orchestrator — holds panel state, drag state, editor clip state. It could be further split if a layout Zustand store is introduced during the store split phase.
5. **`appStore.ts` (1,265 lines)** is the single remaining monolith. Every `useAppStore` call in every component will need updating during the store split.
6. **TypeScript strict mode** is on — `npx tsc --noEmit` must pass with 0 errors after every change.
