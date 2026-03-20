#!/usr/bin/env bash
set -euo pipefail

# Build the asciivision binary and copy it to src-tauri/binaries/
# Tauri expects binaries named with the target triple suffix.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_TRIPLE="$(rustc -vV | grep host | cut -d' ' -f2)"

echo "Building ASCIIVision for $TARGET_TRIPLE..."
cd "$SCRIPT_DIR/asciivision-core"
cargo build --release

echo "Copying binary to src-tauri/binaries/..."
mkdir -p "$SCRIPT_DIR/src-tauri/binaries"
cp "target/release/asciivision" "$SCRIPT_DIR/src-tauri/binaries/asciivision-${TARGET_TRIPLE}"

echo "ASCIIVision binary ready: src-tauri/binaries/asciivision-${TARGET_TRIPLE}"
