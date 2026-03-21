# Super ASCIIVision

A cross-platform desktop app combining an **AI-powered GUI shell** (chat with xAI and Ollama, image/video generation, voice, IDE, terminal tiles, music player, mobile bridge) with **ASCIIVision** (a full terminal experience — multi-AI chat, ASCII video, webcam, 3D effects, games, system monitoring).

Click the rainbow **ASCIIVISION** button in the nav bar to drop into the terminal. Press **Ctrl+Esc** or click **BACK TO APP** to return.

---

## Desktop Shell

| Page | What it does |
|------|-------------|
| **Chat** | Streamed conversations with xAI or Ollama models, workspace-backed context, agentic tool use (file read/write, shell commands, search) |
| **Image & Video** | Image and video generation via xAI, category-organized gallery |
| **Voice & Audio** | Text-to-speech generation and live realtime voice chat |
| **Media Editor** | Timeline-based export workflow via ffmpeg |
| **IDE** | File explorer, code editor with syntax highlighting, AI copilot (xAI or Ollama), browser preview |
| **Tiles** | 1x2, 2x2, or 3x3 grid of independent PTY terminal sessions |
| **Music** | Built-in player — MP3/WAV/OGG/FLAC/M4A/AAC/OPUS/WMA, metadata display, mini-player bar, shuffle/repeat |
| **Hands** | Mobile bridge — pair your phone, chat and generate media remotely |
| **Settings** | Model selection, voice config, always-on-top, API key management |

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

### macOS

```bash
git clone https://github.com/lalomorales22/Super-Asciivision.git
cd Super-Asciivision
./install.sh
```

The script checks for prerequisites (Xcode CLI Tools, Homebrew, Node.js 20+, Rust, FFmpeg, LLVM, pkg-config, yt-dlp), installs anything missing, builds both apps, and copies the bundle into `/Applications`.

#### From a Release DMG

