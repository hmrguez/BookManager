# Libby progress in Wovenleaf

Implemented under QUI-54. Native Libby remains the reader. The supported workflow is **native Libby → linked web Shelf → Wovenleaf**. An explicit browser visit remains necessary. There is no embedded Libby WebView, desktop dependency, provider credential collection, private sync client, or always-on background tracking.

## What is implemented

| Layer | Implementation |
| --- | --- |
| Browser companion | Shared Safari/Chromium sources, explicit capture consent, rendered shelf metadata only, popup, retry, native delivery, share and JSON export |
| Safari | Bundled native extension target, App Group inbox, schema validation, atomic writes, cross-process locking, backup exclusion, acknowledgement after app persistence |
| Android / Quetta | User-initiated JSON/text sharing and file import; Android JSON VIEW handoff normalized to existing share intake, including opaque provider URLs |
| Wovenleaf | Settings guides for both browsers, first-time title matching or add to Reading, remembered links, forward updates, review of conflicts/backward/stale positions, Undo, unlink, disconnect |
| Persistence | Additive migration 19; one transactional state record, progress changes and receipts committed together; no inferred reading sessions, pages, start dates or completion |

The current live library uses `library_books`; this adapter updates that same repository transactionally. It does not invent canonical reading-ledger events or remote page positions. It changes percentage and `lastUpdatedAt`, preserving page markers and other metadata. A 100% capture remains on Reading until the user finishes the book.

## Safari setup

The bundled Manifest V3 companion requires iOS/iPadOS 15.4 or later ([WebKit release notes](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)).

1. Enable **Libby progress** in Wovenleaf Settings. The automatic-updates setting applies only to books you explicitly match.
2. In iPhone/iPad Settings, open **Apps → Safari → Extensions → Wovenleaf Libby** and enable it. Older iOS versions list Safari directly in Settings.
3. Open **libbyapp.com in Safari**. Choose the option to copy from another device. Get a setup code from native Libby at **Menu → Settings → Copy To Another Device** and enter it in the Libby website. Never put that code in Wovenleaf.
4. Use Safari’s page menu / Manage Extensions to allow the companion on **libbyapp.com**. Open the companion and enable **Capture this browser’s Libby shelf**.
5. Visit the web **Shelf**, wait for percentage labels, then choose **Capture shelf now**. Open Wovenleaf and match each title once, or add it to Reading.
6. After future reading, let native Libby sync online, visit the web Shelf in Safari, and return to Wovenleaf. If the website shows an old percentage, use **Shelf → Actions → Synchronize Shelf**, then capture again.

Capture runs when the shelf is visible and changes. The native inbox can receive captures while the containing app is closed; Wovenleaf applies eligible updates when it next opens/resumes. iOS does not grant an always-running Safari extension or a way to observe native Libby continuously.

## Quetta setup

1. Enable Libby progress in Wovenleaf Settings.
2. In **Quetta for Android**, open its Extensions menu and the Chrome Web Store / Edge Add-ons store. Install **Wovenleaf · Libby progress** from the published listing, enable it, and allow access to libbyapp.com. **A public listing still needs publication.** The source bundle is prepared; do not claim Quetta supports unpacked installation on every build. Developer installation and store acceptance must be checked on the target Quetta version.
3. Open **libbyapp.com in Quetta** and link it using native Libby’s Copy To Another Device flow, as above.
4. Open the web Shelf, wait for percentages, then open the companion. Enable capture, choose **Capture shelf now**, then **Send to Wovenleaf** and select Wovenleaf in Android’s share sheet.
5. Match each title once. After each later web-shelf visit, send again. Linked, forward updates apply on receipt if enabled.
6. If Web Share is unavailable, choose **Save progress file**. In Wovenleaf Settings → Libby, choose **Import progress file**, or open/share the JSON file with Wovenleaf. Never select an export destination you do not want to receive those private titles and percentages.

Browser Libby needs internet. People can also read in mobile Safari/Quetta and return to the Shelf to capture afterward. The companion does not observe the full reader itself.

## Data and reconciliation contract

