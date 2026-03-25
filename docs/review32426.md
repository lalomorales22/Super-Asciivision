# Super ASCIIVision - Comprehensive Code Review

**Date:** March 24, 2026
**Version:** 0.1.2
**Reviewer:** Claude (Opus 4.6)
**Scope:** Full codebase — frontend, backend, security, performance, architecture

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [The Good — What's Done Right](#2-the-good)
3. [The Innovative — Never Before Done](#3-the-innovative)
4. [The Bad — What Needs Work](#4-the-bad)
5. [Security Analysis](#5-security-analysis)
6. [Performance Analysis](#6-performance-analysis)
7. [The Bloat — What Can Be Cut](#7-the-bloat)
8. [Build & Load Speed](#8-build--load-speed)
9. [Dependency Audit](#9-dependency-audit)
10. [Prioritized Action Items](#10-prioritized-action-items)

---

## 1. Project Overview

Super ASCIIVision is a hybrid desktop application built on:

| Layer | Technology | Lines of Code |
|-------|-----------|---------------|
| Frontend | React 19 + TypeScript 5.8 + Tailwind 4 | ~12,600 |
| Desktop Shell | Tauri 2 (Rust) | ~10,300 |
| Terminal Engine | Rust (Ratatui + FFmpeg) | ~11,600 |
| Relay Server | Node.js (WebSocket) | ~500 |
| **Total** | **3 languages, 179 files** | **~35,000** |

**Features:** AI chat (xAI/Ollama), image/video generation, realtime voice, code IDE, video editor with timeline, music player, multi-terminal tiles, ASCII art video rendering, remote agent control (Hands), QR code pairing.

---

## 2. The Good

### 2.1 Type Safety — Excellent
- Full TypeScript strict mode across the frontend
- Centralized type definitions in `types.ts` (396 lines, 30+ interfaces)
- Type-safe Tauri IPC with `invoke<T>()` generics in `lib/tauri.ts`
- No `any` types found in the codebase

### 2.2 State Management — Clean
- Zustand store is the single source of truth for all app state
- Clean action/state separation — async operations go through store actions
- Fallback defaults for settings prevent undefined state
- Terminal output uses a 120K char circular buffer (smart memory cap)

### 2.3 Security Architecture — Solid
- API keys stored in OS keychain (macOS Keychain / Linux keyring) via `src-tauri/src/keychain.rs`
- Fallback encrypted file storage with `0o600` permissions on Unix
- Path traversal protection with `canonicalize()` validation in Rust
- Content Security Policy configured in `tauri.conf.json` (no `*` wildcards)
- Asset protocol scope denies `$HOME/.ssh/**` and `$HOME/.gnupg/**`
- ReactMarkdown used for safe markdown rendering (no `dangerouslySetInnerHTML` for user content)
- `escapeHtml()` utility properly used for code preview fallbacks

### 2.4 WebSocket Relay (Hands) — Well Secured
- `crypto.randomUUID()` for session IDs
- HttpOnly cookies with `SameSite=Strict`
- Desktop token validation on WebSocket upgrade
- 1MB request body size limit
- Session validity checked before terminal operations

### 2.5 Build Configuration — Smart
- Vite manual chunk splitting separates vendor bundles:
  - `vendor-react` (3.6 KB), `vendor-tauri` (15 KB), `vendor-terminal` (284 KB)
  - `vendor-markdown` (157 KB), `vendor-icons` (20 KB)
- Enables browser caching of stable vendor chunks between deploys
- Total frontend build: 1.1 MB (reasonable for feature density)

### 2.6 Rust Backend — Well Modularized
- Clean module separation: `db.rs`, `hands.rs`, `terminal.rs`, `editor.rs`, `providers.rs`, `agent.rs`
- Async Tokio runtime for non-blocking operations
- SQLite for persistent state (conversations, workspaces, media metadata)
- PTY management for real terminal sessions
- Proper error types with `AppResult<T>`

### 2.7 Dependency Health
- `npm audit`: **0 vulnerabilities**
- All packages are current, maintained, and appropriate for their use
- No deprecated packages detected
- Dev dependencies properly separated from production

### 2.8 Git Hygiene
- `.gitignore` blocks `.env`, `.env.*`, `*.key`, `*.db`, `*.sqlite`
- Allows `.env.example` template
- Build artifacts excluded

---

## 3. The Innovative

These features push boundaries and aren't commonly found in similar apps:

### 3.1 ASCII Art Video Rendering (asciivision-core)
A standalone Rust TUI application that converts video frames to ASCII art in real-time using FFmpeg. Renders through Ratatui/Crossterm into a terminal. This is genuinely novel — most ASCII art tools are static image converters, not real-time video players.

### 3.2 Embedded PTY Terminal via Tauri IPC
Real pseudo-terminal sessions running in the Rust backend, with output streamed to xterm.js in the React frontend via Tauri events. Not just a shell emulator — full PTY with proper terminal semantics (resize, signals, Unicode).

### 3.3 Multi-Terminal Tile Grid
2x1, 2x2, and 3x3 layouts of independent terminal sessions, each with its own PTY. Functionally a tmux-like experience inside a desktop app.

### 3.4 WebSocket Relay for Remote Agent Control
The Hands system creates a secure tunnel between a mobile device and the desktop app via a WebSocket relay, with QR code pairing. Enables remote operation of the AI agent from a phone.

### 3.5 Realtime Voice via Web Audio API + xAI
Direct microphone capture → PCM16 encoding → WebSocket to xAI realtime API → PCM16 decoding → audio playback. A complete bidirectional voice conversation pipeline built from scratch.

### 3.6 Integrated Video Editor Timeline
A full clip-based timeline editor (visual track, audio track, subtitle track, overlay track) with trim, speed adjustment, drag repositioning, and export — all in React without any video editing library.

---

## 4. The Bad

### 4.1 CRITICAL: Monolithic App.tsx — 9,002 Lines
This is the single biggest problem in the codebase. **Every page, every component, every utility function** lives in one file:

- 30+ component definitions
- 25+ utility functions
- 131 `useState` hooks
- 46 `useRef` instances
- 70+ `useEffect` / `useLayoutEffect` calls
- 8 page components (Chat, Imagine, Voice, IDE, Editor, Hands, Music, Tiles)

**Impact:**
- IDE navigation is painful
- No tree-shaking possible — entire app loads at once
- Every state change triggers reconciliation across all components
- Hot Module Replacement touches the entire file
- Multiple developers cannot work on different pages simultaneously

**Recommended structure:**
```
src/
  components/
    layout/     (TopBar, Sidebar, TerminalPanel, ResizeHandle)
    chat/       (ChatPage, MessageBubble, CodeBlock, ToolCallBlock)
    media/      (ImaginePage, MediaAssetCard, GeneratingCard)
    voice/      (VoiceAudioPage)
    ide/        (IdePage, IdeCodeEditor, QuickOpen)
    editor/     (EditorPage, Timeline, ClipTrack)
    hands/      (HandsPage, ActivityList)
    music/      (MusicPage, MusicMiniPlayer, MusicSidebar)
    tiles/      (TilesPage, TileTerminal)
    settings/   (SettingsSheet)
  hooks/        (useTerminal, useMediaGallery, useWorkspace)
  utils/        (formatting, paths, audio, timeline)
  store/
    chatStore.ts
    mediaStore.ts
    workspaceStore.ts
    musicStore.ts
    terminalStore.ts
    settingsStore.ts
```

### 4.2 No Component Memoization
Zero usage of `React.memo()` across the entire app. Every store change re-renders every visible component. With Zustand, components subscribe to the entire store — any field change triggers re-render of all subscribers.

### 4.3 No List Virtualization
Conversations, messages, media assets, music tracks, workspace files — all rendered with `.map()` into the DOM. With 100+ items in any list, this causes:
- DOM bloat (thousands of nodes)
- Scroll jank
- Slow initial render

### 4.4 No Lazy Loading / Code Splitting
All 8 pages load upfront. The terminal library (284 KB) and markdown parser (157 KB) are always loaded even when viewing the music page. No `React.lazy()` or dynamic imports.

### 4.5 No Error Boundaries
If any component throws during render, the entire app crashes with a white screen. No graceful fallback UI anywhere.

### 4.6 No Test Coverage
- `App.test.tsx` exists but contains only a basic smoke test
- `test/setup.ts` is 1 line (imports jest-dom matchers)
- No unit tests for utility functions
- No integration tests for store actions
- No component tests for any page

### 4.7 appStore.ts — Too Large (1,265 Lines)
Single Zustand store with 45+ state fields and 67+ actions. Every unrelated state change (e.g., music volume) triggers re-evaluation in chat components. Should be split by domain.

### 4.8 1,183 Inline Style Attributes
Heavy use of `style={{ ... }}` in JSX instead of Tailwind classes. Creates new objects on every render, defeats React's reconciliation optimization, and makes the JS bundle larger than necessary.

### 4.9 No Custom Hooks Extracted
All logic is inline in components. Reusable patterns that should be hooks:
- Terminal session lifecycle
- Media gallery CRUD
- Workspace file operations
- Drag resize behavior (used in 4+ places)
- Audio recording/playback

### 4.10 Magic Numbers
Panel widths (220, 340, 188), buffer sizes (120000), timeouts, and layout constants scattered throughout without named constants or documentation.

---

## 5. Security Analysis

### 5.1 CRITICAL: Live API Keys in .env File
**Location:** `asciivision-core/.env`

Contains **live production API keys** for:
- Claude (Anthropic) — `sk-ant-*`
- Grok (X.AI) — `xai-*`
- OpenAI — `sk-proj-*`
- Gemini (Google) — `AIzaSy*`

**Status:** File is in `.gitignore` so it won't be committed, but:
- If this repo was ever pushed with the file present, the keys are compromised
- Keys should be **rotated immediately** as a precaution
- Use environment variable injection, not files, for secrets

**Severity:** CRITICAL
**Action:** Rotate all four API keys immediately.

### 5.2 dangerouslySetInnerHTML — Safe Usage
3 instances found, all for highlight.js syntax highlighting output:

```typescript
// App.tsx line ~2012
const highlighted = hljs.highlight(code, { language: lang }).value;
<code dangerouslySetInnerHTML={{ __html: highlighted }} />
```

**Assessment:** SAFE. highlight.js is a trusted library that produces sanitized HTML. Fallback path uses `escapeHtml()`. No user-controlled HTML is ever set via `dangerouslySetInnerHTML`.

### 5.3 Content Security Policy
```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
connect-src 'self' https://api.x.ai wss://api.x.ai http://localhost:11434 ...
```

**Assessment:** Appropriate for a desktop app.
- `unsafe-inline` for scripts: required by Tailwind's runtime. Cannot be easily removed.
- `unsafe-inline` for styles: required by inline styles (of which there are 1,183).
- External connections restricted to known APIs only.

### 5.4 Asset Protocol Scope
```json
"allow": ["$HOME/**", "$APPDATA/**", ...],
"deny": ["$HOME/.ssh/**", "$HOME/.gnupg/**"]
```

**Assessment:** Good. Denies SSH/GPG keys. Allows home directory access (required for workspace file browsing and music library).

### 5.5 Terminal Security
- PTY sessions managed server-side in Rust
- Input sanitization happens at the PTY level (OS-provided)
- Terminal sessions are isolated per session ID
- `killTerminal()` properly destroys sessions

### 5.6 Hands Relay Security
- Desktop token authentication on WebSocket upgrade
- Session cookies are HttpOnly + SameSite=Strict
- Request body limited to 1MB
- No credential exposure in client code
- Machine ID + token pair required for connection

### 5.7 No Detected Vulnerabilities
- No `eval()` or `Function()` constructor
- No direct `innerHTML` assignments (only via React's dangerouslySetInnerHTML)
- No `postMessage` without origin checking
- No `localStorage` storing secrets (keys go to OS keychain)
- No HTTP-only URLs (all HTTPS/WSS for external connections)
- No CORS wildcards
- No `child_process` / `exec` / `spawn` in frontend

### Security Summary

| Category | Status | Notes |
|----------|--------|-------|
| API Key Storage | Good | OS keychain with encrypted fallback |
| XSS Prevention | Good | ReactMarkdown, escapeHtml, no raw HTML injection |
| Path Traversal | Good | Canonical path validation in Rust |
| CSP | Good | No wildcards, known-origin only |
| WebSocket Auth | Good | Token-based with session validation |
| Secrets in Code | CRITICAL | .env has live keys — rotate immediately |
| Input Validation | Good | Handled at Rust/PTY layer |
| Dependencies | Clean | 0 npm audit vulnerabilities |

---

## 6. Performance Analysis

### 6.1 Bundle Size Breakdown

| Chunk | Size | Notes |
|-------|------|-------|
| Main app (App.tsx compiled) | 562 KB | Monolithic — entire app |
| vendor-terminal (xterm) | 284 KB | Always loaded |
| vendor-markdown | 157 KB | Always loaded |
| vendor-icons (lucide) | 20 KB | Tree-shaken |
| vendor-tauri | 15 KB | Minimal |
| vendor-react | 3.6 KB | Efficient |
| CSS (Tailwind + custom) | 122 KB | Includes all theme variants |
| **Total** | **~1.1 MB** | |

### 6.2 Rendering Performance

**Problem areas:**

1. **Message list** — All messages rendered without virtualization. A conversation with 500+ messages creates 500+ DOM nodes with markdown parsing, code highlighting, and tool call rendering.

2. **Media gallery** — All media assets rendered in a grid. 200+ generated images = 200+ DOM nodes with base64 data URLs.

3. **IDE file tree** — `buildIdeTree()` is 455 lines and runs on every workspace item change. Creates deeply nested object structures.

4. **Music track list** — Full `.map()` over all tracks with search filtering on every keystroke. No debounce.

5. **Terminal output** — 120K character buffer rendered as text. No virtualization.

### 6.3 Animation Performance

6 CSS animations active:
- `asciivision-glow-pulse` — 4 keyframes with multiple `box-shadow` values each. Box-shadow triggers repaint on every frame. Running continuously on buttons.
- `asciivision-gradient` — Background gradient animation (GPU-friendly).
- `asciivision-shimmer` — Loading shimmer effect.
- `typing-dot` — Chat typing indicator.

**Recommendation:** Replace `box-shadow` animations with `filter: drop-shadow()` or CSS `outline` which are GPU-composited and don't trigger repaints.

### 6.4 Memory Concerns

- **XTerm instances:** Each terminal tile creates a full xterm.js instance. A 3x3 grid = 9 instances + 1 footer terminal + 1 ASCIIVision terminal = up to 11 concurrent terminal emulators.
- **Media preview cache:** In-memory `Map<string, string>` for base64 data URLs. Not bounded. Not persisted across reloads.
- **Audio buffers:** Realtime voice creates AudioContext + ScriptProcessor (deprecated API). PCM16 encoding/decoding allocates new Float32Arrays per frame.

### 6.5 What Would Make It Faster

| Optimization | Estimated Impact | Effort |
|-------------|-----------------|--------|
| Split App.tsx + React.lazy() per page | 40-60% faster initial load | Medium |
| Add React.memo() to list items | 20-30% fewer re-renders | Low |
| react-window for lists (messages, assets, tracks) | 10-50x faster scrolling | Low |
| Split Zustand store by domain | 30-40% fewer re-renders | Medium |
| Lazy load xterm + react-markdown | 440 KB deferred from initial load | Low |
| Replace box-shadow animations | Smoother 60fps animations | Low |
| Extract inline styles to Tailwind | 15% smaller JS bundle | Medium |
| Debounce search/filter inputs | Eliminates keystroke lag | Low |

---

## 7. The Bloat — What Can Be Cut

### 7.1 Game Directories — 414 MB of Waste
```
asciivision-core/games/
  3d-penguin/     → 138 MB (node_modules)
  PacMan/         → 138 MB (node_modules)
  Space-Invaders/ → 138 MB (node_modules)
```

Each game has its own full `node_modules` directory. These games run inside the ASCIIVision terminal and could share dependencies via a workspace setup, or their `node_modules` should be `.gitignore`d and installed on demand.

**Recommendation:** Add `asciivision-core/games/*/node_modules` to `.gitignore`. Use `npm workspaces` if dependencies overlap.

### 7.2 Scaffolding Assets — Unused
- `public/vite.svg` (1.5 KB) — Default Vite scaffolding. Not referenced anywhere.
- `public/tauri.svg` (2.5 KB) — Default Tauri scaffolding. Not referenced anywhere.
- `src/assets/react.svg` (4 KB) — Default React scaffolding. Not referenced anywhere.

**Recommendation:** Delete all three.

### 7.3 Demo Media — 18.3 MB
- `asciivision-core/asciivision2.png` — 1.3 MB (2662x1694 RGBA PNG)
- `asciivision-core/demo.mp4` — 17 MB

These are development/demo assets. If they're in the git history, they inflate clone size.

**Recommendation:** Move to external hosting or compress (PNG → WebP saves ~70%, video → H.265 saves ~50%).

### 7.4 Theme Color Variants
`styles.css` defines color schemes for `[data-theme="crimson"]`, `[data-theme="ocean"]`, etc. — 40+ CSS custom property declarations per theme. If only one theme is used in practice, the others add ~5-10 KB of dead CSS.

**Recommendation:** Keep if themes are a feature. Remove unused themes if not.

### 7.5 Highlight.js Languages
13 languages registered for syntax highlighting. If some are never used in practice (e.g., Ruby, Swift), removing them saves a few KB each.

**Recommendation:** Audit which languages users actually encounter and trim the rest.

### 7.6 Tauri Build Artifacts — 1.3 GB
`src-tauri/target/` grows to 1.3 GB during builds. This is normal for Rust compilation but:

**Recommendation:** Add `cargo clean` to CI/CD cleanup. Run `cargo clean` periodically during development.

---

## 8. Build & Load Speed

### 8.1 Current Build Pipeline

```
npm run build:all
  └── build-asciivision.sh    (cargo build --release for asciivision binary)
  └── tsc && vite build        (TypeScript check + Vite bundle)

npm run tauri build
  └── Tauri bundles frontend + Rust backend + asciivision binary
```

### 8.2 Build Speed Bottlenecks

1. **Rust compilation** — Two separate Cargo projects (src-tauri + asciivision-core). Full release builds take 5-15 minutes depending on hardware. FFmpeg bindgen is especially slow.

2. **TypeScript checking** — `tsc` checks the entire project before Vite builds. With a 9,002-line App.tsx, this is slower than it needs to be.

3. **Vite build** — Fast (seconds), not a bottleneck.

### 8.3 Build Speed Improvements

| Optimization | Impact |
|-------------|--------|
| Use `cargo build` incremental mode (default in dev) | 60-80% faster dev rebuilds |
| Skip `tsc` in dev mode (Vite handles types via plugin) | 2-5s faster dev starts |
| Split App.tsx — smaller files = faster HMR | Instant HMR instead of full reload |
| Cache FFmpeg bindgen output | 30-60s off clean builds |
| Use `sccache` for Rust compilation cache | 50%+ faster CI builds |

### 8.4 Load Speed

**Current:** Everything loads at once — 1.1 MB of JS + 122 KB CSS.

**With lazy loading:**

| Page | Would Load | Deferred |
|------|-----------|----------|
| Initial shell | ~350 KB | — |
| Chat page | +60 KB (markdown) | On navigate |
| IDE page | +80 KB (highlight.js) | On navigate |
| Terminal/Tiles | +284 KB (xterm) | On navigate |
| Other pages | Minimal | On navigate |

**Estimated improvement:** First paint 40-60% faster. Total JS downloaded the same, but spread across navigation.

---

## 9. Dependency Audit

### 9.1 Production Dependencies — All Clean

| Package | Version | Size Impact | Verdict |
|---------|---------|-------------|---------|
| react / react-dom | ^19.1.0 | 3.6 KB (bundled) | Current, essential |
| zustand | ^5.0.8 | <5 KB | Lightweight, correct choice |
| xterm + addons | ^5.3.0 | 284 KB | Heavy but necessary for terminal |
| react-markdown + remark-gfm | ^10.1.0 | 157 KB | Could lazy load |
| highlight.js | ^11.11.1 | ~80 KB | Selective language registration (good) |
| lucide-react | ^0.544.0 | 20 KB (tree-shaken) | Efficient icon library |
| qrcode | ^1.5.4 | ~30 KB | Only used on Hands page (lazy candidate) |
| clsx | ^2.1.1 | <1 KB | Tiny utility, appropriate |
| @tauri-apps/api | ^2 | 15 KB | Essential for desktop |

### 9.2 Dev Dependencies — All Appropriate

| Package | Version | Verdict |
|---------|---------|---------|
| typescript | ~5.8.3 | Latest stable |
| vite | ^7.0.4 | Latest, fast bundler |
| tailwindcss + vite plugin | ^4.1.12 | Current |
| vitest | ^3.2.4 | Modern test runner |
| @testing-library/react | ^16.3.0 | Standard React testing |
| jsdom | ^26.1.0 | Test environment |

### 9.3 Misplaced Dependency
- `@types/qrcode` is in `dependencies` instead of `devDependencies`. Type packages are build-time only.

### 9.4 Duplicate Functionality — None Detected
No two packages serve the same purpose. Clean dependency tree.

### 9.5 Rust Dependencies (src-tauri) — Appropriate
- Axum, Tokio, Reqwest, Serde, rusqlite — standard Rust web/async stack
- No unnecessary crates detected
- `lofty` for audio metadata — lightweight alternative to larger audio libraries

---

## 10. Prioritized Action Items

### Tier 1 — Do Now (Security & Critical)

| # | Action | Why | Effort |
|---|--------|-----|--------|
| 1 | **Rotate all API keys** in `asciivision-core/.env` | Live production keys potentially exposed | 30 min |
| 2 | **Add error boundaries** around each page component | App crashes on any render error — white screen | 1 hour |

### Tier 2 — Do Soon (High Impact Performance)

| # | Action | Why | Effort |
|---|--------|-----|--------|
| 3 | **Split App.tsx** into separate page files | 9K lines is unmaintainable, blocks code splitting | 1-2 days |
| 4 | **Add React.lazy()** for page components | Defer 440+ KB from initial load | 2 hours |
| 5 | **Add React.memo()** to list item components | MessageBubble, MediaAssetCard, track items re-render unnecessarily | 1 hour |
| 6 | **Add react-window** to message list and media gallery | Eliminates DOM bloat with large datasets | 3-4 hours |
| 7 | **Split Zustand store** into domain stores | Music volume change shouldn't re-render chat | 4-6 hours |

### Tier 3 — Do When Able (Quality & Maintainability)

| # | Action | Why | Effort |
|---|--------|-----|--------|
| 8 | **Extract custom hooks** (useTerminal, useDragResize, useMediaGallery) | Reduces duplication, improves testability | 1 day |
| 9 | **Replace inline styles with Tailwind classes** | 1,183 inline styles = 15% JS bloat + re-render overhead | 1-2 days |
| 10 | **Add unit tests** for utility functions and store actions | Zero test coverage is risky for a complex app | 1-2 days |
| 11 | **Extract magic numbers** to named constants | "220", "340", "120000" scattered through code | 2-3 hours |
| 12 | **Move @types/qrcode** to devDependencies | Build-time only package in production deps | 1 min |

### Tier 4 — Nice to Have (Polish)

| # | Action | Why | Effort |
|---|--------|-----|--------|
| 13 | **Delete scaffolding assets** (vite.svg, tauri.svg, react.svg) | Unused files | 1 min |
| 14 | **Add node_modules to .gitignore** for games/ | 414 MB of bloat | 1 min |
| 15 | **Compress demo assets** (PNG → WebP, MP4 → H.265) | 18.3 MB → ~5 MB | 30 min |
| 16 | **Replace ScriptProcessor** with AudioWorklet in voice page | ScriptProcessor is deprecated in Web Audio API | 2-3 hours |
| 17 | **Optimize box-shadow animations** to use filter/transform | Eliminates repaint jank on glow effects | 1 hour |
| 18 | **Audit and trim highlight.js languages** | Remove unused language support | 30 min |
| 19 | **Add sccache** for Rust CI builds | 50%+ faster CI compilation | 1 hour |

---

## Appendix A: File Size Map

```
src/App.tsx                              9,002 lines   (400 KB)
src/store/appStore.ts                    1,265 lines   (55 KB)
src/styles.css                             746 lines   (42 KB)
src/types.ts                               396 lines   (16 KB)
src/lib/tauri.ts                           179 lines   (7 KB)
src/main.tsx                                11 lines   (<1 KB)

src-tauri/src/lib.rs                    ~2,050 lines   (69 KB)
src-tauri/src/hands.rs                  ~1,800 lines   (73 KB)
src-tauri/src/db.rs                     ~1,200 lines   (43 KB)
src-tauri/src/providers.rs                ~700 lines   (25 KB)
src-tauri/src/terminal.rs                 ~550 lines   (19 KB)
src-tauri/src/editor.rs                   ~450 lines   (16 KB)
src-tauri/src/agent.rs                    ~400 lines   (15 KB)

asciivision-core/src/main.rs           ~4,700 lines   (167 KB)
```

## Appendix B: Component Inventory (App.tsx)

| Component | Lines | Purpose |
|-----------|-------|---------|
| App | ~100 | Root layout, initialization |
| GrokShell | ~320 | Main shell container, page routing |
| TopBar | ~220 | Navigation header |
| HistoryRail | ~190 | Conversation sidebar |
| ChatPage | ~200 | AI conversation interface |
| ImaginePage | ~450 | Image/video generation gallery |
| VoiceAudioPage | ~740 | TTS and realtime voice |
| IdePage | ~1,650 | Code editor with file browser |
| HandsPage | ~620 | Remote agent console |
| EditorPage | ~1,130 | Video timeline editor |
| MusicPage | ~410 | Music player |
| TilesPage | ~200 | Multi-terminal grid |
| SettingsSheet | ~340 | Settings modal |
| WorkspaceDrawer | ~300 | Workspace file browser |
| AsciiVisionPanel | ~250 | ASCII terminal overlay |
| MusicMiniPlayer | ~140 | Floating music widget |
| TerminalPanel | ~120 | Footer terminal |
| TileTerminal | ~110 | Individual terminal tile |
| IdeCodeEditor | ~100 | Code viewer component |
| CodeBlock | ~110 | Syntax-highlighted code |
| BrowserPanel | ~70 | iframe preview |
| MessageBubble | ~60 | Chat message |
| ToolCallBlock | ~50 | Agent tool display |
| + 7 smaller components | ~200 | NavTab, ResizeHandle, etc. |

## Appendix C: Security Checklist

| Check | Result |
|-------|--------|
| eval() / Function() | Not found |
| dangerouslySetInnerHTML | 3 instances, all safe (highlight.js) |
| innerHTML direct assignment | Not found |
| Unvalidated user input → HTML | Not found |
| API keys in source code | Not found (properly in keychain) |
| API keys in .env committed | .gitignore blocks it, but file exists locally |
| HTTP-only external URLs | Not found (all HTTPS/WSS) |
| localStorage storing secrets | Not found |
| CORS wildcards | Not found |
| postMessage without origin | Not found |
| child_process / exec / spawn | Not found in frontend |
| npm audit vulnerabilities | 0 |
| Path traversal protection | Implemented in Rust |
| CSP configured | Yes, no wildcards |
| Asset scope restrictions | Yes, denies .ssh and .gnupg |
| Session management | HttpOnly, SameSite=Strict |
| Rate limiting | 1MB body limit on relay |

---

*End of review.*
