#!/bin/sh
set -eu
companion_root="$SRCROOT/../../../libby-extension"
companion_output="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
mkdir -p "$companion_output"
cp "$companion_root"/src/* "$companion_output/"
cp "$companion_root/manifest.safari.json" "$companion_output/manifest.json"
cp "$companion_root/../mobile/public/pwa-icon-192.png" "$companion_output/icon.png"
