# Libby progress in Wovenleaf

Implemented under QUI-54. The MVP is **read in Libby web → visit its Shelf → open Wovenleaf**. After one-time setup, new loans join Reading and forward percentages update automatically. No Capture, Send, Import or Apply tap is needed. Existing-title ambiguities and progress conflicts still require review.

The companion observes the **displayed web Shelf**, not the reader or native Libby process. Libby can leave a shelf percentage behind the player: pause/close the audiobook mini-player and use **Shelf → Actions → Synchronize Shelf** if needed. Wait for the displayed percentage before returning to Wovenleaf. Native-to-web synchronization is best effort and is not an MVP dependency. There is no embedded Libby WebView, desktop requirement, provider credential collection, private sync client or cloud relay.

## What is implemented

| Layer | Implementation |
| --- | --- |
| Companion | Shared Safari/Chromium sources; separate capture consent; rendered title ID, title, author, format, percentage and optional public cover URL; bounded validation; retry and optional JSON export |
| Safari | Bundled extension; native-message/App Group inbox; protected atomic files, locking, backup exclusion; acknowledged after app persistence |
| Quetta / Android | One-time pairing; encrypted same-phone loopback delivery; foreground connection with Pause action; durable inbox; OS share/file import fallback |
| Wovenleaf | New-loan auto-add, remembered links, automatic forward progress, review for existing titles/conflicts, Undo, unlink and disconnect; browser setup guides |
| Persistence | Migration 19 transactional state plus the existing `library_books` repository; no inferred reading sessions, page positions, start dates or automatic completion |

Wovenleaf applies received progress on launch/resume. Android also delivers an event to a running app. A 100% capture stays on Reading until the user finishes the book.

## Safari setup

The bundled Manifest V3 companion requires iOS/iPadOS 15.4 or later ([WebKit release notes](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)).

1. In Wovenleaf Settings, expand **Libby** below Goodreads and enable **Libby progress**. Leave **Add new loans to Reading** and **Update progress automatically** enabled. Existing installations retain their previous per-book matching grant until auto-add is enabled separately.
2. In iPhone/iPad Settings, open **Apps → Safari → Extensions → Wovenleaf Libby** and enable it. Older versions list Safari directly in Settings.
3. Open **libbyapp.com in Safari**. To copy your existing Libby setup, choose **Yes, I Have A Library Card → Recover Your Data → Display Setup Code**. In native Libby, open **Menu → Copy To Another Device** and enter the website's code. Return to Safari and wait for transfer completion. This code belongs only in Libby.
4. Use Safari’s page menu / Manage Extensions to allow the companion on **libbyapp.com**. Open it and enable **Capture this browser’s Libby shelf**. Refresh a shelf that was already open during installation.
5. Read in Libby web, then visit its **Shelf** and wait for the displayed percentages. Capture and delivery run automatically. Open Wovenleaf to see new loans and updated progress.

The native inbox can receive while Wovenleaf is closed. iOS does not grant continuous observation of native Libby or an always-running Safari extension. Physical Safari validation remains outstanding; the containing app and embedded extension build in the simulator.

## Quetta setup

1. In Wovenleaf Settings, expand **Libby** below Goodreads and enable Libby progress and the two automatic preferences.
2. **A public store listing is not available yet.** For development, save the companion ZIP on the phone. In Quetta, open **Extensions → Manage Extensions → Developer options**, enable **Developer mode**, choose **from .zip/.crx/.user.js**, then select the ZIP. Confirm **Wovenleaf · Libby progress** is enabled. This path was verified on Quetta **2.0.5**. After publication use the actual Chrome Web Store or Edge Add-ons listing.
3. Open **libbyapp.com in Quetta** and copy your Libby setup using its own device-code flow above.
4. In **Wovenleaf → Settings → Libby → Get connection code**, copy the one-time code. Open **Quetta menu → Extensions → Wovenleaf · Libby progress**, paste it into **Wovenleaf connection code**, and choose **Connect automatically**. This is a separate code from Libby’s setup code; it expires after five minutes.
5. Turn on **Capture this browser’s Libby shelf**, close the companion and refresh the web Shelf after installation. Read on the website, visit its Shelf, and open Wovenleaf. Capture, delivery, new-loan addition and eligible progress updates happen automatically.
6. Android keeps a **Libby connection** foreground service, with a generic notification and Pause action. Reopen Wovenleaf after a phone restart or force-stop. If explicitly paused, choose **Resume connection** in Settings, then revisit the shelf. Android battery/process restrictions can interrupt availability; the companion retries while the shelf remains visible.

Only one browser companion is paired at a time. **Connect a different companion** replaces the prior key when pairing succeeds. Development ZIP reinstallations can create a second extension ID: remove the older instance, keep the new one, pair it again, enable capture, and refresh the Shelf. Wovenleaf's book links survive.

