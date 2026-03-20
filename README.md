# Super ASCIIVision

A unified macOS desktop app combining an **xAI-powered GUI shell** (chat, image/video generation, voice, IDE, terminal tiles, music player, mobile bridge) with **ASCIIVision** (a full terminal experience — multi-AI chat, ASCII video, webcam, 3D effects, games, system monitoring).

Click the rainbow **ASCIIVISION** button in the nav bar to drop into the terminal. Press **Ctrl+Esc** or click **BACK TO APP** to return.

---

## Desktop Shell

| Page | What it does |
|------|-------------|
| **Chat** | Streamed conversations with xAI models, workspace-backed context, agentic tool use (file read/write, shell commands, search) |
| **Image & Video** | Image and video generation via xAI, category-organized gallery |
| **Voice & Audio** | Text-to-speech generation and live realtime voice chat |
| **Media Editor** | Timeline-based export workflow via ffmpeg |
| **IDE** | File explorer, code editor with syntax highlighting, AI copilot, browser preview |
| **Tiles** | 1x2, 2x2, or 3x3 grid of independent PTY terminal sessions |
| **Music** | Built-in player — MP3/WAV/OGG/FLAC/M4A/AAC/OPUS/WMA, metadata display, mini-player bar, shuffle/repeat |
| **Hands** | Mobile bridge — pair your phone, chat and generate media remotely |
| **Settings** | Model selection, voice config, always-on-top, API key management (macOS Keychain) |

## ASCIIVision Terminal

| Feature | Details |
|---------|---------|
| **Multi-AI Chat** | Claude, Grok, GPT, Gemini, local Ollama — live provider switching (F2) |
| **Agentic Tools** | Shell commands, file I/O, codebase search, HTTP requests, system queries |
| **ASCII Video** | MP4 and YouTube decoded to real-time colored ASCII art via FFmpeg |
| **Live Webcam** | Camera feed as ASCII art in real-time (F5) |
| **Video Chat** | WebSocket-based multi-user live ASCII video rooms |
| **3D Effects** | Matrix rain, plasma, starfield, wireframe cube, fire, particle storms (F4) |
| **Tiling** | PTY-backed terminals in 1–8 way grids with Hyprland-style Ctrl+hjkl controls (F6/F7) |
| **Games** | Pac-Man, Space Invaders, 3D Penguin |
| **System Monitor** | CPU, memory, swap, network I/O, load average, per-core sparklines |
| **Themes** | F9 randomizes colors, F10 resets |

---

## Install

### One-Line Install

```bash
git clone https://github.com/lalomorales22/Super-Asciivision.git
cd Super-Asciivision
./install.sh
```

The script checks for prerequisites (Xcode CLI Tools, Homebrew, Node.js 20+, Rust, FFmpeg, LLVM, pkg-config, yt-dlp), installs anything missing, builds both apps, and copies the bundle into `/Applications`.

### From a Release DMG

