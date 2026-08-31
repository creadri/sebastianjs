#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update

# Chromium for mermaid-cli/Puppeteer; apt pulls its own runtime libs.
sudo apt-get install -y chromium fonts-liberation fonts-noto-core

# Build deps for node-canvas. Src: https://www.npmjs.com/package/canvas
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

sudo rm -rf /var/lib/apt/lists/*

# Picked up automatically by scripts/mmdc-wrapper.mjs (searches cwd, then $HOME).
cat <<'JSON' > "$HOME/.puppeteerrc.json"
{
  "args": ["--no-sandbox", "--disable-setuid-sandbox"]
}
JSON

echo 'Devcontainer setup complete.'
