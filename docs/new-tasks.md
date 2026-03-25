# Refactoring Plan — Super ASCIIVision

Based on findings in `docs/review32426.md`. Work is ordered by dependency (later tasks depend on earlier ones).

---

## Phase 1: File Extraction (Do First)

The foundation — everything else depends on App.tsx being split.

### Task 1.1 — Extract utility functions
**From:** `App.tsx` lines 228-660
**To:** `src/utils/`

Create these files:
- `src/utils/formatting.ts` — `clamp`, `formatFileSize`, `formatTimestamp`, `formatEditableDuration`, `formatTimelineSeconds`, `formatDuration`, `parseSecondsInput`
- `src/utils/paths.ts` — `leafName`, `parentPath`, `renamedPath`, `replacePathPrefix`, `relativeWorkspacePath`, `isSameOrDescendantPath`, `extensionForLanguage`
- `src/utils/html.ts` — `escapeHtml`, `buildPreviewDocument`, `buildAssetPreviewDocument`
- `src/utils/audio.ts` — `encodePcm16Base64`, `decodeBase64Bytes`, `pcm16BytesToFloat32`, `normalizeVoiceId`, `requestMicrophoneStream`
- `src/utils/editor.ts` — `createEditorClip`, `getEditorClipSpeed`, `getEditorClipDuration`, `buildTimelineTrack`, `findClipAtTime`, `buildClipTrimPatch`
- `src/utils/dom.ts` — `shouldStartWindowDrag`, `isEditableTarget`
- `src/utils/tree.ts` — `buildIdeTree`
- `src/utils/tokens.ts` — `estimateSelectedTokens`

**Risk:** Low. Pure functions, no state dependencies.
**Test:** App compiles and all pages render correctly.

### Task 1.2 — Extract constants
**From:** Scattered through App.tsx
**To:** `src/constants.ts`

Move: `CHAT_MODELS`, `IMAGE_MODELS`, `VIDEO_MODELS`, `OLLAMA_IMAGE_MODELS`, `IMAGE_ASPECT_OPTIONS`, `IMAGE_RESOLUTION_OPTIONS`, `XAI_VOICE_OPTIONS`, `REALTIME_AUDIO_RATE`, panel width defaults, buffer size limits.

**Risk:** Low.

### Task 1.3 — Extract shared/small components
**From:** App.tsx
**To:** `src/components/`

- `src/components/AppMark.tsx` — Logo component
- `src/components/ResizeHandle.tsx` — Drag handle
- `src/components/EmptyPanel.tsx` — Blank state
- `src/components/CodeBlock.tsx` — Syntax-highlighted code block
- `src/components/MessageBubble.tsx` — Chat message display
- `src/components/ToolCallBlock.tsx` — Agent tool call display
- `src/components/NavTab.tsx` — Navigation tab
- `src/components/TypingIndicator.tsx` — Animated dots

**Risk:** Low. Self-contained components.

### Task 1.4 — Extract page components
**From:** App.tsx
**To:** `src/pages/`

Extract in this order (simplest → most complex):
1. `src/pages/TilesPage.tsx` (~200 lines, minimal dependencies)
2. `src/pages/MusicPage.tsx` (~410 lines)
3. `src/pages/ChatPage.tsx` (~200 lines, depends on MessageBubble, CodeBlock)
4. `src/pages/HandsPage.tsx` (~620 lines)
5. `src/pages/ImaginePage.tsx` (~450 lines)
6. `src/pages/VoiceAudioPage.tsx` (~740 lines, has Web Audio complexity)
7. `src/pages/EditorPage.tsx` (~1,130 lines, complex drag state)
8. `src/pages/IdePage.tsx` (~1,650 lines, most complex — file tree, quick open, assistant)

**Risk:** Medium. Need to define prop interfaces and ensure ShellChromeContext passes through correctly.

### Task 1.5 — Extract layout components
**From:** App.tsx
**To:** `src/components/layout/`

- `src/components/layout/TopBar.tsx`
- `src/components/layout/HistoryRail.tsx`
- `src/components/layout/WorkspaceDrawer.tsx`
- `src/components/layout/TerminalPanel.tsx`
- `src/components/layout/AsciiVisionPanel.tsx`
- `src/components/layout/BrowserPanel.tsx`
- `src/components/layout/MusicMiniPlayer.tsx`
- `src/components/layout/MusicSidebar.tsx`
- `src/components/layout/SettingsSheet.tsx`
- `src/components/layout/GrokShell.tsx` (main shell — extracted last)

**Risk:** Medium. These components share layout state (panel widths, drag states).

### Task 1.6 — Define prop interfaces
**To:** `src/types.ts` (extend existing)

As components are extracted, define explicit prop interfaces for each. Currently props are implicit through closure scope. Example:
```typescript
interface EditorPageProps {
  clips: EditorTimelineClip[];
  activeClipId?: string;
  onAddClip: (clip: EditorTimelineClip) => void;
  // ... etc
}
```

**Risk:** Low but tedious. Every component needs its interface defined.

---

## Phase 2: Performance (Do After Phase 1)

### Task 2.1 — Add React.lazy() and Suspense
**After:** Phase 1 complete (pages are separate files)

Wrap each page in `React.lazy()`:
```typescript
const ChatPage = lazy(() => import('./pages/ChatPage'));
const EditorPage = lazy(() => import('./pages/EditorPage'));
// etc.
```

