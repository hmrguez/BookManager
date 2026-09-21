# Libby setup and browser support

Status: in progress · 2026-09-21 · QUI-54

## Goal

Deliver four-stage setup with automatic book and progress capture, without JSON downloads, imports or manual capture. Follow Wovenleaf’s minimal design; use `frontend-design` for UI changes.

## Starting point

Quetta is verified on the Pixel for ebooks and audiobooks. Safari is implemented but needs physical iPhone verification. JSON is a fallback; ZIP installation is development-only. See [current implementation](../integrations/libby.md).

## Target setup

1. **Add the companion.** Enable the bundled Safari extension or install the Android store listing, then grant site permissions.
2. **Connect Wovenleaf.** One clear consent action enables automatic capture. Investigate replacing Android’s copy/paste pairing code with an app-to-browser handoff.
3. **Connect your Libby library.** Guide Libby’s official device-linking flow; skip when already connected. Libby authorization remains separate from Wovenleaf pairing.
4. **Start reading.** Visit the Shelf once, then open a book. Confirm completion after Wovenleaf receives its title and percentage.

Browser and Libby dialogs add taps within these stages. Detect completed stages, resume across app switches, remove duplicate toggles and offer **Reconnect**. Keep JSON outside the consumer flow.

## Delivery order

### 1. Validate Safari on a physical iPhone

- Verify permissions, delivery, resume, upgrades, existing-book matching and stale-Shelf protection.
- **Done:** non-zero progress arrives automatically from both reader types without revisiting the Shelf or importing files.

### 2. Simplify setup and ship normal installation

- Build the flow with automatic status checks and recovery.
- Spike Android pairing handoff before promising code-free setup. Preserve consent and authentication; keep secrets out of URLs and logs.
- Submit the Chromium store package; replace ZIP instructions after approval. Distribute Safari through Wovenleaf.
- **Done:** fresh Safari and Quetta installations receive their first book without developer tools or progress files.

### 3. Add Firefox on Android

- Reuse capture logic; adapt the manifest, background execution and Chromium-specific connection-origin handling.
- Verify delivery, restart/reconnect, upgrades and browser switching; publish through Mozilla’s catalog.
- **Done:** both formats pass on a physical Android device. Firefox iOS is excluded.

### 4. Validate usability and release readiness

- Test setup with five unfamiliar users without coaching; record completion time and obstacles.
- Verify interrupted setup, delivery retries and preservation of books/links.
- Run extension/native tests, `bun run lint` and `bun run typecheck`; document physical-device coverage.

## Browser priorities and reach

Prioritize **Safari → Quetta onboarding → Firefox Android**. Chromium does not guarantee mobile extension support. Brave’s [Android extension issue](https://github.com/brave/brave-browser/issues/4493) remains open despite contradictory website wording; verify before promising support. Follow [Firefox Android requirements](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/).

Safari represents 25.87% of [worldwide mobile traffic](https://gs.statcounter.com/browser-market-share/mobile/worldwide) and 52.84% in the [US](https://gs.statcounter.com/browser-market-share/mobile/united-states-of-america), August 2026. Traffic share does not predict paying users; measure setup completion and continued web reading.

## Boundaries

Web reading remains the MVP. Native Libby tracking, an embedded Libby WebView, desktop-to-phone delivery and guaranteed native/web synchronization are excluded. Store approval, a physical iPhone and successful pairing-handoff verification are delivery dependencies.


## Implementation update · 2026-09-21

Companion 0.6 adds a Firefox Android package (MV2 event page per Mozilla guidance), runtime-derived extension origins, and strict Firefox UUID-origin validation in the Android encrypted receiver. Safari and Chromium retain shared capture logic. Firefox declares website-content transmission to the local app using Mozilla’s built-in consent, with desktop 140 / Android 142 minimums; these are API floors, not a physical-device compatibility matrix.

The app now presents four stages for each browser, remembers the browser choice, refreshes connection status on resume, clears expired pairing codes, and offers reconnect/switch-browser recovery. The Android pairing action explicitly enables capture as well as delivery. File fallback is under Connection help. Quetta’s ZIP is generated from the same sources for every app build and can be saved with Android’s document picker; no separate computer-to-phone transfer is needed. This remains developer installation, not store distribution. Safari remains bundled by Xcode. Firefox source/ZIP are built for signing; unsigned Firefox ZIPs are deliberately not offered as a normal installation path. A real AMO URL can be supplied using `VITE_LIBBY_FIREFOX_STORE_URL`.

Verified: lint/typecheck, 15 Libby unit tests, six app browser flows including ZIP contents and browser-choice persistence, all four installed Chromium extension suites, Android build, and three production crypto/schema tests on Pixel 9. Mozilla’s linter reports zero errors/warnings. Firefox 156 on the Pixel accepts the temporary extension and its popup reads status successfully; Libby is unlinked in that browser, so real Firefox ebook/audio capture, reconnect, upgrade and browser-switch verification remain outstanding. The native Save companion action was verified through the app UI: Android saved the ZIP to Downloads and its SHA-256 matched the bundled build byte-for-byte. The working Quetta pairing was preserved. Brave 1.95.104 is installed, but Brave Android remains excluded while upstream extension support is unresolved.

Still required: signed Firefox distribution and Chromium store approval, real Firefox loan verification, physical Safari verification, a secure code-free pairing handoff spike, and the five-user usability pass. Bundling the Android ZIP reduces file-transfer friction; it does not bypass browser consent or signing. No code-free handoff is claimed and no pairing secrets are placed in URLs.
