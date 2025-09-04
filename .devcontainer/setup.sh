#!/usr/bin/env bash
set -euo pipefail

# Install system deps for canvas & Chromium
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  libnss3 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libpangocairo-1.0-0 libgtk-3-0 libxshmfence1 \
  fonts-liberation libappindicator3-1 libx11-xcb1 xvfb \
  ca-certificates wget gnupg

# Optional: install Chromium (Debian package)
sudo apt-get install -y chromium

# Install mermaid-cli globally (will pull puppeteer; rely on Chromium system binary)
# Puppeteer by default downloads its own Chromium; we can skip download via env if desired
export PUPPETEER_SKIP_DOWNLOAD=true
npm install -g @mermaid-js/mermaid-cli@latest puppeteer

# Link chromium for puppeteer if needed
if ! command -v chromium >/dev/null 2>&1 && command -v chromium-browser >/dev/null 2>&1; then
  sudo ln -s "$(command -v chromium-browser)" /usr/local/bin/chromium
fi

echo 'Devcontainer setup complete.'
