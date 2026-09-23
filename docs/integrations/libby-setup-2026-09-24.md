# Libby setup redesign — 2026-09-24

## Agreed experience

Libby web remains the required reading destination. Settings contains one compact Libby row;
a dedicated sheet guides setup one action at a time. Android asks whether the reader uses Quetta
or Firefox. iOS uses Safari. Browser choice and setup progress survive closing the sheet/app.
The existing book-level Read with Libby link retains the Shelf destination.

Installation uses published marketplace links on Android and the bundled Safari extension on iOS.
There are no ZIP or developer-mode directions in normal setup. Until publication, the UI states
that the listing is unavailable and lets existing companion users continue. Required release env:
`VITE_LIBBY_EXTENSION_STORE_URL` and `VITE_LIBBY_FIREFOX_STORE_URL`. No placeholder URL is supplied.

Detailed Libby library-transfer instructions appear only under help at the Shelf step. Passkey
recovery is mentioned before the separate Libby setup-code fallback. Preferences, matches, undo,
and disconnect remain available in the Libby sheet after connection.

## Verification and recovery

Enabling the integration or pairing the browser is not completion. A validated capture received
through the native inbox records `lastVerifiedCaptureAt`. Manual file/share intake does not certify
the browser connection. The connection check requires capture time at or after its start time;
receiving an old queued capture cannot pass it. Replayed snapshots can certify the native transport
without duplicating library writes. Choosing another browser starts a new verification window. Closing an unfinished connection check preserves the existing setup status.

The browser explicitly reports `emptyShelf: true` with zero observations. All three validators reject
unmarked empty snapshots and mixed empty/nonempty snapshots. The extractor currently supports exact
visible English empty-state copy; an absent tile, a loading page, or an unrecognized language does
not imply an empty library. Real empty-Shelf DOM/localization coverage remains to be verified before
release. Empty observations never delete existing loans/books.

Safari first capture asks its signed native handler whether the app opted in, avoiding a redundant
initial capture toggle. An explicitly disabled companion remains disabled. Physical Safari permission,
browser-opening, App Group signing, and lifecycle behavior still require device verification.

Connection help uses plain language. It can resume a paired Android receiver on request and offers
opening Libby for a fresh capture. It does not silently reset keys or claim to diagnose every browser
permission from Wovenleaf. Technical errors, code fallback, and file import remain under disclosures.

## Release blockers

**Code-free Android pairing is not implemented and must block release.** The owner explicitly retained
this requirement after the security review. Tracked in [QUI-56](https://linear.app/hrcoding/issue/QUI-56/build-a-private-extension-wovenleaf-handoff-and-reconciliation-inbox),
which now also blocks the integration release gate QUI-87. The existing authenticated manual code
exchange remains available under More options for development/recovery only.

A proposed loopback navigation carrying an ephemeral public-key fingerprint and nonce was removed
before commit. Another app can occupy the local port and launch its own page/handshake in a legitimate
browser. A key pinned from that URL does not authenticate Wovenleaf; the nonce also acts as bearer
authorization. A future solution needs an independently authenticated trust anchor, replay/expiry
proofs, interruption recovery, and physical Quetta/Firefox first-connect/reconnect evidence. It must
preserve ADR 0004; there is no new unauthenticated listener or credential-bearing URL in this change.

Publishing/signing the Chromium and Firefox companions, configuring genuine listing URLs, and
completing the three-browser physical-device matrix are also outstanding. Packages can be generated
with `node apps/libby-extension/build.mjs`; marketplace accounts/access have not been established.

## Verification performed

- Browser preview: dedicated sheet, selected Firefox instructions, close/reopen resume, restored
  keyboard focus, desktop and 390×844 mobile layouts. Portaling the sheet prevents Settings layout
  containment from clipping it beneath navigation.
- `bun run lint`, `bun run typecheck`, and Libby repository tests.
- Installed Chromium fixture suites: Shelf, encrypted local delivery, ebook reader, audio player;
  includes explicit-empty-Shelf fixture and existing protected pairing recovery.
- `verify-safari.mjs`: actual background script with native consent fixture; explicit browser opt-out
  and foreign-origin rejection.
- `verify-native.sh`: compiled Swift snapshot validator, including empty-Shelf ambiguity rejection.
- Pixel 9 / Android 17: all four `LibbyConnectionTest` instrumentation tests passed, including Firefox
  origin binding and the new empty-Shelf native schema checks. Tests do not change library or pairing.
- Development Android build compiles. Full physical browser UI verification is not claimed: Android
  Studio mirroring displayed black during this session. No iOS physical device was available.
