# Build and run

## Requirements

| Target | Tools |
| --- | --- |
| All | Git, Bun 1.3.13 (`.bun-version`); Node.js 22+ for native tools/scripts run with Node |
| Browser | A current browser |
| Android | Android Studio, JDK 21, Android SDK Platform 36, Build Tools, Platform Tools, emulator or USB device |
| iOS | macOS, full Xcode with an iOS SDK and simulator runtime; Apple signing for physical devices |

Android currently supports API 26+, with compile/target SDK 36 in
`apps/mobile/android/variables.gradle`. The iOS app targets 15.0; its Libby
extension targets 15.4. Install the toolchains required by the checked-in projects.

## First run

```sh
git clone https://github.com/hmrguez/wovenleaf.git
cd wovenleaf/apps/mobile
bun install --frozen-lockfile
bun run dev
```

Open Vite's printed URL. No Wovenleaf account, billing setup, or API key is needed.
Optional Libby listing variables are documented in the [root README](../../README.md#companion-build-and-configuration).
Restart Vite after changing `.env.local`; Vite variables are embedded at build time.

Installation applies the committed native dependency patches. Keep those patches
and `bun.lock` together. `dev` generates localization files and builds the Libby
companion before starting Vite. Native plugins still require an installed native build.

From the repository root, `make help` lists shortcuts and `make doctor` checks
local tooling. It checks both native platforms, so a missing unused toolchain
need not prevent browser-only development.

## Browser production preview

From `apps/mobile`:

```sh
bun run build
bun run preview -- --host 127.0.0.1
```

`dist/` contains the static web output. Use HTTPS when hosting it; localhost works
for development. Browser storage has quotas and can be cleared or evicted. Native
reader, background audio, extension transport, and secure storage need native testing.

## Android

Set Android Studio's Gradle JDK to JDK 21. Install SDK 36 and accept its licenses
in SDK Manager. Let Android Studio create the local SDK configuration, or set
`ANDROID_HOME` to your SDK directory and put its `platform-tools` on `PATH`.

From `apps/mobile`:

```sh
bun run android:open
```

This builds the web app, syncs Capacitor, and opens Android Studio. Choose an
emulator or authorized USB device and run the `app` debug configuration.
For command-line installation:

```sh
bun run cap:sync
cd android
./gradlew assembleDebug
adb devices -l
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Debug uses `com.hmrguez.wovenleaf.dev`, with a separate library from the release
app `com.hmrguez.wovenleaf`. On a physical device, enable Developer options and USB
debugging and approve the computer's authorization prompt.

For an explicit Vite development-mode bundle, use `bun run android:run:dev` from
`apps/mobile`. Normal `cap:sync` embeds the production web build even in a native
Debug configuration. After web changes, rebuild and sync before rerunning the
installed app. `make android-live` offers live reload; use it on a development
installation, and run `bun run cap:sync` before packaging a release.

## iOS

From `apps/mobile`:

```sh
bun run ios:open
```

Select the **App** scheme and an installed simulator, then Run. Capacitor sync
restores Readium's Swift Package Manager entries through
`scripts/configure-ios-spm.ts`; allow Xcode to resolve the packages.

For an unsigned simulator build:

```sh
bun run cap:sync
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO build
```

This produces a simulator `.app`, not an installable iPhone IPA. To run on an
actual device, configure all three targets' signing and App Group first; follow
[Signing and releases](releasing.md#ios-signing-and-personal-installs).
Unlike Android, iOS Debug and Release currently share the same bundle ID and can
replace each other. Use a separate identity for a separate development library.

## Validation

From `apps/mobile`:

```sh
bun run lint
bun run typecheck
bun run test
bun run build
```

For browser integration and visual tests, install Playwright's browser once:

```sh
bunx playwright install chromium
bun run gallery:test
# Or run a targeted flow:
bunx playwright test visual-tests/libby.spec.ts
```

Playwright starts Vite on port 4173 and runs the suites in `visual-tests/`. Use an
isolated browser and demo files. Browser checks do not verify device-specific
reader, camera, background playback, or signing behavior.

Android native unit tests, after syncing, run from `apps/mobile/android`:

```sh
./gradlew testDebugUnitTest
```

For instrumentation, use an emulator or dedicated test installation and review
the selected suite before running it. Keep the committed
`android.injected.androidTest.leaveApksInstalledAfterRun=true` setting: default
AGP cleanup can uninstall the app and delete its library.

## Marketing website

From the repository root:

```sh
cd apps/landing
bun install --frozen-lockfile
bun run dev
```

Run `bun run lint`, `bun run typecheck`, and `bun run build` in this directory
before shipping website changes. Its `dist/` is separate from the mobile build.
