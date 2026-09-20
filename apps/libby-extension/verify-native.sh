#!/bin/sh
set -eu
companion_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
companion_test_dir=$(mktemp -d "${TMPDIR:-/tmp}/wovenleaf-libby-native.XXXXXX")
trap 'rm -rf "$companion_test_dir"' EXIT HUP INT TERM
xcrun swiftc -module-cache-path "$companion_test_dir/cache" \
  "$companion_root/../mobile/ios/App/App/LibbyInbox.swift" \
  "$companion_root/tests/native/main.swift" -o "$companion_test_dir/verify"
"$companion_test_dir/verify"
