# Super ASCIIVision
<img width="1536" height="1024" alt="super-asciivision" src="https://github.com/user-attachments/assets/e70e3836-093e-44b0-9ec6-07241a0ea04a" />

X Community : https://x.com/i/communities/2037938743798378894

A cross-platform desktop app combining an **AI-powered GUI shell** (chat with xAI and Ollama, image/video generation, voice, IDE, terminal tiles, music player, mobile bridge) with **ASCIIVision** (a full terminal experience — multi-AI chat, ASCII video, webcam, 3D effects, games, system monitoring).

Click the rainbow **ASCIIVISION** button in the nav bar to drop into the terminal. Press **Ctrl+Esc** or click **BACK TO APP** to return.

---

## Desktop Shell

| Page | What it does |
|------|-------------|
| **Chat** | Streamed conversations with xAI or Ollama models, workspace-backed context, agentic tool use (file read/write, shell commands, search) |
| **Image & Video** | Image and video generation via xAI or locally with Ollama (FLUX models), category-organized gallery |
| **Voice & Audio** | Text-to-speech generation and live realtime voice chat |
| **Media Editor** | Timeline-based export workflow via ffmpeg |
| **IDE** | File explorer, multi-tab code editor with syntax highlighting, AI copilot (xAI or Ollama), Quick Open (Cmd+P), browser preview — opens without a workspace |
| **Tiles** | 1x2, 2x2, or 3x3 grid of independent PTY terminal sessions |
| **Music** | Built-in player — MP3/WAV/OGG/FLAC/M4A/AAC/OPUS/WMA, metadata display, hideable mini-player bar, shuffle/repeat, playlist/category sidebar with drag-and-drop import |
| **Hands** | Mobile bridge — pair your phone over WiFi (zero setup) or deploy a relay for remote access. Chat, generate media, and access your workspace from your phone |
| **Settings** | Theme selector (6 themes), model selection, default Ollama model, voice config, always-on-top, API key management for xAI + ASCIIVision providers |

### Themes

Six built-in color themes that restyle all buttons, borders, active states, and accents across the entire app:

**Emerald** (default) · **Ocean** (blue/cyan) · **Sunset** (orange/rose) · **Violet** (purple/pink) · **Golden** (amber/yellow) · **Crimson** (red/rose)

Switch themes in **Settings** — changes apply instantly with live preview. The animated logo glow and nav indicator adapt to match.

## ASCIIVision Terminal

| Feature | Details |
|---------|---------|
| **Multi-AI Chat** | Claude, Grok, GPT, Gemini, local Ollama — live provider switching (F2) |
| **Agentic Tools** | Shell commands, file I/O, codebase search, HTTP requests, system queries |
| **ASCII Video** | MP4 and YouTube decoded to real-time colored ASCII art via FFmpeg |
| **Live Webcam** | Camera feed as ASCII art in real-time (F5) |
| **Video Chat** | WebSocket-based multi-user live ASCII video rooms |
| **3D Effects** | Matrix rain, plasma, starfield, wireframe cube, fire, particle storms (F4) |
| **Tiling** | PTY-backed terminals in 1–8 way grids with Ctrl+WASD focus/swap (F6/F7) |
| **Games** | Pac-Man, Space Invaders, 3D Penguin |
| **System Monitor** | CPU, memory, swap, network I/O, load average, per-core sparklines |
| **Themes** | F9 cycles through color themes, F10 resets |

---

## Install

### macOS

```bash
git clone https://github.com/lalomorales22/Super-Asciivision.git
cd Super-Asciivision
./install.sh
```

The script checks for prerequisites (Xcode CLI Tools, Homebrew, Node.js 20+, Rust, FFmpeg, LLVM, pkg-config, yt-dlp), installs anything missing, builds both apps, and copies the bundle into `/Applications`.


### Linux (Ubuntu/Debian, Fedora, Arch, openSUSE)

