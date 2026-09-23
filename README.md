# Wovenleaf

All your reading. One quiet place. Wovenleaf is a private, local-first book tracker built with
React and Capacitor for web, iOS, and Android. It keeps a deliberately small workflow:
**To Be Read**, **Up Next**, **Reading**, and **Finished**.

## What it does

- Finds books by title, author, or ISBN through Open Library.
- Keeps provider evidence and metadata disagreements visible instead of silently overwriting a result.
- Can always add a personal, local-only book record when catalogs have no result.
- Adds a result directly to any of the four built-in shelves.
- Advances TBR books to Up Next, starts Up Next books, and finishes active books in one tap.
- Tracks reading percentage or current page, ratings, and private notes.
- Persists the library and a short-lived metadata cache in on-device SQLite; there is no account,
  backend, community layer, or cloud sync.

The first launch includes a small starter library so every interaction is immediately visible.
Each starter title can be moved or removed like any other book.

## Attach an EPUB or audiobook

Open **My Books**, select the book, then choose **Attach EPUB** or **Attach audiobook** under
**Attach a file**. The file is associated with that selected library entry and copied into private
managed storage. Audiobooks accept one M4B file or an ordered set of MP3 files.

Advanced surfaces remain available for development without complicating the default experience.
Set any of these Vite environment variables to `true` in `apps/mobile/.env.local` to enable them:

- `VITE_FEATURE_SMART_LISTS` — saved rule-based lists.
- `VITE_FEATURE_ADVANCED_BOOK_DETAILS` — edition, provenance, merge, and split tools.
- `VITE_FEATURE_ADVANCED_FILE_MANAGEMENT` — global file intake and EPUB storage tools in Settings.

All three flags default to `false`.

## TBR recommendations

Recommendations are available by default, with a Balanced preset. Up to three matching books
appear first in the TBR with a darker border and a star. Tap the star for the score and reasons;
the TBR preferences button offers presets, an off switch, and optional advanced weights.
Untouched legacy defaults upgrade automatically; customized legacy settings and new off choices
are preserved.

The comparison runs locally and uses recorded metadata, tags from finished books rated 4–5 stars,
page count, live loan deadlines, and time waiting. Series order uses the primary series' optional
`seriesPosition` or explicit labels such as `Earthsea #2` and `Title (Earthsea, #2)`. Known sequels
wait until every earlier numbered installment is recorded as finished. Missing order stays
unknown; no API lookup or title-number guess is made. Series names are scoped by author.

The local cache stores IDs, scores, and explanations. Relevant library/tag/rating/metadata changes,
imports, shelf moves, preference changes, and dismissals invalidate it. It also expires at the
next UTC day or loan-day boundary and refreshes on resume. Cover, note, progress, and queue-order
edits don't invalidate the comparison. Cache failure safely falls back to local recomputation.

## Book metadata providers

Open Library is the catalog provider and needs no API key. Requests are rate-limited to its
published unauthenticated limit, locale-aware, and cached on device for seven days. If live search
is unavailable, Wovenleaf can show the last saved result with a visible freshness label. Manual
entry is always available from the Add Book panel, including offline and in release builds.

## Stack

- Bun 1.3.13
- React 19.2.8
- Vite 8.2.2
- TypeScript 7.0.2
- Capacitor 8.5.0
- Android API 36 (minimum API 24)
- iOS through Capacitor's Swift Package Manager integration

The mobile app lives in `apps/mobile`. Its package versions are exact and reproducible through
`apps/mobile/bun.lock`.

## Domain architecture

The accepted canonical catalog contract separates Works, Editions, Assets, identifiers,
provenance, ownership, access, loans, people, and contributors. Its invariants, roadmap ownership
map, rejected alternatives, and legacy migration consequences are recorded in
[`docs/architecture/decisions/0001-canonical-catalog-boundaries.md`](docs/architecture/decisions/0001-canonical-catalog-boundaries.md).
The append-only reading event/session ledger, native location normalization, offline ordering,
correction, checkpoint, and privacy/export rules are recorded in
[`docs/architecture/decisions/0003-reading-ledger.md`](docs/architecture/decisions/0003-reading-ledger.md).
The threat model, native credential vault, least-privilege capabilities, redaction boundary,
screen/lock behavior, and backup/encryption stance are recorded in
[`docs/architecture/decisions/0004-private-data-and-integration-credentials.md`](docs/architecture/decisions/0004-private-data-and-integration-credentials.md).
Staged backup validation, three-point local rotation, atomic restore, and failed-launch rollback are
defined in [`docs/architecture/decisions/0014-staged-backup-and-recovery.md`](docs/architecture/decisions/0014-staged-backup-and-recovery.md), with a privacy-safe
[support runbook](docs/guides/recovery.md).

