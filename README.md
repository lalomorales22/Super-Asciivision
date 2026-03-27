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
| **IDE** | File explorer, multi-tab code editor with syntax highlighting, AI copilot (xAI or Ollama), Quick Open (Cmd+P), browser preview — opens without a workspace |
| **Tiles** | 1x2, 2x2, or 3x3 grid of independent PTY terminal sessions |
| **Music** | Built-in player — MP3/WAV/OGG/FLAC/M4A/AAC/OPUS/WMA, metadata display, hideable mini-player bar, shuffle/repeat, playlist/category sidebar with drag-and-drop import |
| **Hands** | Mobile bridge — pair your phone, chat and generate media remotely (Render relay or Cloudflare tunnel) |
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

The script handles everything: system dependencies (Tauri/WebKit, FFmpeg dev libs, libsecret, libssl, LLVM/libclang), Node.js, Rust, Ollama, builds both apps, and installs the binary to `~/.local/bin`. First build takes a while (compiling ~1000 Rust crates) — subsequent rebuilds are fast.

Tested on: Ubuntu 22.04 (NVIDIA Jetson Orin Nano aarch64), Ubuntu 24.04, Fedora, Arch.

#### From a Release (AppImage, .deb, or .rpm)

Download the latest package for your architecture from [Releases](https://github.com/lalomorales22/Super-Asciivision/releases).

**AppImage** (portable, no install needed):
```bash
chmod +x Super.ASCIIVision_0.1.4_aarch64.AppImage
./Super.ASCIIVision_0.1.4_aarch64.AppImage
```
> **Note:** Browsers strip the execute permission when downloading files. You must run `chmod +x` before the AppImage will launch.

**Debian/Ubuntu (.deb)**:
```bash
sudo dpkg -i Super.ASCIIVision_0.1.4_arm64.deb
```

**Fedora/RHEL (.rpm)**:
```bash
sudo rpm -i Super.ASCIIVision-0.1.4-1.aarch64.rpm
```

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

Pair your phone for remote access to chat, image/video/audio generation, and local workspace operations. You need a relay server so your phone can reach the desktop app over the internet.

### Deploy the Relay on Render

1. **Pick a unique service name.** Open `render.yaml` in the repo root and change the `name` field to something unique to you (e.g. `alex-ascii-relay`). Render turns this into your public URL (`https://<your-name>.onrender.com`) and names are globally unique — two people cannot share the same name.
2. **Create a Render account** at [render.com](https://render.com) (free tier works).
3. **Connect your GitHub** — link the repo (with your updated `render.yaml`) to Render.
4. **Create a Blueprint:**
   - From the Render dashboard, click **New** > **Blueprint**.
   - Select this repository. Render will detect `render.yaml` at the root.
   - Confirm the service name matches what you set in step 1.
   - Click **Apply** — this creates the `hands-relay` web service on the free plan.
5. **Wait for the deploy** to finish. Copy your Render HTTPS URL, e.g.:
   ```
   https://alex-ascii-relay.onrender.com
   ```
6. **Keep this URL private.** Anyone with it could connect to your relay. Do not share it publicly or commit it to a repo.

### Connect the App

1. In Super ASCIIVision, go to the **Hands** page.
2. Set **Provider** to `Hands Relay`.
3. Paste your Render HTTPS URL into the **Relay URL** field.
4. Click **Start secure link** — the desktop opens a WebSocket to the relay and generates a pairing code.
5. On your phone, open the relay URL in a browser (e.g., `https://alex-ascii-relay.onrender.com`).
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