```bash
git clone https://github.com/lalomorales22/Super-Asciivision.git
cd Super-Asciivision
./install-linux.sh
```

The script handles everything: system dependencies (Tauri/WebKit, FFmpeg dev libs, libsecret, libssl, LLVM/libclang), Node.js, Rust, Ollama, builds both apps, and installs the binary to `~/.local/bin`. First build takes a while (compiling ~1000 Rust crates) — subsequent rebuilds are fast.

Tested on: Ubuntu 22.04 (NVIDIA Jetson Orin Nano aarch64), Ubuntu 24.04, Fedora, Arch.

#### Ollama Setup (Local AI)

The app supports **Ollama** for fully local, private AI chat and agent mode. We recommend `qwen3.5:2b` — it supports tool use, vision, and runs well on modest hardware:

```bash
# Start the Ollama service
ollama serve

# Pull the recommended model
ollama pull qwen3.5:2b
```

Then in the app, click the **Ollama** button (next to xAI) in the Chat or IDE pages to switch to local models. Your installed Ollama models will appear in the dropdown automatically.

**Local image generation:** If you pull a FLUX model, you can generate images entirely on-device — no xAI key required:

```bash
ollama pull x/flux2-klein:4b    # lighter, faster
ollama pull x/flux2-klein:9b    # higher quality
```

> **Note:** Ollama runs entirely on your machine — no API key needed, no data leaves your device.

#### Troubleshooting (Linux)

**Pango version mismatch (Jetson / L4T):** If `apt` fails with `libpango1.0-dev` dependency errors, NVIDIA's patched pango conflicts with the upstream `-dev` package. The install script handles this automatically, but if you hit it manually:
```bash
sudo apt-get install -y --allow-downgrades \
  libpango-1.0-0=1.50.6+ds-2 libpangocairo-1.0-0=1.50.6+ds-2 \
  libpangoft2-1.0-0=1.50.6+ds-2 libpangoxft-1.0-0=1.50.6+ds-2 \
  gir1.2-pango-1.0=1.50.6+ds-2
```

**OpenSSL not found:** Install `libssl-dev` (Debian/Ubuntu), `openssl-devel` (Fedora), or `libopenssl-devel` (openSUSE).

**`rustc: command not found` after install:** Run `source "$HOME/.cargo/env"` or open a new terminal.

**ASCIIVision laggy on ARM:** The intro video + ASCII rendering is CPU-intensive. Skip the intro with `--skip-intro` or press Enter/Space immediately. See `asciivision --help` for options.

---

## Uninstall

To completely remove Super ASCIIVision and all of its data:

```bash
./uninstall.sh
```

Works on both macOS and Linux. The script removes everything:

- **App binary** — `/Applications/Super ASCIIVision.app` (macOS) or `~/.local/bin/super-asciivision` (Linux)
- **App data** — database, settings, workspaces, secrets
- **ASCIIVision data** — terminal chat history (`~/.config/asciivision/`)
- **Keychain / secret store** — stored API keys (macOS Keychain / Linux Secret Service)
- **WebView cache** (macOS)
- **Desktop entry and icon** (Linux)
- **Music folder** — only if you confirm (prompted separately)

The script asks for confirmation before removing anything.

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

Open **Settings** in the app and add your API keys for Claude, OpenAI, and Gemini. Your xAI key is shared automatically. ASCIIVision picks them up when you launch it — no manual `.env` editing needed.

---

## Architecture

