# Signing and releases

## Choose the artifact

| Goal | Artifact and signing |
| --- | --- |
| Personal Android development | Debug APK, automatically debug-signed, separate `.dev` application ID |
| Personal Android release or direct distribution | Release APK signed with your own persistent keystore |
| Google Play | Signed Android App Bundle (`.aab`), Play App Signing and your upload key |
| iOS Simulator | Simulator `.app`; physical-device signing not required |
| Personal iPhone/iPad | Development-signed app and profiles for your team/device, including extensions |
| Registered iOS testers | Exported IPA with suitable device provisioning |
| TestFlight/App Store | Distribution-signed archive uploaded through App Store Connect |
| Browser | Static `dist/`; HTTPS hosting, no native code-signing |

This repository's CI validates source; it does not configure your signing assets,
upload binaries, or publish releases. Packaging succeeds independently of whether
all native features have passed physical-device verification.

## Identity and versions

For an independent fork, choose your own app name and unique application/bundle IDs.
For an update to your own existing installation, preserve its identity and signing
continuity. Changing IDs creates a separate installation and does not migrate its library.

| Setting | Files to review |
| --- | --- |
| Capacitor identity and Share Target App Group | `apps/mobile/capacitor.config.ts` |
| Android installed identity | `apps/mobile/android/app/build.gradle` (`applicationId`, plus `.dev` debug suffix) |
| Android visible name | `apps/mobile/android/app/src/main/res/values/strings.xml` |
| iOS target identities and team | `apps/mobile/ios/App/App.xcodeproj/project.pbxproj`; all three targets in Xcode |
| iOS App Group | All three `.entitlements` files, Capacitor config, and native group literals |
| URL handlers and extension configuration | Native manifests/Info.plists and companion manifests |

Changing Android's `applicationId` alone does not require renaming the Java/Kotlin
source namespace. If you rename that namespace too, update native packages and
manifest component names consistently. Capacitor sync does not rewrite every
native identity or hardcoded App Group value for you.

To locate iOS App Group references before adopting your own group:

```sh
rg -n 'group\.com\.hmrguez\.wovenleaf' \
  apps/mobile/capacitor.config.ts apps/mobile/ios
```

Update every runtime reference as well as entitlements. In particular, file sharing
and Libby inbox access depend on the same group across host and extensions.

From the repository root, preview and then apply the appropriate version operation:

```sh
make version-patch DRY_RUN=1
make version-patch
# Alternatives: make version-minor, make version-build, make version-sync
```

The script updates Android `versionName`/`versionCode` and iOS
`MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` for App, ShareExtension, and
LibbyExtension. `version-build` increments the build without changing the version;
`version-sync` aligns existing values without incrementing. The mobile package's
`0.0.0` is not the native release version. Review and commit the native version changes.

## Prepare a release candidate

From `apps/mobile`:

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run cap:sync
```

`cap:sync` builds production web assets and copies them and plugin configuration
into the native projects. Remove any temporary live-reload `server.url` configuration
before shipping. Set any optional companion listing variables before this build.

From the repository root:

```sh
python3 scripts/check-public-repo.py
git diff --check
```

If changing runtime dependencies, regenerate notices using
[the license inventory guide](../../scripts/licenses/README.md). Record new media
and hashes in `ASSET_LICENSES.json`. Keep signing keys, passwords, profiles, archives,
and private test data outside the source tree.

## Android: signed release APK

### Create a key once

Choose a durable key location outside the repository. The following example uses
a personal directory and prompts for passwords and certificate details:

```sh
mkdir -p "$HOME/.wovenleaf-signing"
keytool -genkeypair -v \
  -keystore "$HOME/.wovenleaf-signing/release.jks" \
  -alias wovenleaf-release -keyalg RSA -keysize 2048 -validity 10000
```

Back up the keystore and its passwords securely. Reuse this key for updates to
this APK distribution; a new random key will not update an installation signed
with the old key. Do not regenerate or overwrite the key for each release.

### Package and sign

The repository has no release `signingConfig`, so `assembleRelease` creates an
unsigned APK. Either use Android Studio's **Build → Generate Signed Bundle / APK**
wizard, or build and sign it explicitly:

```sh
# From apps/mobile, after production cap:sync
cd android
./gradlew assembleRelease
```

Install Android SDK Build Tools and place the chosen version's directory on `PATH`
so `zipalign` and `apksigner` resolve. For example, it lives under
`$ANDROID_HOME/build-tools/<installed-version>/`. From `apps/mobile/android`:

```sh
mkdir -p "$HOME/wovenleaf-releases"
zipalign -P 16 -f -v 4 \
  app/build/outputs/apk/release/app-release-unsigned.apk \
  "$HOME/wovenleaf-releases/wovenleaf-aligned.apk"
apksigner sign \
  --ks "$HOME/.wovenleaf-signing/release.jks" \
  --ks-key-alias wovenleaf-release \
  --out "$HOME/wovenleaf-releases/wovenleaf-release.apk" \
  "$HOME/wovenleaf-releases/wovenleaf-aligned.apk"
apksigner verify --verbose --print-certs \
  "$HOME/wovenleaf-releases/wovenleaf-release.apk"
