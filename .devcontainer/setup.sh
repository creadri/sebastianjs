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

# Picked up automatically by scripts/mmdc-wrapper.mjs (searches cwd, then $HOME).
cat <<'JSON' > "$HOME/.puppeteerrc.json"
{
  "args": ["--no-sandbox", "--disable-setuid-sandbox"]
}
JSON

echo 'Devcontainer setup complete.'