```
┌───────────────────────────────────────────────────────┐
│  Super ASCIIVision (Tauri 2)                          │
│                                                       │
│  Frontend (React/TS)              Backend (Rust)      │
│  ┌─────────────────────────┐    ┌──────────────────┐  │
│  │ App.tsx (boot wrapper)  │◄IPC►│ lib.rs (commands)│  │
│  │ pages/ (8 lazy-loaded)  │    │ terminal.rs (PTY)│  │
│  │ components/ (shared UI) │    │ hands.rs (mobile)│  │
│  │ store/ (8 Zustand)      │    │ agent.rs (tools) │  │
│  │ utils/ (8 pure fn libs) │    │ providers.rs     │  │
│  │ hooks/ (useDragResize)  │    │ db.rs (SQLite)   │  │
│  │ lib/tauri.ts (bridge)   │    │ keychain.rs      │  │
│  └─────────────────────────┘    └────────┬─────────┘  │
│         │                                │ sidecar     │
│         │ xterm.js                       │             │
│         ▼                                │             │
│  ┌──────────────────┐                    │             │
│  │ ASCIIVision Panel │◄──────PTY─────────┘             │
│  │ (inline terminal) │                                 │
│  └──────────────────┘                                  │
│                                                       │
│  ASCIIVision Core (Rust/ratatui, 18 files, ~11.6K)    │
└───────────────────────────────────────────────────────┘
```

**Frontend architecture:** The UI is split into 8 lazy-loaded page components, 8 domain-specific Zustand stores (chat, media, workspace, music, terminal, settings, hands, tiles), shared components, utility libraries, and custom hooks. Error boundaries wrap page content. List items use `React.memo` and the music track list is virtualized with `react-window`.

**ASCIIVision integration:** The ASCIIVISION button spawns the asciivision binary in a PTY. An inline xterm.js panel renders the output with full truecolor support. All keyboard input passes through. Ctrl+Esc kills the PTY and returns to the GUI shell.

---

## Hands (Mobile Bridge)

Pair your phone to chat, generate images/video/audio, and access your workspace remotely. Hands has three modes:

### Local Network (default — zero setup)

Works instantly when your phone and desktop are on the same WiFi:

1. Go to the **Hands** page.
2. Make sure **Provider** is set to `Local Network`.
3. Click **Start secure link** — the app detects your LAN IP and generates a QR code.
4. Scan the QR code on your phone and enter the **pairing code**.

No accounts, no deployment, no cloud services. All traffic stays on your local network.

### Remote Access via Relay

For access away from home, deploy the included relay server. See [`hands-relay/README.md`](hands-relay/README.md) for setup instructions (one-click Render deploy or manual).

### Security Notes

- **Local Network mode** keeps all traffic on your WiFi — nothing leaves your network.
- **Relay mode**: always deploy your own relay instance. The relay authenticates desktop connections with a token and phone connections with a one-time pairing code.
- Render provides HTTPS and WSS automatically. Free-tier services sleep after inactivity (30–60s wake-up).
- Optionally set the `HANDS_PUBLIC_BASE_URL` environment variable in Render if you attach a custom domain.

---

## API Documentation

The `docs/` directory contains a self-contained PHP app with the full API reference, development history, and an AI chat assistant powered by Ollama:

```bash
cd docs
php -S localhost:8000
```

