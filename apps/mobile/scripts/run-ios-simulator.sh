#!/usr/bin/env bash
set -euo pipefail

simulator_name="${IOS_SIMULATOR:-iPhone 17 Pro}"
simulator_sdk="${IOS_SDK:-}"
app_path='ios/DerivedData/Build/Products/Debug-iphonesimulator/Wovenleaf.app'

if [ ! -d "$app_path" ]; then
  printf 'Simulator build not found at %s. Run make ios-build first.\n' "$app_path" >&2
  exit 1
fi

if ! simulator_id="$(xcrun simctl list devices available -j | IOS_SIMULATOR_NAME="$simulator_name" IOS_SIMULATOR_SDK="$simulator_sdk" bun -e '
  const input = await Bun.stdin.text()
  const { devices } = JSON.parse(input)
  const wantedName = process.env.IOS_SIMULATOR_NAME
  const wantedSdk = process.env.IOS_SIMULATOR_SDK
  const runtimeEntries = Object.entries(devices)
    .filter(([runtime]) => runtime.includes("SimRuntime.iOS"))
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
  for (const [runtime, candidates] of runtimeEntries) {
    const sdk = runtime.split("SimRuntime.iOS-")[1]?.replaceAll("-", ".")
    if (wantedSdk && sdk !== wantedSdk) continue
    const match = candidates.find((device) => device.name === wantedName && device.isAvailable !== false)
    if (match) { console.log(match.udid); process.exit(0) }
  }
  process.exit(1)
')"; then
  printf 'No available simulator named "%s"' "$simulator_name" >&2
  if [ -n "$simulator_sdk" ]; then printf ' with iOS %s' "$simulator_sdk" >&2; fi
  printf '. Run make ios-list.\n' >&2
  exit 1
fi

xcrun simctl boot "$simulator_id" 2>/dev/null || true
xcrun simctl bootstatus "$simulator_id" -b
open -a Simulator
xcrun simctl install "$simulator_id" "$app_path"

app_id="$(bun -e "import config from './capacitor.config.ts'; console.log(config.appId)")"
xcrun simctl launch "$simulator_id" "$app_id"
printf 'Launched %s on %s (%s).\n' "$app_id" "$simulator_name" "$simulator_id"
