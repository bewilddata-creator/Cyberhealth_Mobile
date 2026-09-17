#!/bin/bash
# Renders scripts/icon.html to PNG app icons with headless Chrome (macOS).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p icons
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=512,512 --screenshot="icons/icon-512.png" "file://$PWD/scripts/icon.html"
sips -z 192 192 icons/icon-512.png --out icons/icon-192.png >/dev/null
sips -z 180 180 icons/icon-512.png --out icons/icon-180.png >/dev/null
echo "Icons written to icons/"