1. Download the latest `.dmg` from [Releases](https://github.com/lalomorales22/Super-Asciivision/releases).
2. Drag `Super ASCIIVision.app` into `Applications`.
3. First launch requires clearing the quarantine flag (app is not code-signed yet):
   ```bash
   xattr -cr "/Applications/Super ASCIIVision.app"
   ```
   Then right-click the app and choose **Open**. After this one-time step it opens normally.

---

## Build From Source

**Requirements:** macOS, Node.js 20+, Rust stable, Xcode CLI Tools, FFmpeg, LLVM/libclang, pkg-config

```bash
brew install ffmpeg llvm pkg-config yt-dlp

npm install
./build-asciivision.sh        # Build ASCIIVision + copy to sidecar

npm run tauri dev              # Development
npm run tauri build            # Production (.app + .dmg)
```

Install the locally built app:

```bash
ditto "src-tauri/target/release/bundle/macos/Super ASCIIVision.app" "/Applications/Super ASCIIVision.app"
```

---

## API Keys

### Desktop Shell (xAI)

Open **Settings** in the app and paste your xAI API key. Stored in macOS Keychain.

### ASCIIVision (Multi-Provider)

Create `asciivision-core/.env` with the providers you want:

```env
CLAUDE_API_KEY=sk-ant-...
GROK_API_KEY=xai-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
```

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Super ASCIIVision (Tauri 2)                     │
│                                                  │
│  Frontend (React/TS)         Backend (Rust)       │
│  ┌──────────────────┐       ┌──────────────────┐ │
│  │ App.tsx (~6.8K)   │◄─IPC─►│ lib.rs (commands)│ │
│  │ appStore.ts       │       │ terminal.rs (PTY)│ │
│  │ tauri.ts (bridge) │       │ hands.rs (mobile)│ │
│  │ types.ts          │       │ agent.rs (tools) │ │
│  └──────────────────┘       │ providers.rs     │ │
│         │                    │ db.rs (SQLite)   │ │
│         │ xterm.js           │ keychain.rs      │ │
│         ▼                    └────────┬─────────┘ │
│  ┌──────────────────┐                │ sidecar    │
│  │ ASCIIVision Panel │◄──────PTY─────┘            │
│  │ (inline terminal) │                            │
│  └──────────────────┘                             │
│                                                  │
│  ASCIIVision Core (Rust/ratatui, 18 files, ~11K) │
└──────────────────────────────────────────────────┘
```

**ASCIIVision integration:** The ASCIIVISION button spawns the asciivision binary in a PTY. An inline xterm.js panel renders the output with full truecolor support. All keyboard input passes through. Ctrl+Esc kills the PTY and returns to the GUI shell.

---

## Hands (Mobile Bridge)

Pair your phone for remote access to chat, image/video/audio generation, and local workspace operations.

1. Deploy a [Hands Relay](hands-relay) on [Render](https://render.com) (or use Cloudflare tunnel).
2. In the app: **Hands** > set Provider to `Hands Relay` > paste your HTTPS URL > **Start secure link**.
3. Scan the QR code on your phone.

> **Note:** Relay traffic is plaintext — always deploy your own relay instance.

---

## Privacy

| What | Where |
|------|-------|
| xAI API key | macOS Keychain |
| App data (conversations, settings, media) | `~/Library/Application Support/SuperASCIIVision/` |
| Music library | `~/Music/SuperASCIIVision/` (configurable) |
| ASCIIVision conversations | `~/.config/asciivision/conversations.db` |

No data is sent anywhere except to the AI provider APIs you configure. This repo contains no keys or user data.

---

## Validation

```bash
npx tsc --noEmit                       # TypeScript
cd src-tauri && cargo check            # Rust (Tauri)
cd ../asciivision-core && cargo check  # Rust (ASCIIVision)
npm test                                # Frontend tests
cd src-tauri && cargo test             # Backend tests
```

---

## Project Layout

```
├── src/                        # React/TypeScript frontend
│   ├── App.tsx                 # All pages and components (~6.8K lines)
│   ├── store/appStore.ts       # Zustand state management (~1.1K lines)
│   ├── lib/tauri.ts            # IPC bridge to Rust backend
│   └── types.ts                # Shared types
├── src-tauri/                  # Rust backend (14 source files, ~8.8K lines)
│   ├── src/lib.rs              # Tauri commands — chat, media, terminal, music
│   ├── src/agent.rs            # Agentic tool-use loop
│   ├── src/terminal.rs         # PTY session management
│   ├── src/hands.rs            # Mobile bridge service
│   ├── src/providers.rs        # xAI API integration
│   ├── src/db.rs               # SQLite persistence
│   ├── src/keychain.rs         # Keychain + file secret store with migration
│   └── binaries/               # ASCIIVision sidecar (built by build-asciivision.sh)
├── asciivision-core/           # ASCIIVision (Rust/ratatui, 18 files, ~11K lines)
│   ├── demo-videos/            # Intro video and samples
│   └── games/                  # Pac-Man, Space Invaders, 3D Penguin
├── hands-relay/                # Standalone Node.js relay for mobile bridge
├── docs/                       # Handoff documents and dev notes
├── build-asciivision.sh        # Builds ASCIIVision + copies to sidecar
├── install.sh                  # One-line macOS installer
└── render.yaml                 # Render Blueprint for hands-relay deployment
```

## License

MIT