Each strict version-1 `wovenleaf-libby` envelope has a UUID, a capture timestamp and 1–100 observations. An observation contains only Libby title ID, ebook/audiobook format, title, author and a finite percentage in [0, 100]. Files are limited to 128 KB. Unknown fields, duplicate title/format keys, bad numbers and future timestamps are rejected. Missing percentages are unknown, not zero; duplicate cards for the same title/format are omitted as ambiguous. Captures are partial: absence never deletes a book or link.

The capture timestamp means **when the website was observed**, not when Libby last synced or when the user read. The provider does not expose that fact through this DOM probe. Even a freshly captured shelf may be stale; there is no guaranteed propagation latency.

A user must opt in and match each `(format, Libby title ID)` once. Automatic writes require a Reading book, the last accepted Wovenleaf revision still matching, a nondecreasing percentage, an unpaused mapping, a capture no older than a day, and the automatic-updates preference. Everything else remains for explicit review. No automatic title-only match or silent deduplication with an existing Wovenleaf book is performed. One local book cannot be linked to two Libby identities.

The repository remembers up to 500 links, 100 latest title observations, 200 envelope IDs and 50 undo receipts; the UI shows the latest ten receipts. A full pending review queue asks the user to review/dismiss entries. Each mapping also retains its last observed timestamp, so an old capture cannot supersede it after ID-cache eviction. Undo requires the book still to match the committed revision, restores its previous progress fields, and pauses that link until explicit acceptance. Adding a new book uses the existing library capacity policy; Undo restores its progress but does not delete the added book.

Disconnect erases local integration settings, links, captures, deduplication state and receipts, plus the Safari inbox. It preserves the user's books and their current progress. Turn capture off in the companion to erase its cached snapshot too. Revoking browser site access stops collection. Libby account linking itself is controlled by Libby. Reconnection requires fresh matching.

Portable library exports retain library percentages but intentionally exclude operational Libby links/inbox state, as they do other integration cursors. Full local database recovery snapshots include the integration record and should be treated as private. No provider credential is stored by this integration.

## Verification and release status

Verified on 2026-09-20:

- App lint and TypeScript checks; all 374 Bun tests pass (including seven Libby tests).
- Installed Chromium extension on offline synthetic shelf pages, including opt-in, 0→42→66 changes, partial/invalid/ambiguous data, SPA navigation, popup JSON download, marked text fallback and capture erasure.
- Local mobile-width app flow: enable, import 0%, add/match, automatic 37%, backward 12% review, Undo back to 0% with automatic updates paused, persistence across reload, and disconnect erasing integration state while preserving the book. Safari and Quetta guides checked at 390px, including Night/high contrast with no horizontal overflow or browser errors.
- iOS Simulator app build with the Safari extension embedded; production Swift boundary validation.
- Android debug app build including JSON VIEW/SEND routing and the pinned share-target fix.

The connected-phone check returned **no ADB devices** during implementation. The earlier spike established matching audiobook 0% on native Libby and its linked web shelf, but not nonzero propagation. Do not promote synthetic tests or successful builds into a claim of live mobile end-to-end verification.

Before public release, verify on signed physical iPhone/iPad and a current Quetta Android build: extension installation, permissions, native↔web nonzero sync on a disposable/sample title, ebook and audiobook formatting, Web Share support or file fallback, cold/warm app launch, offline/resume, duplicate capture, manual-edit conflict, Undo, disconnect, and app upgrade. Also test Safari's native message response/inbox and the distribution team's App Group provisioning. The repository creates no store accounts, publishes no listing, and uploads no release.

Build the packages from [the companion directory](../../apps/libby-extension/README.md). Set the actual companion store URL in `apps/mobile/.env` only once published. The containing iOS app has a target dependency and Embed App Extensions entry for `LibbyExtension`; its resource phase uses the shared source directly. Signing and public store review remain release work.

## Sources

- [Libby: syncing devices](https://help.libbyapp.com/en-us/6023.htm)
- [Libby: online and offline behavior](https://help.libbyapp.com/en-us/6022.htm)
- [Apple: Safari web extensions](https://developer.apple.com/documentation/safariservices/creating-a-safari-web-extension)
- [Apple: native messaging](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)
- [Quetta: installing mobile browser extensions](https://www.quetta.net/blog/how-to-use-browser-extensions-on-android-phone)
- [Web Share API and user activation](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
