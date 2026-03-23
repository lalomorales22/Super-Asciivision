#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# Super ASCIIVision — Linux install script
# Installs prerequisites, builds both apps,
# and creates a desktop-launchable binary.
#
# Supported: Ubuntu/Debian, Fedora/RHEL,
#            Arch Linux, openSUSE
#
# Tested on: Ubuntu 22.04 (Jetson Orin Nano),
#            Ubuntu 24.04, Fedora 40, Arch
# ──────────────────────────────────────────────

APP_NAME="Super ASCIIVision"
BUNDLE_DIR="src-tauri/target/release/bundle"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

info()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
fail()  { printf '\033[1;31m✖ %s\033[0m\n' "$*"; exit 1; }

# ── Platform check ──────────────────────────
[[ "$(uname)" == "Linux" ]] || fail "This script is for Linux. On macOS, use ./install.sh instead."

# ── Distro detection ────────────────────────
detect_distro() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    case "${ID:-}" in
      ubuntu|debian|pop|linuxmint|elementary|zorin|kali) DISTRO="debian" ;;
      fedora|rhel|centos|rocky|alma|nobara)              DISTRO="fedora" ;;
      arch|manjaro|endeavouros|garuda)                    DISTRO="arch"   ;;
      opensuse*|sles)                                     DISTRO="suse"   ;;
      *)                                                  DISTRO="unknown" ;;
    esac
  else
    DISTRO="unknown"
  fi
}

detect_distro

if [[ "$DISTRO" == "unknown" ]]; then
  fail "Could not detect your Linux distribution. Please install dependencies manually (see README)."
fi

info "Detected distro family: $DISTRO"

# ── Fix pango version conflicts (NVIDIA Jetson / L4T) ──
# NVIDIA's Jetson Linux ships patched pango (e.g., 1.50.6+ds-2ubuntu1)
# that conflicts with the upstream -dev package. Downgrade if needed.
if [[ "$DISTRO" == "debian" ]]; then
  PANGO_INSTALLED=$(dpkg-query -W -f='${Version}' libpango-1.0-0 2>/dev/null || echo "")
  PANGO_CANDIDATE=$(apt-cache policy libpango1.0-dev 2>/dev/null | grep "Candidate:" | awk '{print $2}')
  if [[ -n "$PANGO_INSTALLED" ]] && [[ -n "$PANGO_CANDIDATE" ]] && [[ "$PANGO_INSTALLED" != "$PANGO_CANDIDATE" ]]; then
    warn "Pango version mismatch detected (installed: $PANGO_INSTALLED, dev needs: $PANGO_CANDIDATE)"
    info "Aligning pango packages to $PANGO_CANDIDATE (safe — same upstream code)..."
    sudo apt-get install -y --allow-downgrades \
      "libpango-1.0-0=$PANGO_CANDIDATE" \
      "libpangocairo-1.0-0=$PANGO_CANDIDATE" \
      "libpangoft2-1.0-0=$PANGO_CANDIDATE" \
      "libpangoxft-1.0-0=$PANGO_CANDIDATE" \
      "gir1.2-pango-1.0=$PANGO_CANDIDATE" 2>/dev/null || true
  fi
fi

# ── System dependencies ────────────────────
install_deps() {
  case "$DISTRO" in
    debian)
      info "Installing system dependencies via apt..."
      sudo apt-get update -qq
      sudo apt-get install -y \
        build-essential pkg-config libclang-dev curl git \
        libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
        libavformat-dev libavcodec-dev libswscale-dev libavutil-dev libavdevice-dev \
        libsecret-1-dev libssl-dev \
        ffmpeg yt-dlp
      ok "apt dependencies installed"
      ;;
    fedora)
      info "Installing system dependencies via dnf..."
      if ! rpm -q rpmfusion-free-release >/dev/null 2>&1; then
        warn "Enabling RPM Fusion (needed for FFmpeg dev packages)..."
        sudo dnf install -y \
          "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm" \
          2>/dev/null || true
      fi
      sudo dnf install -y \
        gcc pkg-config clang-devel curl git openssl-devel \
        webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel \
        ffmpeg-devel libsecret-devel \
        ffmpeg yt-dlp
      ok "dnf dependencies installed"
      ;;
    arch)
      info "Installing system dependencies via pacman..."
      sudo pacman -Syu --noconfirm --needed \
        base-devel pkg-config clang curl git openssl \
        webkit2gtk-4.1 gtk3 libappindicator-gtk3 librsvg \
        ffmpeg libsecret \
        yt-dlp
      ok "pacman dependencies installed"
      ;;
    suse)
      info "Installing system dependencies via zypper..."
      sudo zypper install -y \
        gcc pkg-config libclang-devel curl git libopenssl-devel \
        webkit2gtk3-devel gtk3-devel libappindicator3-devel librsvg-devel \
        ffmpeg-devel libsecret-devel \
        ffmpeg yt-dlp
      ok "zypper dependencies installed"
      ;;
  esac
}

