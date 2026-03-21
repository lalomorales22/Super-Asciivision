#!/usr/bin/env bash
set -euo pipefail

# Build the asciivision binary and copy it to src-tauri/binaries/
# Tauri expects binaries named with the target triple suffix.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_TRIPLE="$(rustc -vV | grep host | cut -d' ' -f2)"

# ── Ensure LLVM/libclang paths are set for ffmpeg-sys-next bindgen ──
if [[ -z "${LIBCLANG_PATH:-}" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    # macOS: Homebrew LLVM
    if [[ -d "/opt/homebrew/opt/llvm/lib" ]]; then
      export LIBCLANG_PATH="/opt/homebrew/opt/llvm/lib"
    elif [[ -d "/usr/local/opt/llvm/lib" ]]; then
      export LIBCLANG_PATH="/usr/local/opt/llvm/lib"
    fi
  else
    # Linux: system libclang
    for dir in /usr/lib/llvm-*/lib /usr/lib64/llvm /usr/lib/x86_64-linux-gnu /usr/lib/aarch64-linux-gnu; do
      if [[ -f "${dir}/libclang.so" ]] || [[ -f "${dir}/libclang.so.1" ]]; then
        export LIBCLANG_PATH="${dir}"
        break
      fi
    done
  fi
fi

# Ensure pkg-config can find FFmpeg and other libs
if [[ "$(uname)" == "Darwin" ]]; then
  if [[ -d "/opt/homebrew/lib/pkgconfig" ]]; then
    export PKG_CONFIG_PATH="${PKG_CONFIG_PATH:-}:/opt/homebrew/lib/pkgconfig"
  elif [[ -d "/usr/local/lib/pkgconfig" ]]; then
    export PKG_CONFIG_PATH="${PKG_CONFIG_PATH:-}:/usr/local/lib/pkgconfig"
  fi
fi

echo "Building ASCIIVision for $TARGET_TRIPLE..."
cd "$SCRIPT_DIR/asciivision-core"
cargo build --release

echo "Copying binary to src-tauri/binaries/..."
mkdir -p "$SCRIPT_DIR/src-tauri/binaries"
cp "target/release/asciivision" "$SCRIPT_DIR/src-tauri/binaries/asciivision-${TARGET_TRIPLE}"

echo "ASCIIVision binary ready: src-tauri/binaries/asciivision-${TARGET_TRIPLE}"
