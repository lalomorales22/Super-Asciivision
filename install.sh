#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# Super ASCIIVision — macOS install script
# Installs prerequisites, builds both apps,
# bundles them together, and copies the .app
# bundle into /Applications.
# ──────────────────────────────────────────────

APP_NAME="Super ASCIIVision"
BUNDLE_DIR="src-tauri/target/release/bundle/macos"
INSTALL_DIR="/Applications"

info()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
fail()  { printf '\033[1;31m✖ %s\033[0m\n' "$*"; exit 1; }

# ── Platform check ──────────────────────────
[[ "$(uname)" == "Darwin" ]] || fail "This app currently supports macOS only."

# ── Xcode Command Line Tools ────────────────
if ! xcode-select -p &>/dev/null; then
  info "Installing Xcode Command Line Tools..."
  xcode-select --install
  echo "    Re-run this script after the Xcode tools finish installing."
  exit 0
else
  ok "Xcode Command Line Tools found"
fi

# ── Homebrew ────────────────────────────────
if ! command -v brew &>/dev/null; then
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"
  ok "Homebrew installed"
else
  ok "Homebrew found"
fi

# ── Node.js ─────────────────────────────────
if ! command -v node &>/dev/null; then
  info "Installing Node.js via Homebrew..."
  brew install node
  ok "Node.js installed ($(node -v))"
else
  NODE_MAJOR="$(node -v | sed 's/v//' | cut -d. -f1)"
  if (( NODE_MAJOR < 20 )); then
    warn "Node.js $(node -v) found but 20+ is required — upgrading..."
    brew upgrade node
  fi
  ok "Node.js $(node -v) found"
fi

# ── Rust ────────────────────────────────────
if ! command -v rustc &>/dev/null; then
  info "Installing Rust via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
  ok "Rust installed ($(rustc --version))"
else
  ok "Rust found ($(rustc --version))"
fi

# ── FFmpeg (required for ASCIIVision video + media export) ──
if ! command -v ffmpeg &>/dev/null; then
  info "Installing ffmpeg (needed for video playback and media export)..."
  brew install ffmpeg
  ok "ffmpeg installed"
else
  ok "ffmpeg found"
fi

# ── LLVM/libclang (required for ASCIIVision's ffmpeg-sys-next) ──
if ! brew list llvm &>/dev/null 2>&1; then
  info "Installing LLVM (needed to compile ASCIIVision)..."
  brew install llvm
  ok "LLVM installed"
else
  ok "LLVM found"
fi

# ── pkg-config ──────────────────────────────
if ! command -v pkg-config &>/dev/null; then
  info "Installing pkg-config..."
  brew install pkg-config
  ok "pkg-config installed"
else
  ok "pkg-config found"
fi

# ── Optional: yt-dlp (for ASCIIVision YouTube streaming) ──
if ! command -v yt-dlp &>/dev/null; then
  info "Installing yt-dlp (for YouTube streaming in ASCIIVision)..."
  brew install yt-dlp
  ok "yt-dlp installed"
else
  ok "yt-dlp found"
fi

# ── npm install ─────────────────────────────
info "Installing npm dependencies..."
npm install
ok "npm dependencies installed"

# ── Build ASCIIVision binary ────────────────
info "Building ASCIIVision binary..."
bash build-asciivision.sh
ok "ASCIIVision binary built"

# ── Build Super ASCIIVision ────────
info "Building Super ASCIIVision (this may take a few minutes on first run)..."
npm run tauri build
ok "Build complete"

# ── Install to /Applications ────────────────
if [[ -d "$INSTALL_DIR/$APP_NAME.app" ]]; then
  warn "Removing existing $APP_NAME from $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR/$APP_NAME.app"
fi

info "Copying $APP_NAME.app to $INSTALL_DIR..."
ditto "$BUNDLE_DIR/$APP_NAME.app" "$INSTALL_DIR/$APP_NAME.app"
ok "$APP_NAME installed to $INSTALL_DIR"

echo ""
ok "Done! Launch \"$APP_NAME\" from Applications or Spotlight."
echo "   Open Settings inside the app and paste your xAI API key."
echo "   Click the ASCIIVISION button in the nav bar to launch ASCIIVision."
echo ""
echo "   For ASCIIVision AI providers, create asciivision-core/.env with your API keys:"
echo "   CLAUDE_API_KEY=sk-ant-..."
echo "   GROK_API_KEY=xai-..."
echo "   OPENAI_API_KEY=sk-..."
echo "   GEMINI_API_KEY=AIza..."