Add `<Suspense fallback={...}>` in GrokShell where pages render.

**Impact:** Defers ~440 KB from initial load.
**Risk:** Low.

### Task 2.2 — Add React.memo() to list items
**Files:** MessageBubble, MediaAssetCard, CodeBlock, ToolCallBlock, NavTab, track items in MusicPage

Wrap each with `React.memo()` and verify with React DevTools that re-renders decrease.

**Impact:** 20-30% fewer re-renders.
**Risk:** Low. Just ensure comparison functions are correct.

### Task 2.3 — Add react-window virtualization
**Install:** `react-window` + `@types/react-window`
**Apply to:**
- Message list in ChatPage
- Media gallery grid in ImaginePage
- Track list in MusicPage
- File tree in IdePage (if large workspaces)

**Impact:** 10-50x faster scrolling with large datasets.
**Risk:** Medium. Need to handle variable-height items (messages vary in size).

### Task 2.4 — Add error boundaries
**Create:** `src/components/ErrorBoundary.tsx`

Wrap each page component in an error boundary. Show a "Something went wrong" fallback instead of white screen.

**Impact:** Prevents full app crash from component errors.
**Risk:** Low.

---

## Phase 3: Store Refactor (Do After Phase 1)

### Task 3.1 — Split Zustand store by domain
**From:** `src/store/appStore.ts` (1,265 lines)
**To:**
- `src/store/chatStore.ts` — conversations, messages, composer, streaming, agent mode
- `src/store/mediaStore.ts` — categories, assets, generation state
- `src/store/workspaceStore.ts` — workspaces, items, selection, scanning
- `src/store/musicStore.ts` — tracks, playback, categories, folder
- `src/store/terminalStore.ts` — session, output, buffer
- `src/store/settingsStore.ts` — settings, providers, models, UI state
- `src/store/handsStore.ts` — status, busy state
- `src/store/tileStore.ts` — session IDs, layout

Each store is independent. Cross-store references use `getState()` from the other store.

**Impact:** State changes in one domain don't re-render components subscribed to another.
**Risk:** High. This is the most complex refactor — need to identify all cross-domain dependencies. Test thoroughly.

### Task 3.2 — Add Zustand selectors
**After:** Store is split

Use shallow selectors so components only re-render when their specific fields change:
```typescript
const messages = useChatStore(state => state.activeConversation?.messages);
```
Instead of:
```typescript
const { activeConversation } = useAppStore(); // re-renders on ANY store change
```

**Impact:** Significant re-render reduction.
**Risk:** Low once stores are split.

---

## Phase 4: Code Quality (Do Anytime)

### Task 4.1 — Extract custom hooks
- `src/hooks/useDragResize.ts` — Panel resize logic (used 4+ places)
- `src/hooks/useTerminalSession.ts` — xterm lifecycle management
- `src/hooks/useContextMenu.ts` — Right-click menu positioning + cleanup
- `src/hooks/useKeyboardShortcuts.ts` — Global hotkey handling
- `src/hooks/useMediaGallery.ts` — Gallery CRUD operations

**Risk:** Low.

### Task 4.2 — Replace inline styles with Tailwind
1,183 inline `style={{ }}` attributes. Convert to Tailwind utilities where possible. Some (dynamic widths from drag resize) must stay inline — that's fine.

**Risk:** Low but tedious. Do page-by-page.

### Task 4.3 — Move @types/qrcode to devDependencies
One-liner fix in package.json.

### Task 4.4 — Delete unused scaffolding assets
Remove: `public/vite.svg`, `public/tauri.svg`, `src/assets/react.svg`

### Task 4.5 — Add games/*/node_modules to .gitignore
Prevents 414 MB of bloat from being tracked.

---

## Phase 5: Testing (Ongoing)

### Task 5.1 — Unit tests for utility functions
**Files:** Everything in `src/utils/`
**Framework:** Vitest (already configured)

These are pure functions — easiest to test. Cover edge cases for path manipulation, formatting, audio encoding.

### Task 5.2 — Store action tests
Mock the Tauri API layer and test store actions (create conversation, send message, etc.)

### Task 5.3 — Component smoke tests
Basic render tests for each page component — verify they mount without crashing.

---

## Suggested Session Breakdown

| Session | Tasks | Focus |
|---------|-------|-------|
| **Session 1** | 1.1, 1.2, 1.3, 4.3, 4.4, 4.5 | Extract utils, constants, small components, quick fixes |
| **Session 2** | 1.4, 1.6 | Extract all 8 page components |
| **Session 3** | 1.5, 2.1, 2.4 | Extract layout components, add lazy loading + error boundaries |
| **Session 4** | 3.1, 3.2 | Split Zustand store (biggest risk, needs full focus) |
| **Session 5** | 2.2, 2.3, 4.1, 4.2 | Performance polish — memo, virtualization, hooks, inline styles |
| **Session 6** | 5.1, 5.2, 5.3 | Testing |

---

## Rules for Refactoring

1. **Do NOT change behavior.** This is a refactor, not a feature pass. The app should work identically before and after.
2. **Compile after every extraction.** Run `npm run build` (or at minimum `tsc --noEmit`) after each file is extracted.
3. **One component per commit.** Keep commits small and reversible.
4. **Keep App.tsx as the last file to shrink.** Extract outward, then clean up what remains.
5. **Read the review first.** Full context is in `docs/review32426.md`.
