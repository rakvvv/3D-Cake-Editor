#!/bin/sh
set -eu

SOURCE_DIR="/app/seed-thumbnails/presets"
STORAGE_BASE_PATH="${APP_STORAGE_BASE_PATH:-/app/data/scenes}"
TARGET_DIR="${STORAGE_BASE_PATH}/thumbnails/presets"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Seed thumbnails not found at $SOURCE_DIR" >&2
  exit 0
fi

mkdir -p "$TARGET_DIR"

found_files=0
for file in "$SOURCE_DIR"/*.png; do
  [ -f "$file" ] || continue
  found_files=1
  basename=$(basename "$file")
  target="$TARGET_DIR/$basename"
  src_size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0)
  tgt_size=$(stat -c%s "$target" 2>/dev/null || stat -f%z "$target" 2>/dev/null || echo -1)
  if [ "$src_size" != "$tgt_size" ]; then
    cp "$file" "$target"
    echo "Copied seed thumbnail: $basename"
  fi
done

if [ "$found_files" -eq 0 ]; then
  echo "No seed thumbnails found in $SOURCE_DIR" >&2
fi
