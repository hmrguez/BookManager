# Reading original files

Native EPUB, PDF, and audiobook imports retain access to the selected original. Wovenleaf does not create a full private content copy. Generated covers, metadata, annotations, reading checkpoints, and engine caches remain local to the app. Keep originals downloaded in Files or the Android document provider for offline use.

Opening checks the saved reference, readability, size where applicable, and content fingerprint. Missing files, lost access, offline iCloud files, changed contents, and unsupported providers produce recovery messages. **Choose file** repairs an exact match without replacing asset IDs, audiobook capability IDs, reading positions, bookmarks, or notes. Selecting changed contents follows the existing explicit import/revision flow.

The file picker uses iOS open-in-place bookmarks or Android persisted document/tree grants. An absolute path alone is insufficient on these systems. JavaScript and native playback snapshots exchange opaque `wovenleaf-file://` references; the OS locator stays in a device-local native registry. iOS retains coordinated security-scoped access for a reader or loaded audio queue. Android readers and playback consume the provider URI/descriptor directly. PDFs require a seekable Android descriptor and fail with local-download guidance when a provider cannot supply one.

Book/audio Open With and share intake intercept sources before Wovenleaf's generic copying path. Temporary-only grants and representations ask the user to choose the original. CSV sharing keeps its previous behavior. Native HTML/drop inputs without a durable reference also require reselection. Browser imports retain their existing managed-file behavior.

## Storage and compatibility

- New ebook content assets use `linked-file`; audio content assets use `linked-bundle` with a reference for every segment. Migration 18 adds nullable `audiobook_files.reference_id`. Existing managed paths remain unchanged; linked rows use the reference and an empty legacy path column.
- Existing private imports remain readable. Wovenleaf cannot recover their original locations automatically. Exact ebook relinking retains the old private path for explicit storage cleanup. Existing private audiobook bytes are also retained when relinked; this change does not add an audiobook storage-cleanup UI.
- Cleanup validates app ownership and rejects original paths, including stale or forged previews. It never deletes or overwrites external content. Book content accounting separates linked bytes from private content copies.
- Portable archives omit device-local references. Optional EPUB/PDF inclusion reads the original explicitly and verifies its hash; unavailable active originals prevent an incomplete file-inclusive export. Audio byte backups are unchanged and outside this feature.
- Registry reconciliation follows storage migration/recovery. It retains catalog references and active/native audio consumers, with a one-day grace period for unfinished picks and extension handoffs. Releasing abandoned references never removes the source file.
- Inspection still assembles file bytes in memory, with existing size/file-count limits checked before native selection is read. Removing private copies does not make multi-gigabyte imports memory-free or remove fingerprinting costs.

## Verification, 2026-09-20

`bun run lint`, `bun run typecheck`, and all 354 Bun tests pass. Coverage includes linked EPUB/PDF import and native capability construction, no content writes, changed originals, exact relinking, original cleanup protection, retained private-copy cleanup, portable reference stripping, included ebook bytes, missing audio segments, per-track identity preservation, and migration of existing managed audio.

Both native Debug builds pass. The app's Android instrumentation APK also builds; the revised Open With test asserts that temporary file grants produce original-file selection and no content copies. Android device execution and third-party providers are not claimed by this run.

On the dedicated **Wovenleaf Original Files** iPhone 17 Pro simulator (iOS 26.5), generated fixtures were placed in the Files local provider outside Wovenleaf's container. The real native picker imported EPUB and PDF originals. Readium rendered the EPUB and persisted a bookmark; PDFKit turned pages. Removing the PDF produced recovery, and selecting identical bytes under another filename resumed on page 2 with the same asset identity. A real AAC M4B loaded from its original, played to completion in the background, replayed, and sought/paused at 51%. Two original MP3 files were selected together, imported as a linked bundle, and played across their boundary to the second segment’s end. Removing the M4B and selecting its identical replacement restored 51% with unchanged queue/segment/capability identities. Native reference access survived app relaunch and application-container relocation during reinstall. After a full simulator reboot, the final build reopened the original EPUB with its existing bookmark. SQLite and private storage inspection confirmed linked records and no full EPUB/PDF/audio content files; only the generated PDF cover was stored privately.

Files shared a 10.8 MB generated PDF through the iOS extension. Its payload contained an original reference; returning to Wovenleaf consumed that handoff and opened PDFKit. A content-hash audit of the complete app data container found no copies of any test original, and the shared `IncomingShares` directory contained no book/audio files.

The simulator exposed and verified a fix for an AVQueuePlayer completion crash: its temporary indefinite time is now guarded before integer conversion, and completed queues can be replayed.

Physical-device calls, Bluetooth, long-running locked playback, cloud/provider-offline behavior, stale bookmarks, and Android provider seekability still require the existing release device matrix. Provider-owned downloads and caches are outside Wovenleaf's storage ownership.
