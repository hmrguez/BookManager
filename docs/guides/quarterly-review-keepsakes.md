# Quarterly review keepsakes

[Persist stable quarterly keepsakes and interrupted viewing progress](https://linear.app/hrcoding/issue/QUI-111/persist-stable-quarterly-keepsakes-and-interrupted-viewing-progress)
adds the persistence boundary consumed by the forthcoming review UI.

`StorageRuntime.reviewKeepsakes` exposes `ReviewKeepsakeRepository`. The runtime initializes the
saved timezone once, using the device timezone. Its evidence reader checks local voice-file
existence; paths and voice/note/passage content never enter keepsakes.

## First opening and stability

Call `open({ year, quarter }, artworkManifest, optionalCoverage)` before displaying any playback.
It returns only after one transaction has read the evidence, calculated achievements, validated the
structured result and committed the quarter assignment and keepsake. Failure rolls everything back.
The artwork manifest must identify the bundled versions, independent finished stills and optional
animations; this module supplies no production artwork or implicit approval of prototype assets.

The identity is `review:YYYY-QN`, independent of timezone/device. Migration 20 adds four tables:
`review_settings`, `review_quarters`, `review_keepsakes`, and `review_invitation_suppressions`.
A primary key enforces one current keepsake, with a foreign key to its retained quarter assignment.
Evidence references are historical explanations, not live foreign keys whose deletion would erase
what the reader saw.

The versioned, validated payload includes all earned badges, featured/reveal order, tiers, values,
units and caption keys, supporting labels, genre evidence/suggestion, original rule/selection/artwork
versions, and personal-best comparison values, coverage and references. Reopening never consults
current book labels, evidence or badge selection. Identity edits, progress and replay never feed the
reading ledger or classify books. The evidence calculator remains authoritative for fresh facts.

The schema validates on read and write. Unsupported or malformed payloads fail without overwriting
or silently regenerating them. New semantic versions need an explicit migration preserving facts,
identity, completion and stable step IDs. A presentation change must not rerun selection. Existing
storage migrations remain immutable and use the shared transactional migration runner.

## Timezone and entry

`changeTimezone(zone)` records a change effective from the next quarter. A second change before that
boundary replaces the pending choice. The ordered history preserves assignments for historical
quarters that have not been opened. Travel does not change settings. Saved quarter boundaries are
read as stored, rather than recomputed on replay through the current timezone database.

`invitation()` returns only the latest completed quarter, or null when it is already saved or
suppressed. `dismissInvitation()` retains suppression independently of saved content. Earlier
quarters require qualifying evidence for initial generation; the latest completed quarter may be
an empty reflection. `list()` supplies saved archive entries. Discovery of eligible unsaved
historical quarters belongs to the review-flow consumer.

`delete()` atomically removes just the keepsake and records suppression, retaining the quarter
assignment and all reading history. Manual recreation remains possible, including an originally
empty review after that quarter becomes historical. It does not restore invitations.

## Viewing contract

- `open()` returns a saved step with `paused: true` and `contentVisible: true`. Completed reviews
  return their collection. The UI decides whether a brand-new deliberate opening starts playback.
- Call `saveProgress()` on step entry **before** starting motion. Stable IDs identify badge,
  reflection, pathway and collection steps. Frames and animation clocks are not durable progress.
- `restart()` starts the same saved sequence paused. It retains identity and completion; an ordinary
  reopen of a completed review still shows its collection.
- `setIdentity()` chooses, skips or removes the identity without changing facts. `complete()`
  requires a choice or explicit skip/removal and retains the first completion timestamp.
- `pathwayPresentation()` resolves the saved version. If the animation is unavailable or fails
  preparation/decoding, the consumer marks it unavailable and uses the independent finished still.
  Facts and navigation remain available even if both assets are missing.

All mutations reread the latest row inside their transaction so a progress save cannot overwrite a
newer identity choice. The production database adapter serializes transactions and persists web
commits to IndexedDB. The public evidence calculator still owns a read transaction; the keepsake
repository uses its explicit in-transaction calculation method to avoid nesting transactions.

## Verification and follow-ups

Real SQLite tests cover first-write rollback/retry, immutable facts after corrections and missing
evidence, interrupted reopening, completion/replay/identity, deletion suppression/recreation,
invalid steps and future versions, disk restart, migration rollback/replay, saved timezone and
calendar boundaries, personal-best comparison stability, empty/historical reviews, and the
presentation fallback contract. No native UI or actual animation decoding is exercised here.

[Build the complete offline review flow and accessible playback](https://linear.app/hrcoding/issue/QUI-112/build-the-complete-offline-review-flow-and-accessible-playback)
consumes these APIs and owns native lifecycle/control/accessibility behavior.
[Integrate explicit review updates with backup and private erasure](https://linear.app/hrcoding/issue/QUI-114/integrate-explicit-review-updates-with-backup-and-private-erasure)
must include all four tables' semantics in the existing portable archive/staged recovery contract,
validate cross-record assignments on restore, add update previews and dependency-aware erasure.
Portable backups do **not yet include** these records; the repository is not exposed in product UI
before that release integration. SQLite restart tests are not portable-backup verification.
Final artwork, real missing/corrupt-asset handling, human checkpoints and integrated release
verification remain owned by the implementation map's dedicated children.
