#!/bin/bash
# Download a curated set of Remotion animated-emoji assets into the tool's
# public/emoji folder. webm (Chromium render) + mp4 (Safari/Player preview),
# scales 1x and 2x. The names here match the @remotion/animated-emoji emoji ids.
set -e
DEST="$(cd "$(dirname "$0")/.." && pwd)/public/emoji"
BASE="https://raw.githubusercontent.com/remotion-dev/animated-emoji/main/public"
mkdir -p "$DEST"

# Curated emoji that read well on hook / CTA / proof slides.
EMOJIS=(fire star-struck rocket party-popper light-bulb thumbs-up \
        100 sparkles eyes mind-blown clap folded-hands \
        money-face glowing-star check-mark sunglasses-face)

ok=0; fail=0
for e in "${EMOJIS[@]}"; do
  for scale in 1 2; do
    for ext in webm mp4; do
      f="${e}-${scale}x.${ext}"
      if curl -sfL -o "$DEST/$f" "$BASE/$f"; then
        ok=$((ok+1))
      else
        echo "MISS: $f"
        fail=$((fail+1))
        rm -f "$DEST/$f"
      fi
    done
  done
done
echo "Downloaded $ok files, $fail misses into $DEST"
ls "$DEST" | head -12