Then open [localhost:8000](http://localhost:8000). The AI assistant requires Ollama running locally and can answer questions about every Tauri command, type, and module in the codebase.

---

## Privacy

| What | Where |
|------|-------|
| xAI API key | System keychain (macOS Keychain / Linux Secret Service) |
| ASCIIVision API keys (Claude, OpenAI, Gemini) | `~/.config/superasciivision/secrets/*.key` (0600 permissions, auto-syncs xAI key from Settings) |
| App data (conversations, settings, themes, media) | `~/Library/Application Support/SuperASCIIVision/` (macOS) or `~/.local/share/SuperASCIIVision/` (Linux) |
| Music library & playlists | `~/Music/SuperASCIIVision/` (configurable) — subfolders are playlists/categories |
| ASCIIVision conversations | `~/.config/asciivision/conversations.db` |
| Ollama models | Local only — managed by Ollama in `~/.ollama/` |

No data is sent anywhere except to the AI provider APIs you configure. Ollama runs entirely on your machine. This repo contains no keys or user data.

---

## Validation

```bash
npx tsc --noEmit                                   # TypeScript (strict mode)
npm test                                            # Frontend tests (122 Vitest)
cargo check --manifest-path src-tauri/Cargo.toml    # Rust (Tauri)
cargo check --manifest-path asciivision-core/Cargo.toml  # Rust (ASCIIVision)
cargo test --manifest-path src-tauri/Cargo.toml     # Backend tests
```

---

## Project Layout

```
├── src/                        # React/TypeScript frontend
│   ├── App.tsx                 # Boot wrapper + hljs registration (~93 lines)
│   ├── main.tsx                # Entry point
│   ├── types.ts                # Shared types (30+ interfaces)
│   ├── constants.ts            # Model lists, config defaults
│   ├── pages/                  # 8 lazy-loaded page components
│   │   ├── ChatPage.tsx        #   AI chat with streaming + agent mode
│   │   ├── ImaginePage.tsx     #   Image/video generation gallery
│   │   ├── VoiceAudioPage.tsx  #   TTS + realtime voice
│   │   ├── EditorPage.tsx      #   Timeline-based media editor
│   │   ├── IdePage.tsx         #   File explorer + code editor + AI copilot
│   │   ├── TilesPage.tsx       #   Terminal tile grid
│   │   ├── MusicPage.tsx       #   Music player (virtualized track list)
│   │   └── HandsPage.tsx       #   Mobile bridge setup
│   ├── components/             # Shared UI (memo'd list items, layout shell)
│   │   ├── layout/             #   GrokShell, TopBar, HistoryRail, panels, sidebars
│   │   ├── MessageBubble.tsx   #   Chat message (React.memo)
│   │   ├── CodeBlock.tsx       #   Syntax-highlighted code (React.memo)
│   │   └── ...                 #   NavTab, ToolCallBlock, ErrorBoundary, etc.
│   ├── store/                  # 8 domain-specific Zustand stores
│   │   ├── appStore.ts         #   Settings, providers, models, init orchestration
│   │   ├── chatStore.ts        #   Conversations, messaging, agent mode
│   │   ├── mediaStore.ts       #   Media assets, generation, realtime
│   │   ├── workspaceStore.ts   #   Workspace CRUD, selection, scanning
│   │   ├── musicStore.ts       #   Music playback, library, playlists
│   │   ├── terminalStore.ts    #   Terminal PTY, browser preview
│   │   ├── handsStore.ts       #   Hands service status
│   │   └── tileStore.ts        #   Terminal tile layout
│   ├── utils/                  # 8 pure function libraries (with unit tests)
│   ├── hooks/                  # Custom hooks (useDragResize, etc.)
│   └── lib/tauri.ts            # IPC bridge to Rust backend
├── src-tauri/                  # Rust backend (15 source files, ~10.3K lines)
│   ├── src/lib.rs              # Tauri commands — chat, media, terminal, music
│   ├── src/agent.rs            # Agentic tool-use loop
│   ├── src/terminal.rs         # PTY session management
│   ├── src/hands.rs            # Mobile bridge service
│   ├── src/providers.rs        # xAI + Ollama API integration
│   ├── src/db.rs               # SQLite persistence
│   ├── src/keychain.rs         # Keychain + file secret store with migration
│   └── binaries/               # ASCIIVision sidecar (built by build-asciivision.sh)
├── asciivision-core/           # ASCIIVision (Rust/ratatui, 18 files, ~11.6K lines)
│   └── demo-videos/            # Intro video and samples
├── hands-relay/                # Standalone Node.js relay for mobile bridge
├── docs/                       # API docs site with Ollama AI assistant and one-click copy
├── build-asciivision.sh        # Builds ASCIIVision + copies to sidecar
├── install.sh                  # One-line macOS installer
├── install-linux.sh            # One-line Linux installer
└── render.yaml                 # Render Blueprint for hands-relay deployment
```

## License

MIT
