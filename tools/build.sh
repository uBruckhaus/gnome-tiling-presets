#!/bin/sh
# Builds dist/tiling-presets@ubruckhaus.github.io.shell-extension.zip (schemas included).
set -eu
cd "$(dirname "$0")/.."
UUID=tiling-presets@ubruckhaus.github.io
mkdir -p dist
gnome-extensions pack "$UUID" --force --out-dir dist \
    --extra-source=layouts.js --extra-source=config.js --extra-source=tiler.js \
    --extra-source=appPresets.js --extra-source=indicator.js --extra-source=workspaceNumbers.js --extra-source=workspacePins.js \
    --extra-source=focusBorder.js --extra-source=doubleClick.js --extra-source=gnomeOverrides.js \
    --extra-source=keys.js --extra-source=shortcuts.js \
    --extra-source=icons --extra-source=../LICENSE
echo "dist/$UUID.shell-extension.zip"
