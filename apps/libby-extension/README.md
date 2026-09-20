# Wovenleaf Libby companion

A local companion for Libby web reading. Visit the web Shelf once to capture loan metadata, then listen in its web player and open Wovenleaf: new loans and eligible forward percentages arrive automatically. Native-to-web synchronization is best effort. Companion 0.4 adds displayed audiobook-player percentages; ebooks still use the Shelf. The 0.4 player path has isolated-browser verification only until a physical Quetta/Safari test is completed. This captures displayed percentages; it does not monitor the native app, open books, use private APIs, or poll a Libby account in the background.

## Build and verification

From the repository root, with the mobile app's dependencies installed:

```sh
node apps/libby-extension/build.mjs
node apps/libby-extension/verify.mjs
node apps/libby-extension/verify-player.mjs # isolated cross-origin audiobook player
node apps/libby-extension/verify-local.mjs # isolated browser + synthetic encrypted loopback peer
sh apps/libby-extension/verify-native.sh # macOS + Xcode
```

`dist/chromium` is the unpacked Chromium extension and store-upload source. `dist/safari` has the Safari manifest. Both use `src/`; the iOS Xcode target copies those same sources at build time using `build-safari.sh`, without depending on Node on the Xcode PATH. Generated packages are ignored by Git.

The browser test installs the real MV3 extension in isolated Chromium and serves synthetic Libby pages locally. It checks opt-in, 0%, fractional values, hidden/missing/invalid/ambiguous titles, mutations, SPA navigation, isolated execution, validation, popup export, text-share fallback, and erase on pause. Native validation tests compile the production Swift parser. These tests do not establish real Quetta or mobile Safari runtime compatibility.

## Delivery

- **Safari (iPhone/iPad):** the bundled `LibbyExtension.appex` receives `runtime.sendNativeMessage`. It validates a bounded snapshot and queues it in `group.com.hmrguez.wovenleaf/LibbyInbox` with data protection, backup exclusion, atomic files, and a cross-process lock. Wovenleaf drains the queue on launch/resume or “Check received captures”, then acknowledges each database commit. The native receiver is off until Wovenleaf Settings → Libby is enabled.
- **Quetta (Android):** pair once using Wovenleaf Settings → Libby → Get connection code. The companion sends AES-GCM encrypted captures directly to the same phone’s loopback receiver. A foreground service has a generic notification and Pause action; reopen Wovenleaf after restart/force-stop. The app drains its bounded, no-backup inbox on receipt/resume and acknowledges after database commit. Android Keystore and a nonextractable extension IndexedDB CryptoKey hold the connection key. No provider credential, raw secret in URLs/storage.local, or cloud relay is involved. File import/viewer sharing remains the verified fallback; direct Web Share stalled in Quetta 2.0.5.

The installed-browser local test checks encrypted Shelf 5→10 and player 15→20 delivery, outage recovery from a stale Shelf, pairing/key persistence across restart, unavailable receiver retries with stable IDs, authenticated receipts, full inboxes and disconnect. Android production AES-GCM/schema tests are in `LibbyConnectionTest`; run the targeted `:app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.hmrguez.wovenleaf.LibbyConnectionTest` Gradle task. The test methods do not change saved pairing or library data. Keep the repository’s `android.injected.androidTest.leaveApksInstalledAfterRun=true` setting: AGP otherwise uninstalls the target app during cleanup, deleting its data.

The companion also requires explicit “Capture Libby web progress” opt-in. It observes rendered loan tiles on `/shelf` or `/shelf/loans` at `https://libbyapp.com`. Version 0.4 also reads the single visible `.timeline-percent-visual` label in an embedded `*.listen.overdrive.com` audio player. The Libby host script accepts messages only from its visible, revealed player frame on an `/open/loan/…` route; the frame document title must match recent Shelf metadata for that numeric title ID. Samples, other frames, unknown titles and missing/ambiguous labels are ignored. The card segment of the loan path and the frame URL are never forwarded or retained. A later Shelf percentage below the remembered player percentage is omitted; an actual player rewind is sent to the existing Wovenleaf review flow. This requires an additional OverDrive player site permission in both browsers. Refresh Libby after updating; Safari may ask to allow the embedded player. Site permission is origin-wide because Libby navigates as an SPA, but observation checks the current route and document visibility each time. It never accesses page local storage, cookies, tokens, library cards, book contents, or browsing history.

Version 0.3 also captures a rendered cover's public OverDrive image URL when available. Libby's resize URLs are reduced to the underlying HTTPS asset; arbitrary hosts, credentials and query strings are rejected. Wovenleaf stores the URL and loads it without a referrer, preserving an existing chosen cover. No image file is imported. Update Wovenleaf before installing companion 0.3: older native receivers reject the new optional `coverUrl` field. Captures without covers remain supported.

One last snapshot, up to 20 pending deliveries, and up to 100 recent loan metadata/last-player-percentage entries are cached in extension session storage, or local storage on browsers without session storage. Entries expire after 24 hours without observation and are pruned on the next cache access; turning capture off erases all three immediately. Newer waiting captures replace older captures for the same covered titles; other loans remain queued. Returning to a stale Shelf still retries waiting player captures, so a temporary connection failure does not require reopening the player. After browser restart/cache expiry, visit the Shelf again before listening. Each native receiver queues at most 20 unacknowledged captures and reports a full inbox rather than silently discarding them. No telemetry or remote Wovenleaf service is used.

## Releasing

1. Follow [the implementation and release guide](../../docs/integrations/libby.md).
2. Build and zip the **contents** of `dist/chromium`, including the root `manifest.json`, for a Chrome Web Store or Edge Add-ons listing. No listing is published by this repository.
3. After a real listing exists, set `VITE_LIBBY_EXTENSION_STORE_URL` to its HTTPS URL when building the app. Only the two supported store hosts are accepted. Without it, the Quetta guide gives the verified 2.0.5 development ZIP path: **Extensions → Manage Extensions → Developer options → Developer mode → from .zip/.crx/.user.js**. It never invents a store listing.
4. Sign the app and new Safari extension with the existing team's App Group entitlement. The extension bundle ID is `com.hmrguez.wovenleaf.LibbyExtension`. Distribute through the containing Wovenleaf app/TestFlight.
5. Declare/review Android’s `specialUse` foreground-service purpose for Google Play. Complete the physical-device checks in the guide before advertising this as a verified mobile integration.

Do not ask users for a Libby password or library card in Wovenleaf. Linking stays in Libby's own UI. Wovenleaf is an independent companion, not an OverDrive/Libby product.
