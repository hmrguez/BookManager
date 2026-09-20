# Read original EPUB, PDF, and audiobook files

Status: implemented on 2026-09-20. This document preserves the original assessment and estimate; see [the implementation and validation guide](../guides/original-files.md) for shipped behavior and verification limits.

Assessed on 2026-09-18 against commit `52c7032` and the current source tree. Scope: the native iOS and Android apps.

## Size and recommendation

This is a medium-to-large change across file selection, storage, and native access, but it should not require replacing any reader engine. EPUB and PDF share much of their import/opening pipeline. Audiobooks add per-track references and background playback recovery.

Budget **15–24 engineering days, approximately 3–5 weeks for one engineer**, including native device verification. This is an estimate from code inspection, not a measured implementation schedule. Expect roughly **25–40 production files plus tests and documentation**, depending on how the shared native file-access layer is organized. A **1–2 day feasibility spike is included** and should refine the estimate before implementation expands.

Recommended behavior: new native selections link to the original file. Opening resolves its saved reference, checks that it is accessible, and opens it directly. Failure shows a specific error without losing the library entry or reading progress. Keep support for existing managed copies during migration.

The implementation should store a persistent file reference rather than assume every selection has a usable absolute path. Android generally supplies a document URI and permission grant; iOS supplies a security-scoped URL that must be preserved through a bookmark. These are implementation details behind the same simple product behavior. See [Android document access](https://developer.android.com/training/data-storage/shared/documents-files) and [Apple document picker](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller).

## Current implementation and affected boundaries

Paths in this table are relative to `apps/mobile/`.

| Area | Current behavior | Required change |
| --- | --- | --- |
| `src/domain/catalog/editions.ts` | Already defines `linked-file` with `bookmarkId`, fingerprint, and last-known name, alongside managed files/bundles and missing assets. | Implement the reference behind that ID; add a linked audiobook bundle representation. |
| `src/epub/incoming.ts`, `src/audiobooks/incoming.ts` | Produce filename and complete byte buffers; discard the durable source reference. | Carry a registered original-file reference through inspection and commit. |
| `src/settings/SettingsPage.tsx`, `src/work-detail/WorkDetailExperience.tsx`, `src/App.tsx` | Native imports use HTML file inputs and shared-file callbacks. | Route native book/audio selection through a native document picker and preserve multi-file/folder behavior. |
| `src/epub/service.ts`, `src/epub/repository.ts` | EPUB and PDF are inspected, copied into managed storage, and cataloged as managed files. Duplicate restoration writes a managed copy too. | Commit linked content and repair references on exact-match reselection; retain metadata inspection and deduplication. |
| `src/reader/service.ts`, `src/reader/repository.ts`, `src/reader/model.ts`, `src/reader/bridge.ts` | Only managed-file capabilities open. Service already checks existence before resolving a private file URI. | Resolve both managed and linked sources through one access boundary with typed failures. |
| Native `WovenleafReaderPlugin` implementations; Android reader/PDF activities | Explicitly restrict files to private app storage. Android EPUB constructs a `File`; PDF opens a private-file descriptor. | Resolve registered external capabilities and keep access alive for the reader session. |
| `src/pdf/cover.ts` and native PDF cover methods | Generate covers from a managed-file location. | Render the first page from the original source; store only the generated cover. |
| `src/audiobooks/service.ts`, `src/audiobooks/repository.ts`, `src/storage/migrations.ts` | Copy each segment into a managed bundle; `audiobook_files.relative_path` is required. | Store a managed or linked location per segment; preserve stable capability IDs, ordering, and manifests. |
| `src/playback/repository.ts`, `src/playback/model.ts`, native playback implementations | Resolve private paths; native queue validation checks private roots, size, and SHA-256. Recovery persists source URLs. | Resolve original references during load, playback, and native recovery; preserve integrity checks. |
| Android `@capgo/capacitor-share-target`, iOS `ShareExtension/ShareViewController.swift` | Android copies shared files to cache; iOS explicitly copies file representations into `IncomingShares`. | Intercept original references before these copies, or route temporary-only handoffs to original-file selection. |
| `src/epub/lifecycle.ts`, storage settings, backup/export/recovery | Inventory, relinking, cleanup, and included ebook bytes assume managed storage. Portable export already converts linked files to missing references. | Make ownership explicit; update relinking, disk accounting, backup inclusion, and restore behavior. |

Reading positions, annotations, the reading ledger, EPUB rendering, PDF rendering, and audio transport remain based on their existing models. Changes should concentrate at the file-access boundaries.

## Product scope and constraints

- **No additional full content copy owned by Wovenleaf** for supported original-file selections. Covers, metadata, notes, checkpoints, and engine-derived caches may still use private storage. Provider-managed downloads/caches are outside Wovenleaf's control; this is not a promise of zero temporary storage anywhere in the OS.
- **Check on every open**, and handle failure during the actual read too. An existence check alone cannot prove permission, offline availability, or successful opening, and a source can disappear after the check.
- **No automatic search for moved files.** Resolve the OS reference, which may itself survive some moves; if resolution fails, show the error and offer selection of the file again.
- **Never delete or overwrite the original** when removing a book, cleaning app storage, canceling import, or unlinking a reference.
- **Retain existing format/DRM checks and size limits.** Removing disk copies does not automatically remove inspection memory costs: audiobook intake still assembles a complete `Uint8Array`, even though bridge reads are chunked. A streaming metadata-parser rewrite is separate work.
- **Native mobile first.** Existing browser import/development support stays as it is. A browser File object does not provide the durable native reference this design needs; browser File System Access support would be a separate scope. See [MDN file input documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file).

The strict no-copy path cannot support every share or document provider transparently. Android PDF rendering requires a seekable descriptor; if a provider only exposes a pipe, reject it with guidance to select a local/downloaded file. Verify EPUB random-access requirements during the spike too. See [PdfRenderer](https://developer.android.com/reference/android/graphics/pdf/PdfRenderer).

iOS in-place sharing can still return a temporary copy. Treat that as a temporary handoff, never as the permanent original reference. For a sender that cannot grant lasting original access, ask the user to select the original through Files; do not silently copy it into Wovenleaf. This limitation comes from the [NSItemProvider in-place API](https://developer.apple.com/documentation/foundation/nsitemprovider/loadinplacefilerepresentation%28fortypeidentifier%3Acompletionhandler%3A%29).

## Proposed access model

Use the existing `linked-file.bookmarkId` as an opaque device-local reference ID. A native reference registry stores the platform locator and access information behind it. The native registry must work without a running WebView so audiobook background recovery can use it.

| Record | Responsibility |
| --- | --- |
| Catalog asset | Stable asset/edition identity, fingerprint, display name, and managed versus linked ownership. |
| Device-local reference registry | Android URI/grant or iOS bookmark, platform, last-known size/name, and available provider revision information. No original bytes. |
| `audiobook_files` location | A discriminated managed path or linked reference ID per segment, with existing capability ID, order, hash, media type, and size. |
| Audiobook content asset | Managed or linked bundle identity; segment references remain associated with the existing import/manifest. Do not disguise multiple files as one linked file. |
| Native open session | Resolved URL/descriptor and the lifetime of access. It is released when the reader or playback consumer finishes. |

Introduce a shared TypeScript boundary, for example `src/files/`, with a corresponding native adapter on each platform. Its operations should cover selection/registration, inspection reads, access checks, acquisition/release, and relinking. UI callers pass registered IDs; native code resolves and validates them. Preserve current managed-root checks for legacy managed sources.

On Android, use `ACTION_OPEN_DOCUMENT`, preserve read access with `takePersistableUriPermission`, and read through `ContentResolver`. Multi-track imports can select multiple documents; folder selection can use a persisted tree grant. Release a grant only when no remaining asset uses it. A stored URI alone does not provide persistent access. See [Android document access](https://developer.android.com/training/data-storage/shared/documents-files).

On iOS, select with the document picker's open-in-place mode, save and resolve bookmarks using APIs supported by the deployment target, refresh stale bookmarks, and coordinate external access. Hold security-scoped access for the entire reader or player-item lifetime, including asynchronous reads and background playback; release it on replacement, close, or failure. Include file presentation/change handling appropriate to the reader. See [Apple external directory access](https://developer.apple.com/documentation/uikit/providing-access-to-directories).

Reference registration and SQL commit are separate persistence boundaries. Stage new references, commit their asset mappings transactionally, and reconcile abandoned registrations after cancellation/crash. Do not release a grant or bookmark still used by another asset. Import rollback cleans up Wovenleaf's registrations/derived artifacts only.

## Implementation sequence and estimate

### 1. Prove original-file access on both platforms — 1–2 days

- Open one EPUB, PDF, and M4B/MP3 from a local provider without materializing a full app-owned copy.
- Confirm the pinned Readium integration can read the original Android document source and the scoped iOS URL throughout navigation. Android already constructs `AssetRetriever` with a `ContentResolver`, but the current caller only supplies file URLs; provider support and caching behavior remain unverified.
- Prove Android PDF seekability, native audio seeking, access after process restart, and permission recovery after device restart.
- Measure app-private/cache growth and trace actual native source access; a successful page or song alone does not prove no-copy behavior.
- Exercise one cloud provider and one temporary-only share. Record which cases can link, which require a local download, and which require reselection.

Deliverable: a supported-source matrix and revised estimate. If an engine requires a full local copy, investigate its resource adapter before committing to the broader implementation; an engine adapter/replacement is outside this estimate.

### 2. Add the common reference model and migration — 2–3 days

- Implement the native registry and shared typed access boundary.
- Support existing `linked-file`, add linked bundle representation, and update reader/playback capability schemas and bridge versions where necessary.
- Migrate `audiobook_files` from required `relative_path` to an explicit location representation. Backfill existing rows as managed files without changing asset IDs, segment IDs, hashes, or manifests.
- Add migration/rollback coverage, reference cleanup, and reconciliation with native playback snapshots. Keep locators and grants device-local; do not embed them in portable catalogs or diagnostic output.

Deliverable: both existing managed locations and persistent original references resolve through the same contract.

### 3. Change selection, intake, and import commits — 3–4 days

- Add native pickers and wire the existing settings and book-detail entry points to them. Preserve multi-track order review, folder sidecars, cancellation, and incoming-file feedback.
- Carry source reference IDs alongside inspection input. Reuse current validators and metadata parsers initially; remove content writes from linked import commits.
- Keep derived covers private. Change PDF cover extraction to consume an acquired original source.
- Recheck the reference/content before commit, including after a long audiobook review. Failed or canceled imports must leave no dangling asset associations.
- Change duplicate handling so choosing the exact original repairs a missing/expired link rather than returning early or restoring a private copy. Preserve existing asset and progress identity.
- Bypass/replace the copying share path for book/audio intake. Retain CSV behavior. Accept a shared original only after verifying durable access; otherwise offer the native picker. Test iOS extension-to-host transfer instead of assuming a bookmark from one process works in the other.

Deliverable: newly added supported books and audio reference originals and create no full app-owned content files.

### 4. Adapt EPUB and PDF opening — 2–3 days

- Generalize `capabilityForBook` and the open service to linked sources; distinguish a missing attachment from an attached but inaccessible file.
- Replace private-file assumptions in native reader launch, Android activity arguments, and PDF cover/opening code with registered-source acquisition.
- For Android PDF, open a seekable provider descriptor. For EPUB, use the Readium resource path validated in step 1. On iOS, supply the scoped URL to Readium/PDFKit while retaining access.
- Map failures from both preflight and actual native opening to the same errors. Release descriptors/scopes on close, background lifecycle transitions as appropriate, and failed launch.
- Preserve locators, bookmarks, annotations, preferences, and incoming-file reader dismissal.

Deliverable: both ebook formats open originals and report access failures without changing reading history.

### 5. Adapt audiobook loading and background recovery — 3–5 days

- Resolve every segment's source through the reference layer. Keep the current manifest timeline, chapters, ordering, and capability IDs stable.
- Replace private-root-only content validation in Android's playback service and iOS's playback engine. Cover artwork can remain managed.
- Persist reference IDs in the native playback state and reacquire access during recovery without depending on JavaScript. Migrate or retain compatibility with existing managed-source snapshots.
- Check the full queue before loading, then handle loss of access at playback/seek/track transition. Keep the last confirmed checkpoint and identify the unavailable track.
- Retain access for active and preloaded items; release it when the engine has finished with those items. Test background playback, screen locking, interruption, and process restoration.

Deliverable: single-file and multi-file audio play from originals with the current background behavior.

### 6. Finish recovery, migration UX, and storage semantics — 2–3 days

- Reuse existing error presentation with messages such as: “This file is no longer available. It may have been moved or deleted. Choose it again to continue. Your progress and notes are safe.” Offer **Choose file** and **Cancel**.
- Distinguish missing, permission lost, unavailable offline, changed/corrupt, and unsupported provider errors. Do not claim a file was deleted when its provider is simply unavailable.
- Extend relinking to register the original instead of copying bytes. Exact-fingerprint relinking preserves IDs; a different edition/file follows the existing revision and annotation-reanchoring rules.
- Separate app-owned bytes from externally referenced bytes in inventory. Cleanup and library removal must never unlink/delete user-owned content.
- Preserve existing ebook “include files” backup behavior by reading linked sources explicitly for the requested archive. Report unavailable sources before presenting a complete backup. Ordinary portable catalogs omit references and restore them as needing relink; do not add general audiobook byte backup as part of this change.
- Audit local database recovery versus native reference registry state, including rollback and restore onto another installation. Missing native references become recoverable relink errors.
- Update storage/import copy, reader guides, and architecture decisions. Use the required `frontend-design` skill when implementing UI changes and keep recovery controls minimal.

Deliverable: storage, backups, and user recovery describe and respect external ownership.

### 7. Regression and physical-device verification — 2–4 days

- Extend existing EPUB import/lifecycle/reader, PDF, audiobook import/playback, storage migration, and portable archive tests around the new access boundary.
- Verify every intake route: settings, attach-to-book, multi-file/folder audio, Open With, and share. Include duplicate/relink cases and canceled import review.
- On both platforms, test reopening after app termination and device restart; rename, move, deletion, permission loss, cloud-offline access, removable-storage loss, and replacement with different bytes at the same location.
- Test missing audio segments before playback and during track transition, background recovery, stale iOS bookmarks, nonseekable Android PDFs, and a temporary-only share.
- Verify notes/progress survive failure and relink, mixed managed/linked libraries still work, and cleanup leaves source files unchanged.
- Measure import/open time, peak memory, and private/cache disk growth with a large PDF and a large multi-track audiobook. Exercise the existing `OpenWithTest` instrumentation flow with the revised source behavior.
- From `apps/mobile`, run `bun run lint`, `bun run typecheck`, relevant Bun tests, Android tests/build, and the iOS build plus device flows.

Deliverable: demonstrated no-full-copy behavior and retained reader/playback functionality on supported sources.

## Existing libraries and integrity policy

Existing imports retain names and fingerprints, but the original durable file reference is discarded. Consequently there is **no reliable automatic migration from a private copy back to its original**.

Keep existing managed files readable. Allow the user to choose the original and verify an exact fingerprint before changing the asset's location. Removing the old app-owned copy is a separate cleanup operation after a successful open, with checks for any remaining references. Never delete it first or guess an original location from its filename.

Store a fingerprint when linking. Check readability on every open, then validate identity before using saved positions/annotations. Initially retain native audiobook hashing and use streamed fingerprint verification for linked sources where no trustworthy revision identity exists. Size/mtime alone cannot reliably detect replacement. Avoid claiming an instant open: hashing a large external audiobook is already a potential startup cost, and removing its import copy does not remove that work. Revision-based verification caching can follow measured provider behavior as a separate optimization.

If the original changes, report that it changed and route through explicit replacement/relink handling. Never silently apply an old audio timeline or exact ebook annotations to different bytes. Preserve current archive safety and corruption validation.

## Suggested delivery boundary

Deliver the shared access layer and EPUB/PDF support first, then audiobook playback and recovery on the same foundation. Keep managed compatibility throughout. The complete request is satisfied only when audio and every supported intake route are covered; an ebook-only increment is an intermediate milestone.

Deferred scope: a streaming/native metadata inspection rewrite, automatic folder watching or searching for moved files, browser persistent file handles, broad cloud-provider compatibility beyond the verified matrix, and a redesigned reader UI. These are not needed to achieve direct reading of supported original files with clear missing-file errors.
