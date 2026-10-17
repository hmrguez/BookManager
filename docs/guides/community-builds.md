# Build and install Wovenleaf

All library features are free and unlimited. No billing service, Wovenleaf
account, developer API key or store product is needed to build the application.
Users supply their own book files and library-service access. The public code
repository is https://github.com/hmrguez/BookManager . There is no promise of a
prebuilt release until a release asset is actually published.

For detailed workflows, see [Build and run](../development/building.md),
[Debugging](../development/debugging.md), and
[Signing and releases](../development/releasing.md).

## Android without Google Play

Use Bun 1.3.13, Android Studio/SDK 36, a JDK 21 installation, and the committed
Gradle wrapper. Accept the Android SDK's toolchain licenses locally; do not commit
SDKs, `local.properties`, keys or signing passwords. Check `android/variables.gradle`
for the exact target/minimum SDK requirements.

From `apps/mobile`:

```sh
bun install --frozen-lockfile
bun run cap:sync
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Debug uses `com.hmrguez.wovenleaf.dev` and can coexist with a store installation.
It has a separate library. It does not upgrade or open the store app's data.
The scanner uses Apache-licensed ZXing, not Google ML Kit or Google Play Services.
Network metadata lookup remains optional. Camera frames stay on the device.

For a public APK, build `assembleRelease` and sign it with your own securely held
key using Android's signing tools. An unsigned release APK cannot be installed.
Do not distribute debug keys as an official release identity. Keep the same app
ID and signing key for updates to an installation; use your own app ID/name for
an independently maintained fork. Do not overwrite another app's signing identity.
Ship the license notices and corresponding-source directory with release sources.

## iOS

Use macOS, Xcode, Bun, and the iOS SDK. From `apps/mobile`, install dependencies,
run `bun run cap:sync`, and open `ios/App/App.xcodeproj`. The reader uses Readium
via Swift Package Manager. `scripts/configure-ios-spm.ts` restores its package
entries after Capacitor sync. Simulator builds can use `CODE_SIGNING_ALLOWED=NO`:

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

A physical iOS device still requires Apple's signing/provisioning. Configure
your own team, unique app/extension identifiers and App Group consistently in
the app and its Share/Libby extensions. Account capabilities and distribution
options vary; open source does not bypass iOS installation rules. App Store
publication is optional and is a separate owner-operated process. Scanning uses
AVFoundation locally and requires camera permission. This guide does not promise
a fully working extension provisioning setup for every personal-team account.

## Web development and preview

From `apps/mobile`, `bun run dev` serves the browser app; `bun run build` produces
`dist/`. Host static output on HTTPS (localhost is allowed for local development).
The web scanner uses bundled ZXing and asks for browser camera permission.
Manual ISBN entry works without camera access. Imported files, IndexedDB storage
and database engine behavior follow the browser's capabilities and quotas.

Native EPUB navigation, background/system-media playback, extension pairing and
secure credential storage do not have identical browser behavior. Browser data
can be evicted or removed when site storage is cleared; use explicit exports and
keep backups. The web manifest alone is not an offline-cache guarantee. No hosted
public web app or browser/native feature parity is promised by this source release.

## Redistribution

Read `LICENSE`, `ASSET_LICENSES.json`, and `third_party/README.md`. Preserve notices;
modified Capgo files remain MPL-2.0, and fonts keep OFL terms. The app and website
expose the bundled notices. The Wovenleaf name does not imply endorsement of forks;
clearly identify your own build/operator and update website privacy contact details.
No license grants rights in users' books, provider covers, or service trademarks.
