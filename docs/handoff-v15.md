# Handoff v15 — Linux AppImage Build

## Session Summary (2026-03-23, session v15)

Previous session (v14) fixed the persistent `???` border corruption bug. Root cause was `String::from_utf8_lossy` in the PTY reader (`src-tauri/src/terminal.rs`) splitting multi-byte UTF-8 characters across 4096-byte read boundaries. Fixed with a UTF-8-safe reader that buffers incomplete sequences. Also added a "border shield" (borders render LAST) and clipped gradient text overflow.

Everything is committed, pushed, and a v0.1.3 release exists on GitHub with the macOS DMG. The repo is fully clean.

---

## THIS SESSION: Build Linux AppImage and upload to v0.1.3 release

### Task

1. Clone the repo on this Linux machine
2. Run the full build: `./install-linux.sh` (or manually install deps + `npm run tauri build`)
3. Find the built AppImage in `src-tauri/target/release/bundle/appimage/`
4. Upload it to the existing v0.1.3 GitHub release:
   ```bash
   gh release upload v0.1.3 path/to/Super.ASCIIVision_*.AppImage
   ```
5. Verify it appears on https://github.com/lalomorales22/Super-Asciivision/releases/tag/v0.1.3

### Prerequisites

The `install-linux.sh` script handles everything automatically, but the key deps are:
- Node.js 20+
- Rust (via rustup)
- FFmpeg + dev libs
- LLVM/libclang
- WebKit2GTK 4.1 + GTK3
- pkg-config
- yt-dlp (optional, for YouTube in ASCIIVision)

### Build Commands (if doing it manually)

```bash
git clone https://github.com/lalomorales22/Super-Asciivision.git
cd Super-Asciivision

# Install deps (Ubuntu/Debian example)
sudo apt install -y build-essential pkg-config libclang-dev curl git \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  libavformat-dev libavcodec-dev libswscale-dev libavutil-dev libavdevice-dev \
  libsecret-1-dev libssl-dev ffmpeg yt-dlp

# Install Node.js if not present
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Rust if not present
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Build
npm install
./build-asciivision.sh
npm run tauri build

# Upload to release
gh auth login  # if needed
gh release upload v0.1.3 src-tauri/target/release/bundle/appimage/Super*.AppImage
```

### Or just run the install script

```bash
git clone https://github.com/lalomorales22/Super-Asciivision.git
cd Super-Asciivision
./install-linux.sh
```

Then upload the AppImage:
```bash
gh release upload v0.1.3 src-tauri/target/release/bundle/appimage/Super*.AppImage
```

### Notes

- First build on Linux will be slow (~10-20 min) — compiling ~1000+ Rust crates from scratch
- The AppImage filename will include the architecture (e.g., `_aarch64.AppImage` for ARM, `_amd64.AppImage` for x86_64)
- The `.deb` package is also built — could optionally upload that too
- `gh` CLI needs to be installed and authenticated to upload to the release