**Fallback:** choose **Save progress file**, finish the download, then import `wovenleaf-libby.json` in Wovenleaf Settings. Alternatively open it in **Quetta → Downloads → Share → Wovenleaf**. Direct Web Share stalled in Quetta 2.0.5 popups and was unavailable in a full extension tab. A paired companion's retry button uses the local receiver; file export remains available. Exporting discloses private titles and progress to the chosen destination.

## Android transport and lifecycle

The foreground service binds **127.0.0.1:43187 only**, never a Wi-Fi interface. The Chromium host permission is `http://127.0.0.1/*` because match patterns cannot restrict ports; code uses only the fixed port and two routes. No Libby cookie, card, account credential or browser history is read.

Pairing uses a random 128-bit bootstrap code, a five-minute monotonic expiry and at most five attempts. An AES-GCM encrypted challenge establishes a random 256-bit key. Android keeps it in Android Keystore; the companion persists a **nonextractable WebCrypto CryptoKey in its own IndexedDB**. No key goes in a URL, ordinary extension storage, library database, logs or exports. User-requested code copying is marked sensitive and cleared after five minutes when Android permits it and the clipboard still contains that code.

All request and response bodies are AES-GCM encrypted with fresh 96-bit IVs and route/origin/direction-bound authenticated data. The app pins the paired extension origin; the extension authenticates receipts and snapshot IDs. Another local process cannot forge a successful receipt or decrypt a capture without the key. A process occupying the fixed port can deny service. Compromise of the unlocked browser/extension can use its key: nonextractability is not protection against code running in that extension context.

The receiver enforces exact Host/Origin, bounded headers and bodies, JSON-only POSTs, strict snapshot validation, and a maximum of 20 pending atomic files in no-backup storage. Wovenleaf acknowledges only after a database commit. Retrying a pending capture retains its ID; a full/unavailable receiver stays pending instead of silently reporting success. The service stops after an unpaired code expires and runs without a polling wake lock. There is no boot receiver or promise of uninterrupted background execution.

Android's `specialUse` foreground-service type requires an appropriate Google Play declaration/review before release ([Android documentation](https://developer.android.com/develop/background-work/services/fgs/service-types#special-use)). A successful debug-device test does not establish store approval.

## Data and reconciliation contract

A strict version-1 `wovenleaf-libby` envelope contains a UUID, capture timestamp and 1–100 observations, within 128 KB. Each observation has a numeric-string Libby title ID, ebook/audiobook format, title, author, finite percentage in [0,100], and an optional public `coverUrl`. Unknown fields, duplicate identities, invalid values and future timestamps are rejected. Missing progress is unknown, not zero; duplicate visible cards are omitted as ambiguous. Partial capture never deletes absent books or links.

Companion 0.3 captures cover URLs from rendered loan images, unwrapping known Libby/OverDrive resize proxies to public HTTPS `ImageType-*` assets on `img*.od-cdn.com` or `images.contentreserve.com`. Libby may strip the source host; root-relative `ImageType-*` paths inside those known proxies resolve to the public `img1.od-cdn.com` CDN. Native and app validators reject arbitrary hosts, credentials, query strings and fragments. Only the URL is saved as the book thumbnail; the app loads it without a referrer and imports no image file. Covers require connectivity or the WebView’s ordinary image cache. Existing artwork is preserved; missing artwork can be filled even when progress is unchanged. Canvas-only or unavailable images are omitted. Install the updated Wovenleaf app before companion 0.3, since older strict native receivers reject the added field. Older captures remain valid.

The timestamp means **when the web shelf was observed**, not when the user read or Libby synced. No guaranteed propagation latency is exposed.

With auto-add enabled, a fresh unlinked title absent from the library becomes a Reading book at its captured percentage, with a link and undo receipt in the same transaction. Any normalized same-title library entry requires manual edition selection; there is no silent title-only match. Disabling auto-add leaves new titles for review. Unlinked/dismissed identities are excluded from future automatic addition until explicitly accepted. Existing installations default this new grant off; newly enabled integrations default it on as disclosed in the UI.

For a book already on any shelf, expand **Settings → Libby**, choose the existing edition under **Ready to review**, then choose **Link & apply progress** if it is on Reading. On TBR, Up Next, Finished or DNF, the button is **Move to Reading & link** and explains the shelf change. The same book ID, notes, rating, page markers and existing cover are preserved; the finished date is cleared when moving back to Reading. This explicit choice avoids silently linking a different edition. Later forward captures update the remembered link automatically. Unlinking allows a later capture to be reviewed and linked again.

Automatic updates to linked books require: Reading shelf, unchanged last accepted Wovenleaf revision, nondecreasing percentage, unpaused link, capture no older than a day, and automatic updates enabled. Manual edits, backward movement, stale captures, other shelves and Undo-paused links remain for review. One book cannot link to two Libby identities.

Limits are 500 links, 500 excluded identities, 100 latest observations, 200 envelope IDs and 50 receipts; the UI shows ten receipts. Full review queues stop ingest transactionally. Each mapping retains an observed timestamp to reject old updates after ID eviction. Undo checks the committed book revision, restores prior progress/page fields and, for new receipts, the original shelf, cover and finished date; it pauses automatic updates. Undo of an auto-added book restores its previous percentage; it does not delete the new Reading entry.

