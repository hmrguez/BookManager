# Quetta clean installation record — 2026-09-23

## Result

The clean installation reproduced **paired + existing Shelf visible + return to Wovenleaf = no capture**. Reloading that same Shelf tab, without reconnecting or using manual capture/import, made all three loans arrive automatically. Opening an audiobook from the reloaded Shelf subsequently produced a direct player capture with no pending delivery.

This narrows the earlier empty-cache finding: returning to a Libby document loaded before companion installation did not initialize capture. A fresh page load did. It does not establish that every empty-cache incident has this cause, or explain the user's earlier session with certainty.

## Environment and reset scope

- Pixel 9, Quetta 2.0.5; existing Libby login and browser tabs preserved.
- Removed only Wovenleaf Dev (`com.hmrguez.wovenleaf.dev`) and the Wovenleaf Quetta companion, as requested. The separate Wovenleaf app remained installed.
- Reinstalled the existing local debug APK: Wovenleaf Dev **1.8.0-dev**, version code **9**, built September 23 at 23:14 local time. No application code was changed or rebuilt for this run.
- Reinstalled companion **0.6.1** from the matching generated Chromium ZIP.
- Written step record; no screen video was recorded. One-time pairing codes are omitted.

Artifact SHA-256:

```text
APK  682c806fc5e68a63197881d80cfa15a640f26cdb26982e72c0d447d8fcd77433
ZIP  5a8330005e1e85c77a19f7dffa36428cb8c51c8a87fcf1a01bb72787c40d47ee
```

## Steps performed

1. In Quetta, opened **menu → Extensions → Manage Extensions → Wovenleaf · Libby progress → Remove Extension → Remove**. Confirmed **No installed extensions**.
2. Uninstalled Wovenleaf Dev with `adb uninstall com.hmrguez.wovenleaf.dev`. ADB returned `Success`; its local library, settings and connection were removed.
3. Installed `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` with `adb install`. ADB returned `Success`.
4. Copied the generated `apps/libby-extension/dist/wovenleaf-libby-chromium.zip` to the phone's Downloads as `wovenleaf-libby-clean-0.6.1.zip`. This is equivalent to supplying the packaged ZIP through **Save companion to phone**; that export button itself was not retested.
5. In Quetta, opened **Manage Extensions → Developer options → from .zip/.crx/.user.js**, selected **Downloads → wovenleaf-libby-clean-0.6.1.zip**, and confirmed the installed companion displayed **0.6.1** and **On, extension enabled**. Developer mode was already enabled.
6. Launched Wovenleaf Dev. Confirmed all five reading-status shelves contained **0** books.
7. Opened **Settings → Libby → Enable Libby progress**. Left **Add new loans to Reading** and **Update progress automatically** enabled.
8. Selected **Get connection code**. Opened the companion through Quetta's Extensions menu. Confirmed its fresh state: unpaired, capture off, **No capture yet**.
9. Entered the fresh one-time code and submitted **Connect & enable capture**. Confirmed capture became enabled, pairing succeeded, and the popup said **Connected. Return to your Libby Shelf to capture automatically.** The code was transferred into the normal popup form; no pairing state or database was written directly.
10. Closed the popup, revealing the existing Libby **Shelf** tab. This document had been open before installation. Returned to Wovenleaf Dev. A read-only database check still showed **0 mappings, 0 items, 0 receipts, 0 seen captures**, with import and automatic settings enabled. This reproduces the reported symptom despite following the popup's instruction.
11. Returned to Quetta and **reloaded the same Shelf tab**. Did not reconnect, click **Capture progress now**, retry delivery, or import a file.
12. Returned to Wovenleaf Dev. A read-only check confirmed **3 mappings and 3 applied receipts**, one for each loan. Automatic import created the three Reading entries.
13. Returned to the reloaded Shelf and selected **Open Audiobook** for City of Stairs. The companion's session state then held a direct player observation at **29%**, remembered `playerPercent: 29`, and **0 pending captures**. No play, seek, page turn or manual progress edit was performed.
14. Returned to Wovenleaf Dev for receipt processing and left the app open.

## Observed values and limits

| Loan | Fresh Shelf capture | Initial import |
| --- | ---: | --- |
| The Well of Ascension | 31% | Applied |
| City of Stairs | 29% | Applied |
| City of Blades | 5% | Applied |

Before the reload, the old Shelf document displayed **70%** for The Well of Ascension. After reloading it reported **31%**, which the fresh Wovenleaf installation imported. No reading position was advanced or edited during this run. The cause of Libby's old-versus-fresh Shelf discrepancy was not investigated; the previously reported 70% should not be treated as a verified current reader position.

Direct audiobook capture was verified at its unchanged position. Forward progress during playback, ebook page turns, browser/phone restart recovery and cache expiry were not separately exercised.

## Setup gap exposed

The successful-pairing message says to return to the Shelf, but returning to an already-open preinstallation document failed in this run. The existing setup guide mentions refreshing after an update, yet the same need appeared after a fresh install. Until onboarding handles that case, a precise recovery step is: **after installing the companion, reload the Libby Shelf or use the companion's Open Libby Shelf link, then return to Wovenleaf**.

The connection establishes the receiver pairing and enables consent; it does not itself reload existing Libby documents or guarantee the first Shelf capture. This is a documented onboarding limitation, not a code fix in this task.