1. Download the latest `.dmg` from [Releases](https://github.com/lalomorales22/Super-Asciivision/releases).
2. Drag `Super ASCIIVision.app` into `Applications`.
3. First launch requires clearing the quarantine flag (app is not code-signed yet):
   ```bash
   xattr -cr "/Applications/Super ASCIIVision.app"
   ```
   Then right-click the app and choose **Open**. After this one-time step it opens normally.

### Linux (Ubuntu/Debian, Fedora, Arch, openSUSE)

```bash
git clone https://github.com/lalomorales22/Super-Asciivision.git
cd Super-Asciivision
./install-linux.sh
```

The script installs all system dependencies (Tauri prerequisites, FFmpeg dev libs, libsecret, LLVM, Node.js, Rust, Ollama), builds both apps, and installs the binary to `~/.local/bin`.

#### Ollama Setup (Local AI)

The app supports **Ollama** for fully local, private AI chat and agent mode. We recommend `qwen3.5:2b` — it supports tool use, vision, and runs well on modest hardware:

```bash
# Start the Ollama service
ollama serve

# Pull the recommended model
ollama pull qwen3.5:2b
```

Then in the app, click the **Ollama** button (next to xAI) in the Chat or IDE pages to switch to local models. Your installed Ollama models will appear in the dropdown automatically.

> **Note:** Ollama runs entirely on your machine — no API key needed, no data leaves your device.

---

## Build From Source

### macOS

**Requirements:** macOS, Node.js 20+, Rust stable, Xcode CLI Tools, FFmpeg, LLVM/libclang, pkg-config

```bash
# Install system dependencies
brew install ffmpeg llvm pkg-config yt-dlp

# Install npm dependencies
npm install

# Build ASCIIVision sidecar binary (auto-detects LLVM and FFmpeg paths)
./build-asciivision.sh

# Development
npm run tauri dev

# Production build (.app + .dmg)
npm run tauri build
```

Install the locally built app:

```bash
ditto "src-tauri/target/release/bundle/macos/Super ASCIIVision.app" "/Applications/Super ASCIIVision.app"
```

### Linux

**Requirements:** Node.js 20+, Rust stable, FFmpeg dev libs, libclang, pkg-config, webkit2gtk-4.1, GTK3, libsecret

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libavformat-dev libavcodec-dev libswscale-dev libavutil-dev \
  libavdevice-dev libsecret-1-dev pkg-config libclang-dev build-essential ffmpeg yt-dlp

# Install npm dependencies
npm install

# Build ASCIIVision sidecar binary
./build-asciivision.sh

# Development
npm run tauri dev

# Production build (.deb + .AppImage)
npm run tauri build
```

---

## API Keys

### Desktop Shell (xAI)

Open **Settings** in the app and paste your xAI API key. Stored in the system keychain (macOS Keychain / Linux Secret Service).

### Desktop Shell (Ollama)

No API key needed. Just run `ollama serve` and pull a model (e.g., `ollama pull qwen3.5:2b`). The app detects Ollama automatically.

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

Pair your phone for remote access to chat, image/video/audio generation, and local workspace operations. You need a relay server so your phone can reach the desktop app over the internet.

### Deploy the Relay on Render

1. **Create a Render account** at [render.com](https://render.com) (free tier works).
2. **Connect your GitHub** — link the repo that contains this project.
3. **Create a Blueprint:**
   - From the Render dashboard, click **New** > **Blueprint**.
   - Select this repository. Render will detect the `render.yaml` at the root.
   - Click **Apply** — this creates the `hands-relay` web service automatically on the free plan.
4. **Wait for the deploy** to finish. Render will give you an HTTPS URL like:
   ```
   https://hands-relay-xxxx.onrender.com
   ```
5. **Keep this URL private.** Anyone with it could connect to your relay. Do not share it publicly or commit it to a repo.

### Connect the App

1. In Super ASCIIVision, go to the **Hands** page.
2. Set **Provider** to `Hands Relay`.
3. Paste your Render HTTPS URL into the **Relay URL** field.
4. Click **Start secure link** — the desktop opens a WebSocket to the relay and generates a pairing code.
5. On your phone, open the relay URL in a browser (e.g., `https://hands-relay-xxxx.onrender.com`).
6. Enter the **pairing code** shown in the app. Once paired, you can chat, generate images/video/audio, and browse workspace files from your phone.

### Security Notes

- **Always deploy your own relay instance** — do not use someone else's relay, since all traffic passes through it.
- The relay authenticates desktop connections with a token and phone connections with a one-time pairing code.
- Render provides HTTPS and WSS automatically — traffic between your phone and the relay is encrypted in transit.
- Free-tier Render services sleep after inactivity. The first phone request after idle may take 30–60 seconds to wake up.
- Optionally set the `HANDS_PUBLIC_BASE_URL` environment variable in Render if you attach a custom domain.

---

## Privacy

| What | Where |
|------|-------|
| xAI API key | System keychain (macOS Keychain / Linux Secret Service) |
| App data (conversations, settings, media) | `~/Library/Application Support/SuperASCIIVision/` (macOS) or `~/.local/share/SuperASCIIVision/` (Linux) |
| Music library | `~/Music/SuperASCIIVision/` (configurable) |
| ASCIIVision conversations | `~/.config/asciivision/conversations.db` |
| Ollama models | Local only — managed by Ollama in `~/.ollama/` |

No data is sent anywhere except to the AI provider APIs you configure. Ollama runs entirely on your machine. This repo contains no keys or user data.

---

## Validation

```bash
npx tsc --noEmit                                   # TypeScript
cargo check --manifest-path src-tauri/Cargo.toml    # Rust (Tauri)
cargo check --manifest-path asciivision-core/Cargo.toml  # Rust (ASCIIVision)
npm test                                            # Frontend tests
cargo test --manifest-path src-tauri/Cargo.toml     # Backend tests
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
│   ├── src/providers.rs        # xAI + Ollama API integration
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
├── install-linux.sh            # One-line Linux installer
└── render.yaml                 # Render Blueprint for hands-relay deployment
```

## License

MIT