Disconnect erases integration settings, links, captures, exclusions, deduplication and receipts plus native inbox/key; books and their current progress remain. Turn capture off to erase the browser snapshot and use **Disconnect this browser** to erase its key. Revoking site access stops collection. Libby controls its own account link. Portable library exports retain book progress but exclude operational integration state; full database recovery snapshots include that private state. Native inboxes and device keys are excluded from automatic app backup.

## Verification and release status

Physical verification on **2026-09-20** used Android Studio’s Running Devices mirror and Run configuration, a **Pixel 9 / Android 17 / API 37**, **Quetta 2.0.5**, and **Libby 9.5.0**:

- Installed the updated app without clearing the existing library; loaded the companion ZIP and completed Libby’s official device setup.
- Initial 0% capture, JSON export/import and viewer sharing worked, including cold launch and duplicate-file replay without duplicate books.
- Enabled automatic delivery and paired Quetta with the same-phone encrypted receiver.
- Observed real **0% → 5% → 10%** Wovenleaf receipts. Neither update used Capture, Send, Import, Check received captures or Apply. Returning to Wovenleaf consumed the automatic capture.
- The first 5% originated in native Libby; opening the web player synchronized that position. Advanced playback in the **web player** to 10%, paused and closed it. Its Shelf stayed at 5% until **Synchronize Shelf**, then the extension delivered 10% automatically. Native sync timing is not part of the MVP promise.
- After the disposable dev-state reset described below, installed the final app and companion, enabled Libby and paired once. Merely visiting the web Shelf and reopening Wovenleaf automatically created the previously absent loan on Reading at **10%**, with no Capture, Send, Import, manual matching or Apply. The phone is left paired with this one Reading entry.

A follow-up on the same Pixel installed companion **0.3.0** and verified the real City of Stairs cover arrived automatically at the unchanged **10%**, filling the missing thumbnail on the existing book ID. The live resize URL contained a host-relative `ImageType-100` path; resolving it to the public CDN returned the actual JPEG. Then moved that same book to TBR, unlinked it, revisited the web Shelf and selected the existing TBR entry under Ready to review. **Move to Reading & link** preserved its ID and cover. Repeated unlink/capture/selection while it was already on Reading and verified **Link & apply progress**. A database read confirmed one book and one active mapping. The phone is left with that book on Reading at 10%, with its cover and the final companion paired. The temporary cover diagnostic was removed. Both Android boundary tests passed through direct instrumentation without uninstalling or clearing Wovenleaf.

Automated verification covers installed Chromium capture and local encrypted delivery, opaque-key persistence across browser restart, connection loss/retry, mismatched/tampered/full receipts, opt-in and disconnect, plus transactional auto-add, replay, ambiguity, opt-out, stale data, rollback, conflicts and Undo. The app’s lint/typecheck and 382 Bun tests pass. Existing-book tests cover TBR, Reading, Up Next, Finished and DNF, including preserved identity/metadata, explicit shelf movement, Undo, cover-only updates and later automatic progress. Two 390px Playwright flows exercise the real settings UI and storage for TBR and Reading, including the collapsed panel order, keyboard disclosure, matching, Undo and subsequent 25% updates without duplicates. Native Android tests exercise production AES-GCM/schema boundaries using synthetic data without touching the device’s saved connection or books. Safari parser tests and the simulator embedded-extension build were verified in the earlier implementation.

During the first Gradle connected-test run, AGP cleanup unexpectedly uninstalled the target app and erased the dev library. The user confirmed it was disposable development data and requested no recovery. The repository now sets `android.injected.androidTest.leaveApksInstalledAfterRun=true`; the follow-up run passed both tests with APK retention and no uninstall in its UTP log. The test methods themselves use synthetic crypto/schema inputs and do not write app state. Do not run unreviewed test suites on a personal-data installation.

Before public release: signed physical iPhone/iPad installation, permissions/native inbox, ebook and audiobook formatting, offline/resume, upgrades, current Quetta compatibility, Android battery restrictions and foreground-service declaration, App Group provisioning, and real store distribution. Do not promote simulator/synthetic results into physical-device claims. No listing or release has been published.

Build packages using [the companion guide](../../apps/libby-extension/README.md). Set a store URL only after an actual listing exists.

## Sources

- [Libby: syncing devices](https://help.libbyapp.com/en-us/6023.htm)
- [Libby: online and offline behavior](https://help.libbyapp.com/en-us/6022.htm)
- [Apple: Safari web extensions](https://developer.apple.com/documentation/safariservices/creating-a-safari-web-extension)
- [Apple: native messaging](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)
- [Quetta: installing mobile browser extensions](https://www.quetta.net/blog/how-to-use-browser-extensions-on-android-phone)
- [Chrome: cross-origin extension requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
