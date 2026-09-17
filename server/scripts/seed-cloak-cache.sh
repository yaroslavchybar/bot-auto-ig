#!/bin/sh
# Seed the persisted Cloak cache with the Pro binary baked at image build
# time, so the first boot copies locally instead of downloading ~300MB.
# Safe to run every boot: exits immediately when the live cache already has
# a Pro binary, or when nothing was baked in. The runtime falls back to
# downloading if versions ever mismatch.
set -e
BAKED=/root/.cloakbrowser
LIVE=/app/data/.cloakbrowser
if find "$LIVE" -maxdepth 1 -name 'chromium-*-pro' 2>/dev/null | grep -q .; then
  exit 0
fi
SRC=$(find "$BAKED" -maxdepth 1 -name 'chromium-*-pro' 2>/dev/null | head -n 1 || true)
if [ -z "$SRC" ]; then
  exit 0
fi
mkdir -p "$LIVE"
cp -a "$SRC" "$LIVE/"
echo "Seeded Cloak Pro binary from image: $(basename "$SRC")"