install_deps

# ── Node.js ─────────────────────────────────
if ! command -v node &>/dev/null; then
  info "Installing Node.js via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null || true
  case "$DISTRO" in
    debian) sudo apt-get install -y nodejs ;;
    fedora) sudo dnf install -y nodejs ;;
    arch)   sudo pacman -S --noconfirm --needed nodejs npm ;;
    suse)   sudo zypper install -y nodejs20 ;;
  esac
  ok "Node.js installed ($(node -v))"
else
  NODE_MAJOR="$(node -v | sed 's/v//' | cut -d. -f1)"
  if (( NODE_MAJOR < 20 )); then
    warn "Node.js $(node -v) found but 20+ is required — please upgrade."
    exit 1
  fi
  ok "Node.js $(node -v) found"
fi

# ── Rust ────────────────────────────────────
# Always source cargo env in case Rust was installed in a previous
# run of this script but the current shell doesn't have it in PATH.
if [[ -f "$HOME/.cargo/env" ]]; then
  source "$HOME/.cargo/env"
fi

if ! command -v rustc &>/dev/null; then
  info "Installing Rust via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
  ok "Rust installed ($(rustc --version))"
else
  ok "Rust found ($(rustc --version))"
fi

# ── Ollama (optional, for local AI) ────────
if ! command -v ollama &>/dev/null; then
  info "Installing Ollama (for local AI models)..."
  curl -fsSL https://ollama.com/install.sh | sh
  ok "Ollama installed"
else
  ok "Ollama found"
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

# ── Install ────────────────────────────────
mkdir -p "$INSTALL_DIR"

# Try to find the built binary
BUILT_BIN=""
if [[ -f "src-tauri/target/release/super-asciivision" ]]; then
  BUILT_BIN="src-tauri/target/release/super-asciivision"
elif [[ -f "src-tauri/target/release/Super ASCIIVision" ]]; then
  BUILT_BIN="src-tauri/target/release/Super ASCIIVision"
fi

if [[ -n "$BUILT_BIN" ]]; then
  cp "$BUILT_BIN" "$INSTALL_DIR/super-asciivision"
  chmod +x "$INSTALL_DIR/super-asciivision"
  ok "Binary installed to $INSTALL_DIR/super-asciivision"
fi

# Install .deb if available
DEB_FILE=$(find "$BUNDLE_DIR/deb" -name "*.deb" 2>/dev/null | head -1)
if [[ -n "$DEB_FILE" ]] && [[ "$DISTRO" == "debian" ]]; then
  info "Installing .deb package..."
  sudo dpkg -i "$DEB_FILE"
  ok ".deb package installed"
fi

# Install AppImage if available
APPIMAGE_FILE=$(find "$BUNDLE_DIR/appimage" -name "*.AppImage" 2>/dev/null | head -1)
if [[ -n "$APPIMAGE_FILE" ]]; then
  cp "$APPIMAGE_FILE" "$INSTALL_DIR/SuperASCIIVision.AppImage"
  chmod +x "$INSTALL_DIR/SuperASCIIVision.AppImage"
  ok "AppImage installed to $INSTALL_DIR/SuperASCIIVision.AppImage"
fi

# Ensure INSTALL_DIR is in PATH
if [[ ":${PATH}:" != *":${INSTALL_DIR}:"* ]]; then
  SHELL_RC=""
  if [[ "${SHELL:-}" == *zsh ]]; then
    SHELL_RC="$HOME/.zshrc"
  else
    SHELL_RC="$HOME/.bashrc"
  fi

  if [[ -n "$SHELL_RC" ]]; then
    echo '' >> "$SHELL_RC"
    echo '# Super ASCIIVision' >> "$SHELL_RC"
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
    ok "Added $INSTALL_DIR to PATH in $SHELL_RC"
    warn "Run 'source $SHELL_RC' or open a new terminal for it to take effect."
  fi
fi

echo ""
ok "Done! Super ASCIIVision is installed."
echo ""
echo "   Launch the app:"
echo "     super-asciivision          (if ~/.local/bin is in PATH)"
echo "     $INSTALL_DIR/super-asciivision"
echo ""
echo "   To use Ollama for local AI chat:"
echo "     1. Start Ollama:  ollama serve"
echo "     2. Pull a model:  ollama pull qwen3.5:2b"
echo "     3. Launch the app and click the Ollama button in Chat"
echo ""
echo "   For xAI cloud models, open Settings and paste your xAI API key."
echo ""
echo "   Music: Drop audio files into ~/Music/SuperASCIIVision/ or use the"
echo "          Music page to import files and create playlists."
echo ""
echo "   Hands (mobile bridge): Deploy your own relay to Render — see"
echo "          hands-relay/README.md for setup instructions."
echo ""
echo "   ASCIIVision AI providers: Open Settings and add your API keys"
echo "          (Claude, OpenAI, Gemini). Your xAI key is shared automatically."