zipalign -c -P 16 -v 4 "$HOME/wovenleaf-releases/wovenleaf-release.apk"
adb install -r "$HOME/wovenleaf-releases/wovenleaf-release.apk"
```

Passwords are prompted; keep them out of command history. Align **before** signing
and do not modify the APK afterward. The alignment check does not establish that
every bundled native library supports 16 KB memory pages; validate the complete
artifact on the target device configuration before distribution.

See Android's [APK signing reference](https://developer.android.com/tools/apksigner)
and [alignment reference](https://developer.android.com/tools/zipalign).

### Google Play bundle

In Android Studio, use **Generate Signed Bundle / APK → Android App Bundle**, select
your upload keystore, and choose Release. A bare `./gradlew bundleRelease` does not
sign the bundle in this repository. The standard output location is
`app/build/outputs/bundle/release/`; use the path reported by the wizard.

An AAB is a store input, not a directly installable APK. Use Play testing tracks or
`bundletool` to test device APKs. Keep Play's app-signing key and your upload key
roles distinct; a directly distributed APK must have a compatible signing identity
to update a Play-installed app. See [Android app signing](https://developer.android.com/studio/publish/app-signing).

Before a Play submission, review current target SDK and native-library requirements,
privacy/data-safety declarations, permissions, and the Libby receiver's `specialUse`
foreground-service declaration. The source build alone does not complete store review.

## iOS signing and personal installs

1. Add your Apple account in **Xcode → Settings → Accounts**.
2. Open `apps/mobile/ios/App/App.xcodeproj`, select the **App** scheme, and configure
   **Signing & Capabilities** for **App**, **ShareExtension**, and **LibbyExtension**.
3. Select your team on all three targets. Register unique bundle IDs for the host
   and both extensions, keeping extension IDs under your host's prefix.
4. Register an App Group for your team. Enable the same group for all three targets
   and update the runtime references listed above. Allow Xcode to create matching
   development profiles, or provide your own matching profiles.
5. Connect/trust your iPhone or iPad, enable Developer Mode when required, select
   it as the run destination, and Run.

The checked-in team and identifiers belong to the maintainer; they do not grant
signing access. Apple's account type and capabilities determine what can be
provisioned. This project's App Group and Safari extension setup is not guaranteed
with a free Personal Team; use an appropriately provisioned team for the complete app.
A simulator success does not verify device provisioning or the extension connection.

## iOS archive and IPA

After signing is configured and the production assets are synced, select a generic
physical iOS device destination in Xcode and **Product → Archive**. In Organizer,
choose **Distribute App** and the destination for your team: registered devices,
TestFlight, or App Store Connect. For registered-device distribution, profiles must
cover the intended devices and all embedded extensions.

Command-line archive, from `apps/mobile`:

```sh
mkdir -p "$HOME/wovenleaf-releases"
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$HOME/wovenleaf-releases/Wovenleaf.xcarchive" archive
```

Configure signing in Xcode first. If your team uses automatic signing, you may
allow profile updates with `-allowProvisioningUpdates` after authenticating Xcode.
To export an existing archive:

```sh
xcodebuild -exportArchive \
  -archivePath "$HOME/wovenleaf-releases/Wovenleaf.xcarchive" \
  -exportPath "$HOME/wovenleaf-releases/ios-export" \
  -exportOptionsPlist /absolute/path/to/your/ExportOptions.plist
```

Generate your export options with Organizer for your actual distribution method.
The checked-in `ios/App/ExportOptions-AppStore.plist` uses the maintainer's team,
manual profile names, and App Store Connect method; it is not a generic personal
install configuration. Keep a customized copy outside the repository.

Retain the archive and dSYMs for crash symbolication. An exported IPA still requires
a compatible signing/provisioning path to install; it is not an unrestricted iOS
sideload package. TestFlight/App Store distribution requires Apple Developer Program
membership and App Store Connect setup. See Apple's
[distribution guide](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)
and [registered-device guide](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices).

## Libby companion packaging

From the repository root:

```sh
node apps/libby-extension/build.mjs
```

| Output under `apps/libby-extension/dist/` | Use |
| --- | --- |
| `chromium/` | Unpacked development extension |
| `wovenleaf-libby-chromium.zip` | Chromium store submission or supported development ZIP installation |
| `firefox/`, `wovenleaf-libby-firefox.zip` | Development/submission artifacts; Firefox Android distribution needs Mozilla signing |
| `safari/` | Safari web source; the iOS Xcode target embeds/signs the native Safari extension |

The build also bundles the Chromium ZIP into the mobile app's ignored
`public/libby/` directory. Store URLs must point to genuine published listings.
Run the companion checks in the [debugging guide](debugging.md#libby) and review
[Libby setup release gates](../integrations/libby-setup-2026-09-24.md).
Code-free Android pairing and physical Safari verification remain outstanding;
do not infer readiness from packaging alone.

## Test and share your build

On a clean test install, exercise adding a book, file import, reading, audio,
permissions, export/restore, and any enabled integration. Also install the new
build over a previous build signed with the same identity and verify library
retention. Export a backup before an upgrade test involving valued data.

Name artifacts with their native version and build number. For direct Android
releases, publish the signed APK, a SHA-256 checksum, release notes, and matching
source/tag. Include `LICENSE`, third-party notices, and the modified MPL component's
corresponding source with your source release. Do not attach keys, provisioning
profiles, private archives, or user books.

For example, after giving the APK its versioned filename:

```sh
shasum -a 256 "$HOME/wovenleaf-releases/wovenleaf-release.apk"
```

Record the source commit, tools used, artifact checksum, and tested devices in
your release notes. Store publication and creating a GitHub release are separate
steps after verifying the artifacts; this guide does not publish anything for you.
