# Wovenleaf Libby companion

A local companion for linked Libby web shelves. People can keep reading in native Libby, then briefly visit its web shelf. This captures displayed percentages; it does not monitor the native app, open books, use private APIs, or poll a Libby account in the background.

## Build and verification

From the repository root, with the mobile app's dependencies installed:

```sh
node apps/libby-extension/build.mjs
node apps/libby-extension/verify.mjs
sh apps/libby-extension/verify-native.sh # macOS + Xcode
```

`dist/chromium` is the unpacked Chromium extension and store-upload source. `dist/safari` has the Safari manifest. Both use `src/`; the iOS Xcode target copies those same sources at build time using `build-safari.sh`, without depending on Node on the Xcode PATH. Generated packages are ignored by Git.

The browser test installs the real MV3 extension in isolated Chromium and serves synthetic Libby pages locally. It checks opt-in, 0%, fractional values, hidden/missing/invalid/ambiguous titles, mutations, SPA navigation, isolated execution, validation, popup export, text-share fallback, and erase on pause. Native validation tests compile the production Swift parser. These tests do not establish real Quetta or mobile Safari runtime compatibility.

## Delivery

- **Safari (iPhone/iPad):** the bundled `LibbyExtension.appex` receives `runtime.sendNativeMessage`. It validates a bounded snapshot and queues it in `group.com.hmrguez.wovenleaf/LibbyInbox` with data protection, backup exclusion, atomic files, and a cross-process lock. Wovenleaf drains the queue on launch/resume or “Check received captures”, then acknowledges each database commit. The native receiver is off until Wovenleaf Settings → Libby is enabled.
- **Quetta (Android):** the verified path on Quetta 2.0.5 / Pixel 9 is **Save progress file → download → import in Wovenleaf**, or open it from **Quetta Downloads → Share → Wovenleaf**. Direct Web Share stalled in the popup and was unavailable in a full extension tab. The popup shows fallback instructions even when the share promise never settles. On browsers supporting Web Share, it prefers an `application/json` file and falls back to marked text. Wovenleaf accepts SEND and JSON VIEW intents; cold-start delivery and private payload logging in the existing share plugin are fixed by a pinned Bun patch.

The companion also requires explicit “Capture this browser’s Libby shelf” opt-in. It observes only rendered loan tiles on `/shelf` or `/shelf/loans` at `https://libbyapp.com`. Site permission is origin-wide because Libby navigates as an SPA, but observation checks the current route and document visibility each time. It never accesses page local storage, cookies, tokens, library cards, book contents, or browsing history.

Only one last snapshot is cached in extension session storage, or local storage on browsers without session storage. A capture older than 24 hours is discarded on the next cache access; turning capture off erases it immediately. Safari queues at most 20 unacknowledged captures and reports a full inbox rather than silently discarding them. No telemetry or remote Wovenleaf service is used.

## Releasing

1. Follow [the implementation and release guide](../../docs/integrations/libby.md).
2. Build and zip the **contents** of `dist/chromium`, including the root `manifest.json`, for a Chrome Web Store or Edge Add-ons listing. No listing is published by this repository.
3. After a real listing exists, set `VITE_LIBBY_EXTENSION_STORE_URL` to its HTTPS URL when building the app. Only the two supported store hosts are accepted. Without it, the Quetta guide gives the verified 2.0.5 development ZIP path: **Extensions → Manage Extensions → Developer options → Developer mode → from .zip/.crx/.user.js**. It never invents a store listing.
4. Sign the app and new Safari extension with the existing team's App Group entitlement. The extension bundle ID is `com.hmrguez.wovenleaf.LibbyExtension`. Distribute through the containing Wovenleaf app/TestFlight.
5. Complete the physical-device checks in the guide before advertising this as a verified mobile integration.

Do not ask users for a Libby password or library card in Wovenleaf. Linking stays in Libby's own UI. Wovenleaf is an independent companion, not an OverDrive/Libby product.