Source trust and reconciliation are field-scoped: newer data is not inherently better, exact user
choices do not freeze unrelated fields, and Work merge/split/Edition reassignment are journaled and
undoable. The rules and adapter examples are recorded in
[`docs/architecture/decisions/0002-source-precedence-and-reconciliation.md`](docs/architecture/decisions/0002-source-precedence-and-reconciliation.md).
Run `make conflicts` to use the keyboard- and screen-reader-oriented conflict inbox prototype at
`/__conflicts` during development.

## Paper system

Wovenleaf's Pulp design system defines the semantic paper, ink, depth, typography, state, and
texture contract used by the app. Its modes, measured contrast matrix, performance budget,
quiet-retreat rubric, do/don't examples, and platform evidence are documented in
`apps/mobile/src/design-system/README.md`. Appearance preferences are available from Settings
and remain local to the device.

The development-only component proofing table lives at `/__gallery`. Run `make gallery` to review
its primitive, composite, feedback, accessibility, and performance states. Stable screenshot
baselines and the approval checklist are documented in `apps/mobile/src/design-system/GALLERY.md`.

## App identity and release setup

Wovenleaf is free for 20 library entries. **Wovenleaf Unlimited** is a permanent native
in-app purchase for unlimited books, restorable within the same store account. See the
[purchase setup and testing guide](docs/guides/in-app-purchases.md) for creating the
products, configuring Android's public verification key, testing without real money,
and gifting upgrades with store-issued codes. Store configuration and sandbox tests
must be completed before releasing the paid upgrade.

Wovenleaf uses the same production identifier on iOS and Android:
`com.hmrguez.wovenleaf`. Its custom deep-link scheme is `wovenleaf://`. Keep these identifiers
stable after a store release: changing either native application ID makes the operating system
treat the result as a different app with a separate data container.

Android debug builds install alongside the Play Store app as **Wovenleaf Dev**
(`com.hmrguez.wovenleaf.dev`), with a `-dev` version suffix and the standard debug
signing key. This applies automatically to `make android-run`, `make android-device`,
`make android-live`, `make android-install`, the Bun Android run scripts, and Android
Studio's `debug` build variant. Each app has its own library and settings, so local
installs no longer replace the store app or interfere with its updates.

Signed release APKs and AABs still use **Wovenleaf** (`com.hmrguez.wovenleaf`)
and the existing release/upload signing workflow. Use the `release` variant when
generating a signed bundle for Google Play; test Play purchases with that store build.
Both apps handle `wovenleaf://` links and supported file imports, so Android may ask
which app to open when both are installed.

If an older debug build is currently installed under the production ID, export any
library data you want to keep before uninstalling it and installing Wovenleaf from
Google Play. This is a one-time transition; the new Dev app starts with separate data.

The internal Capacitor WebView schemes remain at their defaults. On first launch, Wovenleaf
defensively migrates `bookmanager.library.v1` or `wovenleaf.library.v1` into canonical SQLite
records. It checkpoints an exact recovery copy, verifies the committed records through the domain
schemas, and only then removes the old key. Invalid data remains untouched and the app offers a raw
recovery download. This preserves browser development data and native data for upgrades that retain
the same app container. A development build already installed under the former native application
ID has a different OS container and cannot be read by the renamed app; preserve that installation
until any needed data has been copied.

Release credentials remain local and are not committed:

- In Xcode, select the Apple Developer team, register `com.hmrguez.wovenleaf`, and configure
  automatic or manual distribution signing before creating an archive.
- For Google Play, create and securely back up an upload keystore, configure the release signing
  values outside Git, and let Play App Signing manage the distribution key.

`make android-release` intentionally produces an unsigned APK until local signing is configured.

### Regenerate identity assets

The approved QUI-6 masters are versioned under `branding/source/`. Regenerate
every iOS, Android, splash, favicon, and PWA asset from those masters with one command:

```bash
make brand-assets
```

The generator uses `uv`, updates the Git-tracked assets that ship with the app, validates required
pixel dimensions and Android's adaptive safe zone, and writes store sources, mask/appearance previews,
hashes, and QA evidence to `branding/final/platform/` (gitignored). To use masters stored elsewhere,
override `BRAND_SOURCE_PNG`, `BRAND_SOURCE_SVG`, and optionally `BRAND_LOCAL_OUTPUT` on the command.
Do not hand-edit generated PNG files; change the approved master or generator and rerun it.

## First run

```bash
make install
make doctor
make dev
```

Open the URL Vite prints, normally `http://localhost:5173`.

Run `make help` for the complete command list. The common flows are:

```bash
make check             # lint + production web build
make sync              # build web and copy it into iOS + Android
make ios-simulator     # build and launch the default iPhone Simulator
make android-run       # choose a connected phone/emulator and run
make android-build     # create a debug APK
make ios-build         # compile against an iOS Simulator
```

To choose a different iPhone:

```bash
make ios-list
make ios-simulator IOS_SIMULATOR='iPhone 17'
```

