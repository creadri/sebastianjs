#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update

# Chromium for mermaid-cli/Puppeteer; apt pulls its own runtime libs.
sudo apt-get install -y chromium fonts-liberation fonts-noto-core

# node-canvas is gone: text is measured with fontkit, so there is no native build
# step and the cairo/pango toolchain is no longer installed. The only package in
# the tree that compiles is `canvas` itself, pulled in as an OPTIONAL transitive
# dependency of jsdom — npm skips it when it cannot build, which is what we want.

sudo rm -rf /var/lib/apt/lists/*

# Make the bundled fonts resolvable by Chrome through fontconfig. The parity
# tests pin both renderers to Open Sans: we load the TTF directly, but Chrome
# goes through fontconfig, and without this it silently substitutes another face
# and the comparison comes out ~6px off. __tests__/comparison.test.js skips
# itself when this is missing rather than reporting a bogus mismatch.
mkdir -p "$HOME/.local/share/fonts/sebastianjs"
cp "$(dirname "$0")/../fonts/Open_Sans/static/OpenSans-Regular.ttf" \
   "$(dirname "$0")/../fonts/Open_Sans/static/OpenSans-Bold.ttf" \
   "$(dirname "$0")/../fonts/Open_Sans/static/OpenSans-Italic.ttf" \
   "$(dirname "$0")/../fonts/Open_Sans/static/OpenSans-BoldItalic.ttf" \
   "$HOME/.local/share/fonts/sebastianjs/"
fc-cache -f >/dev/null

# Picked up automatically by scripts/mmdc-wrapper.mjs (searches cwd, then $HOME).
cat <<'JSON' > "$HOME/.puppeteerrc.json"
{
  "args": ["--no-sandbox", "--disable-setuid-sandbox"]
}
JSON

echo 'Devcontainer setup complete.'
