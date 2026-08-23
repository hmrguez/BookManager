#!/usr/bin/env bash
set -u

errors=0
warnings=0

pass() { printf '\033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!\033[0m %s\n' "$1"; warnings=$((warnings + 1)); }
fail() { printf '\033[31m✗\033[0m %s\n' "$1"; errors=$((errors + 1)); }

has() { command -v "$1" >/dev/null 2>&1; }

printf 'BookManager development doctor\n\n'

if has bun; then pass "Bun $(bun --version)"; else fail 'Bun is missing (https://bun.sh/docs/installation)'; fi
if has git; then pass "Git $(git --version | sed 's/git version //')"; else fail 'Git is missing'; fi
if has node; then
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$node_major" -ge 22 ]; then pass "Node $(node --version) (Capacitor tooling compatible)"; else warn "Node $(node --version) found; Capacitor 8 expects Node 22+ when using Node directly"; fi
else
  warn 'Node is not installed; Bun runs the project, but some native IDE tooling may expect Node 22+'
fi

if [ -d node_modules ]; then pass 'JavaScript dependencies installed'; else fail 'Dependencies missing; run: bun install'; fi
if [ -x node_modules/.bin/cap ]; then pass "Capacitor $(bunx cap --version)"; else fail 'Capacitor CLI missing; run: bun install'; fi

printf '\niOS\n'
if [ "$(uname -s)" = 'Darwin' ]; then
  if has xcodebuild; then pass "$(xcodebuild -version | tr '\n' ' ')"; else fail 'Xcode command-line tools are missing'; fi
  if has xcrun && xcrun simctl list devices available 2>/dev/null | grep -q 'iPhone'; then pass 'At least one iPhone Simulator is installed'; else warn 'No available iPhone Simulator runtime found in Xcode'; fi
  if [ -d ios/App/App.xcodeproj ]; then pass 'iOS native project exists'; else fail 'iOS project missing; run: make ios-add'; fi
else
  warn 'iOS builds require macOS with Xcode'
fi

printf '\nAndroid\n'
if has java; then pass "$(java -version 2>&1 | head -n 1)"; else fail 'Java/JDK is missing (JDK 21 recommended)'; fi

android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$android_sdk" ] && [ -d "$HOME/Library/Android/sdk" ]; then android_sdk="$HOME/Library/Android/sdk"; fi
if [ -z "$android_sdk" ] && [ -d "$HOME/Android/Sdk" ]; then android_sdk="$HOME/Android/Sdk"; fi

if [ -n "$android_sdk" ] && [ -d "$android_sdk" ]; then
  pass "Android SDK: $android_sdk"
  adb_bin="$android_sdk/platform-tools/adb"
elif has adb; then
  adb_bin="$(command -v adb)"
  pass "Android SDK Platform Tools: $adb_bin"
else
  adb_bin=''
  fail 'Android SDK not found; install Android Studio and its SDK tools'
fi

if [ -n "$adb_bin" ] && [ -x "$adb_bin" ]; then
  pass "ADB $($adb_bin version | head -n 1 | sed 's/Android Debug Bridge version //')"
  device_count="$($adb_bin devices 2>/dev/null | awk 'NR > 1 && $2 == "device" { count++ } END { print count+0 }')"
  if [ "$device_count" -gt 0 ]; then pass "$device_count authorized Android device(s) connected"; else warn 'No authorized Android device is connected (the emulator is also fine)'; fi
else
  fail 'ADB is missing; install Android SDK Platform-Tools'
fi

if [ -d android ] && [ -x android/gradlew ]; then pass 'Android native project exists'; else fail 'Android project missing; run: make android-add'; fi

printf '\n'
if [ "$errors" -eq 0 ]; then
  printf '\033[32mReady.\033[0m %s warning(s).\n' "$warnings"
  exit 0
fi

printf '\033[31mNot ready.\033[0m %s error(s), %s warning(s).\n' "$errors" "$warnings"
exit 1