If Xcode has two runtimes with the same device name, also specify the runtime:

```bash
make ios-simulator IOS_SIMULATOR='iPhone 17 Pro' IOS_SDK='26.5'
```

`make ios-open` opens Xcode and `make android-open` opens Android Studio. Native archives and
store uploads should be created with the locally configured credentials described above.

## Run on a Google Pixel over USB

On macOS, Android does not require an OEM USB driver.

1. Install Android Studio. In **Settings → Languages & Frameworks → Android SDK**, install Android SDK Platform 36, Android SDK Build-Tools, and Android SDK Platform-Tools.
2. On the Pixel, open **Settings → About phone** and tap **Build number** seven times. Enter the device PIN when prompted.
3. Go to **Settings → System → Developer options** and enable **USB debugging**.
4. Connect the Pixel with a data-capable USB cable. Unlock it, choose **File transfer / Android Auto** if a USB mode prompt appears, and accept **Allow USB debugging**. Selecting “Always allow from this computer” avoids repeated RSA prompts on your own Mac.
5. Verify the connection:

   ```bash
   make android-devices
   ```

   The phone must show a serial followed by `device`. If it says `unauthorized`, unlock the Pixel and accept the RSA dialog.
6. Build and run on that exact device:

   ```bash
   make android-device ANDROID_TARGET=SERIAL_FROM_THE_PREVIOUS_COMMAND
   ```

For rapid UI work with live reload:

```bash
make android-live ANDROID_TARGET=SERIAL_FROM_THE_PREVIOUS_COMMAND
```

The live target uses `adb reverse` to forward port 5173, so the phone can reach Vite through USB without exposing the development server to the local network.

### Wireless debugging (Android 11+)

Keep the Mac and Pixel on the same Wi-Fi network. On the Pixel, open **Developer options → Wireless debugging**, turn it on, and choose **Pair device with pairing code**. Then use the SDK's `adb` binary (the default macOS SDK location is shown below):

```bash
~/Library/Android/sdk/platform-tools/adb pair PHONE_IP:PAIRING_PORT
# Enter the six-digit pairing code shown by the Pixel.
~/Library/Android/sdk/platform-tools/adb connect PHONE_IP:DEBUG_PORT
make android-devices
make android-device ANDROID_TARGET=PHONE_IP:DEBUG_PORT
```

The pairing port and debugging port can be different; copy each from the corresponding Pixel screen. Android Studio can also pair through **Device Manager → Pair Devices Using Wi-Fi** with a QR code.

### Pixel troubleshooting

- `unauthorized`: unlock the phone, accept the RSA prompt, or use **Developer options → Revoke USB debugging authorizations**, reconnect, and accept again.
- No device appears: confirm the cable supports data, switch USB mode to file transfer, then run `adb kill-server && adb start-server` using the full SDK path above.
- `adb: command not found`: use `make android-devices`, which automatically checks `$ANDROID_HOME`, `$ANDROID_SDK_ROOT`, and `~/Library/Android/sdk`.
- Gradle cannot find the SDK: open `apps/mobile/android/` once in Android Studio, or export `ANDROID_HOME="$HOME/Library/Android/sdk"` in your shell profile.
- The phone cannot load a live-reload page: reconnect USB and rerun `make android-live`; its port-forwarding only exists while ADB is connected.

## Native development loop

Capacitor packages the `apps/mobile/dist/` web build inside each native project. After changing
React code for a normal native build, run `make sync`; the build targets already do this for you.
After installing a Capacitor plugin with `cd apps/mobile && bun add PACKAGE`, run `make sync` again.

The native projects are committed intentionally. Changes made in Xcode or Android Studio—permissions, signing, icons, entitlements, Gradle settings—remain normal Git-tracked project changes.

## Requirements and references

- Vite requires Node 20.19+ or 22.12+; Capacitor 8's CLI requires Node 22+ when invoked with Node. This project invokes local tools with Bun, while `make doctor` also checks Node for native-tool compatibility.
- iOS builds require macOS, Xcode, and an installed iOS Simulator runtime.
- Android builds require Android Studio/SDK, Platform-Tools, and JDK 21.

Official references:

- [Vite getting started](https://vite.dev/guide/)
- [Capacitor documentation](https://capacitorjs.com/docs)
- [Android: run apps on a hardware device](https://developer.android.com/studio/run/device)
- [Apple: run apps on simulated or physical devices](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)

## Marketing site

The Astro landing page lives in `apps/landing` and integrates the three Track, Read,
and Listen campaign infographics. Run `bun install` and `bun run dev` in that
folder to open it at `http://127.0.0.1:4321`. See
[`apps/landing/README.md`](apps/landing/README.md) for build and app-link configuration,
and [`branding/marketing/README.md`](branding/marketing/README.md) for the Canva design,
mobile screenshots, asset sources, and capture limitations.
