# Quarterly review keepsakes

[Persist stable quarterly keepsakes and interrupted viewing progress](https://linear.app/hrcoding/issue/QUI-111/persist-stable-quarterly-keepsakes-and-interrupted-viewing-progress)
adds the persistence boundary consumed by the quarterly review UI.

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
adds the integration below. Final native accessibility and integrated release checks remain with
QUI-116; social snapshot production belongs to QUI-115.

## Explicit updates

`previewUpdate({ year, quarter })` recalculates from one consistent evidence transaction. It returns
null when only calculation time or evidence bookkeeping changed. Titles, page counts, genre
suggestions, earned tiers, selection, rule versions and personal-best comparisons can produce an
update. Comparison values come from corrected ledger evidence, never another saved keepsake.
The saved coverage certificates constrain comparison eligibility; they do not create coverage.

The returned token owns a private in-memory copy of the candidate. `applyUpdate(period, token)`
rechecks both the saved facts and a fresh calculation inside the replacement transaction. A stale
candidate returns a refreshed preview and requires another Apply. Caller mutation cannot change
what gets installed. Identity/completion are reread at commit; unfinished reviews restart paused,
completed reviews land on their collection. Artwork versions remain saved. Cancellation and write
failure preserve the old row. No candidate survives process restart; reopen the preview instead.

The archive quietly labels affected keepsakes. Inside a review, Update review presents saved and
proposed achievements, values, tiers, comparison context, highlight order, suggestion and supporting
book details. Checking for updates never blocks viewing the saved content or changes its facts.

## Portable backup and recovery

Portable schema **10** adds the checksummed `data/reviews.json` entry, version 1. Full archives carry
keepsakes, viewing progress, identity, quarter assignments, timezone settings and suppression.
Creation reads the library and review data in one transaction. Restore validates entry membership,
checksums, payload versions, unique identities and quarter/keepsake consistency before replacing
both in the existing transaction. Historical evidence references may be absent after corrections;
they are not foreign keys to mutable live evidence. Post-swap recovery verifies review content too.

Schemas 1–9 initialize empty review data. Annotations-excluded archives contain an empty review
entry and disclose the omission in both export UI and manifest. A redacted archive with nonempty
review data is rejected. Unsupported or malformed payloads never replace current content.

## Deliberate private erasure

Settings → Advanced → Private reading history offers an explicit preview. This is distinct from
ordinary library removal, download cleanup, disconnect and review-only deletion. The preview lists
affected library books and keepsake quarters, including dependencies in personal-best comparisons.
The selected work's editions and dependent activity/annotations are removed together; coupled
records are included in the preview. Database changes and a durable cleanup marker commit atomically.
A stale preview must be regenerated. Review-only deletion retains history and suppresses invitations.
Whole-library erasure also clears review settings and progress.

Erasure clears import undo/staging history and caches, local Libby state, and Up Next; these side
effects are disclosed before confirmation. Downloaded/original book files remain separate. Native
reader/playback journals for the erased scope and voice-note files are cleaned up; the native Libby
inbox is disabled. Credentials for unrelated services are not queried or changed.

All app-managed recovery points (including partial/orphan native files), pre-migration copies and
legacy browser-library copies are removed, then a clean recovery point is created. Cleanup failures
retain the durable marker and expose Retry private cleanup after restart. Restoring either through
the recovery coordinator or directly through the portable service is blocked while cleanup is
pending; launch recovery cannot resurrect erased data. Snapshot/restore/erasure operations share an
exclusive coordinator guard. The marker is cleared in a persisted transaction only after cleanup
and clean-point creation succeed.

Previously exported backups and shared images remain outside app control; the preview explains
that restoring an external backup can bring erased data back. This is application-level deletion,
not a claim of forensic erasure from device flash or external backups.

Acceptance traceability and verification limits: QUI-114 verification (internal evidence omitted from the public source).
