#!/usr/bin/env bash
# Generate macOS .iconset from a source PNG (512x512 or larger).
# Usage: ./scripts/generate-icons.sh [source.png]
#
# Requires either:
#   - macOS `sips` (ships with macOS)
#   - ImageMagick `magick` or `convert` (cross-platform)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="${1:-$REPO_ROOT/apps/desktop/app-icon.png}"
DST="$REPO_ROOT/apps/desktop/icon.iconset"

if [ ! -f "$SRC" ]; then
  echo "Error: Source image not found: $SRC" >&2
  exit 1
fi

mkdir -p "$DST"

# Sizes required by Apple HIG (width, filename)
SIZES=(
  "16   icon_16x16.png"
  "32   icon_16x16@2x.png"
  "32   icon_32x32.png"
  "64   icon_32x32@2x.png"
  "128  icon_128x128.png"
  "256  icon_128x128@2x.png"
  "256  icon_256x256.png"
  "512  icon_256x256@2x.png"
  "512  icon_512x512.png"
)

resize_image() {
  local size="$1" output="$2"

  if command -v sips &>/dev/null; then
    # macOS built-in
    cp "$SRC" "$output"
    sips -z "$size" "$size" "$output" --out "$output" &>/dev/null
  elif command -v magick &>/dev/null; then
    # ImageMagick 7+
    magick "$SRC" -resize "${size}x${size}" "$output"
  elif command -v convert &>/dev/null; then
    # ImageMagick 6
    convert "$SRC" -resize "${size}x${size}" "$output"
  else
    echo "Error: No image tool found. Install ImageMagick or run on macOS." >&2
    exit 1
  fi
}

for entry in "${SIZES[@]}"; do
  size=$(echo "$entry" | awk '{print $1}')
  name=$(echo "$entry" | awk '{print $2}')
  echo "  ${size}x${size} -> $name"
  resize_image "$size" "$DST/$name"
done

echo "Icon set generated at $DST"
