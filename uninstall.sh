#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# Super ASCIIVision — Uninstall script
# Works on macOS and Linux
# ──────────────────────────────────────────────

APP_NAME="Super ASCIIVision"

info()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }

REMOVED=0

remove_if_exists() {
  local path="$1"
  local label="$2"
  if [[ -e "$path" ]]; then
    rm -rf "$path"
    ok "Removed $label ($path)"
    REMOVED=$((REMOVED + 1))
  fi
}

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   Super ASCIIVision — Uninstaller    ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── Confirm ────────────────────────────────
read -rp "This will remove $APP_NAME and its data. Continue? [y/N] " confirm
if [[ "$(printf '%s' "$confirm" | tr '[:upper:]' '[:lower:]')" != "y" ]]; then
  echo "Cancelled."
  exit 0
fi

echo ""

OS="$(uname)"

if [[ "$OS" == "Darwin" ]]; then
  # ── macOS ──────────────────────────────────
  info "Uninstalling on macOS..."

  # App bundle
  remove_if_exists "/Applications/$APP_NAME.app" "Application"

  # App data (database, secrets, workspaces)
  remove_if_exists "$HOME/Library/Application Support/SuperASCIIVision" "App data"

  # Tauri WebView cache
  remove_if_exists "$HOME/Library/WebKit/com.megabrain2.superasciivision" "WebView cache"

  # Music folder (ask first)
  MUSIC_DIR="$HOME/Music/SuperASCIIVision"
  if [[ -d "$MUSIC_DIR" ]]; then
    read -rp "Remove music folder at $MUSIC_DIR? [y/N] " rm_music
    if [[ "$(printf '%s' "$rm_music" | tr '[:upper:]' '[:lower:]')" == "y" ]]; then
      remove_if_exists "$MUSIC_DIR" "Music folder"
    else
      warn "Kept music folder at $MUSIC_DIR"
    fi
  fi

elif [[ "$OS" == "Linux" ]]; then
  # ── Linux ──────────────────────────────────
  info "Uninstalling on Linux..."

  INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

  # Binaries
  remove_if_exists "$INSTALL_DIR/super-asciivision" "Binary"
  remove_if_exists "$INSTALL_DIR/SuperASCIIVision.AppImage" "AppImage"

  # .deb package
  if dpkg -l | grep -q super-asciivision 2>/dev/null; then
    info "Removing .deb package..."
    sudo dpkg -r super-asciivision 2>/dev/null && ok "Removed .deb package" || true
    REMOVED=$((REMOVED + 1))
  fi

  # Desktop entry and icon
  remove_if_exists "$HOME/.local/share/applications/super-asciivision.desktop" "Desktop entry"
  remove_if_exists "$HOME/.local/share/icons/hicolor/128x128/apps/super-asciivision.png" "Icon"
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

  # App data (database, secrets, workspaces)
  remove_if_exists "$HOME/.local/share/SuperASCIIVision" "App data"

  # Music folder (ask first)
  MUSIC_DIR="$HOME/Music/SuperASCIIVision"
  if [[ -d "$MUSIC_DIR" ]]; then
    read -rp "Remove music folder at $MUSIC_DIR? [y/N] " rm_music
    if [[ "$(printf '%s' "$rm_music" | tr '[:upper:]' '[:lower:]')" == "y" ]]; then
      remove_if_exists "$MUSIC_DIR" "Music folder"
    else
      warn "Kept music folder at $MUSIC_DIR"
    fi
  fi

else
  warn "Unknown OS: $OS — please uninstall manually."
  exit 1
fi

echo ""
if (( REMOVED > 0 )); then
  ok "$APP_NAME has been uninstalled. ($REMOVED items removed)"
else
  warn "Nothing found to remove — $APP_NAME may not be installed."
fi
echo ""
