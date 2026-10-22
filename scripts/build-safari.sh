#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo 'Full Xcode is required for Safari 18. Install Xcode, launch it once, then run:'
  echo 'sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer'
  exit 1
fi
xcrun safari-web-extension-converter "$ROOT/extension" --project-location "$ROOT/Safari" --app-name safari_arxiv_reader --bundle-identifier dev.papertrail.reader --swift --macos-only --no-prompt --no-open
echo "Created $ROOT/Safari. This is a scaffold: wire native/Extension.m into the extension target as documented in docs/DEVELOPMENT.md before signing; Pangram requires its native bridge."
