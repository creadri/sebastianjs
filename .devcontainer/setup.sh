#!/usr/bin/env bash
set -euo pipefail
# Update baseline
sudo apt-get update
# Install dependencies for Puppeteer. Src: https://pptr.dev/troubleshooting
sudo apt-get install -y ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6\
  libx11-6\
  libx11-xcb1\
  libxcb1\
  libxcomposite1\
  libxcursor1\
  libxdamage1\
  libxext6\
  libxfixes3\
  libxi6\
  libxrandr2\
  libxrender1\
  libxss1\
  libxtst6\
  lsb-release\
  wget\
  xdg-utils
# Install chromium for Puppeteer
sudo apt-get install -y chromium
# Install dependencies for Canvas Src: https://www.npmjs.com/package/canvas
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
# Skip Puppeteer Chromium download
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# Add configuration for puppeteer in node user
cat <<EOF > /home/node/.puppeteerrc.json
{
  "args": ["--no-sandbox", "--disable-setuid-sandbox"]
}
EOF

# Add Env variables to bashrc and automatically append mmdc command
cat <<EOF >> /home/node/.bashrc
alias mmdc='mmdc --puppeteerConfigFile ~/.puppeteerrc.json'
export PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"
EOF

npm install -g @mermaid-js/mermaid-cli@latest

echo 'Devcontainer setup complete.'
