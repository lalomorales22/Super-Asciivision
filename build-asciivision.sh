#!/usr/bin/env bash
set -euo pipefail

# Build the asciivision binary and copy it to src-tauri/binaries/
# Tauri expects binaries named with the target triple suffix.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_TRIPLE="$(rustc -vV | grep host | cut -d' ' -f2)"

# ── Ensure LLVM/libclang paths are set for ffmpeg-sys-next bindgen ──
# Homebrew LLVM is required for compiling ffmpeg-sys-next on macOS.
if [[ -z "${LIBCLANG_PATH:-}" ]]; then
  if [[ -d "/opt/homebrew/opt/llvm/lib" ]]; then
    export LIBCLANG_PATH="/opt/homebrew/opt/llvm/lib"
  elif [[ -d "/usr/local/opt/llvm/lib" ]]; then
    export LIBCLANG_PATH="/usr/local/opt/llvm/lib"
  fi
fi

# Ensure pkg-config can find FFmpeg and other Homebrew libs
if [[ -d "/opt/homebrew/lib/pkgconfig" ]]; then
  export PKG_CONFIG_PATH="${PKG_CONFIG_PATH:-}:/opt/homebrew/lib/pkgconfig"
elif [[ -d "/usr/local/lib/pkgconfig" ]]; then
  export PKG_CONFIG_PATH="${PKG_CONFIG_PATH:-}:/usr/local/lib/pkgconfig"
fi

echo "Building ASCIIVision for $TARGET_TRIPLE..."
cd "$SCRIPT_DIR/asciivision-core"
cargo build --release

echo "Copying binary to src-tauri/binaries/..."
mkdir -p "$SCRIPT_DIR/src-tauri/binaries"
cp "target/release/asciivision" "$SCRIPT_DIR/src-tauri/binaries/asciivision-${TARGET_TRIPLE}"

echo "ASCIIVision binary ready: src-tauri/binaries/asciivision-${TARGET_TRIPLE}"
