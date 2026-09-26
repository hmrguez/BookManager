# ADR 0003: Reading event, session, progress, and provenance ledger

- **Status:** Accepted
- **Date:** 2026-08-25
- **Issue:** QUI-16
- **Depends on:** [ADR 0001: Canonical catalog and access boundaries](0001-canonical-catalog-boundaries.md)
- **Scope:** Durable domain contract and deterministic projection; SQLite persistence follows in QUI-17

## Context

A mutable percentage cannot explain when reading happened, distinguish an EPUB location from an
audiobook timestamp, recover after a bad import, or reconcile events captured offline. Ratings,
notes, sessions, imports, and integrations need the same provenance guarantees as progress.

The executable contract is `apps/mobile/src/domain/catalog/progress.ts`. The adversarial fixture is
`apps/mobile/tests/fixtures/reading-ledger.ts`, and its projection proofs are in
`apps/mobile/tests/reading-ledger.test.ts`.

## Decision

Store an append-only, Edition-scoped `ReadingEvent` ledger. Derive current reading state, sessions,
notes, ratings, and `ProgressSnapshot` records with the pure `deriveReadingState` projector.
Snapshots are disposable read models; events, corrections, and integration checkpoints are the
durable evidence.

```text
IntegrationCheckpoint ───────┐
ReadingDevice ───────────────┼──▶ ReadingEvent[] ──▶ deriveReadingState ──▶ ProgressSnapshot
Edition ───────▶ Asset ──────┘          │                    ├────────────▶ ReadingSession[]
                                       │                    ├────────────▶ Rating
                                       │                    └────────────▶ Note[]
                                       └── correction ──▶ prior ReadingEvent (evidence retained)
```

Reading history is Edition-scoped. A percentage can help compare formats in the UI, but it never
replaces a native EPUB locator, page, audio time, or chapter location.

### Event vocabulary

| Kind | Meaning | Projection effect |
| --- | --- | --- |
| `start` | Begin a first read or a new read after a terminal state | Status becomes `reading`; establishes `startedAt` |
| `resume` | Resume a paused or reconstructed read | Status becomes `reading` |
| `pause` | Stop an active reading interval | Status becomes `paused`; establishes `pausedAt` |
| `location` | Observe a native reading position | Replaces the current projected position by semantic event order |
| `session` | Record one completed interval with optional start/end positions | Adds a session; its end position also advances current position |
| `finish` | Mark this Edition read | Status becomes `finished`; requires a native position and uses 100% when normalized |
| `did-not-finish` | Stop this read without finishing | Status becomes `did-not-finish`; reason and position are optional |
| `rating` | Record a private 1–5 rating | Replaces the current projected rating by semantic event order |
| `note` | Add private reading text | Adds a note; edits/removals use corrections |
| `import` | Audit a set of events created by a migration or integration batch | No user-state effect; links imported event IDs and an optional external batch key |
| `sync` | Audit events exchanged with a peer | No user-state effect; links event IDs, direction, peer, and checkpoint |
| `correction` | Supersede or tombstone prior event evidence | Suppresses target effects and optionally applies a replacement fact |

`import` and `sync` are boundary markers rather than containers. Imported or synchronized facts
remain normal, individually addressable events; the marker identifies the batch that transported
them.

### Provenance envelope

Every event has the following envelope:

| Field | Semantics |
| --- | --- |
| `id` | Stable `reading-event:` ID; never reused |
| `editionId` | The Edition whose reading history changes |
| `assetId` | Optional content Asset; it must belong to the same Edition |
| `source` | `local`, `migration`, `integration`, or `sync`, with method/integration identity and optional SourceRecord evidence |
| `deviceId` | Pseudonymous installation/device ID; human device names are deliberately excluded |
| `integrationCheckpointId` | Required for integration and sync sources; forbidden for local and migration sources |
| `observedAt` | Time reported by the observing source before semantic correction |
| `effectiveAt` | Time the fact belongs on the reading timeline |
| `recordedAt` | Time the event was appended to this ledger |
| `timeConfidence` | Confidence from 0–1 in the event's effective time |
| `estimatedClockOffsetMs` | Optional evidence for the difference between source and corrected time; it never silently rewrites another timestamp |

All three timestamps are retained. The same event can therefore be effective on January 2,
observed by a fast device clock on January 2, and appended after reconnecting on January 7.

### Native locations and normalization

`ReadingPosition` holds a native locator, optional normalized progress, a named normalization
method, and confidence. Supported native forms are:

| Locator | Required native evidence | Normalization |
| --- | --- | --- |
| `page` | Zero-based boundary/page number as reported by the Edition | `page / totalPages` using the captured Edition page-count basis |
| `percent` | Fraction from 0–1 | Same fraction, marked `reported-percent` |
| `epub` | Resource `href`, opaque locator (for example CFI), optional resource progression | Captured EPUB progression when available |
| `audio-time` | Non-negative playback milliseconds | `positionMs / durationMs` using the captured Edition duration basis |
| `chapter` | Stable chapter key, zero-based chapter index, optional in-chapter progression | `(index + progression) / chapterCount` using a captured chapter map |

An integration may supply its own normalized fraction with `integration-reported` and an explicit
confidence. When no defensible fraction exists, normalization is `none`, confidence is zero, and
`normalizedProgress` is absent. The schema rejects incompatible methods, out-of-bounds extents,
and arithmetic mismatches. Capturing the basis on the event keeps historical projections stable
if Edition metadata is later corrected.

Format invariants still apply: EPUB locations require ebook Editions, audio time requires an
audiobook Edition, and pages require print or ebook Editions. Percent and chapter projections are
format-neutral but remain scoped to one Edition.

### Sessions

A `session` event is one completed interval with its own `reading-session:` ID, start/end instants,
active duration, and optional start/end positions. Wall-clock duration and active duration are
separate so pauses, playback speed, and imperfect integrations do not corrupt the record. Session
events do not implicitly pause or resume the lifecycle; the capture surface emits explicit
`resume`/`pause` events when that state is known.

### Deterministic projection

`deriveReadingState` produces the same result for every permutation of a valid event set:

1. Select the Edition and optional `knownAt`/`effectiveAt` boundaries.
2. Resolve the correction graph. An event is inactive when an active correction targets it.
   Corrections may themselves be corrected, which restores or replaces the earlier evidence.
   Cycles and cross-Edition references are invalid.
3. Sort active events by `effectiveAt`, then `observedAt`, then `recordedAt`, then stable event ID.
   Instants are compared as parsed timestamps, so different UTC offsets remain chronological.
4. Fold lifecycle, position, session, rating, and note facts in that order. Import and sync markers
   remain in the applied audit set but do not alter user state.

`effectiveAt` answers “when did this happen?” while `knownAt` answers “what did this ledger know at
that time?” Supplying both supports reproducible historical statistics and sync diagnostics.

#### Late and offline events

Arrival order never wins by itself. An offline location appended on January 7 with an effective
time on January 2 is inserted into the January 2 timeline. It cannot regress a semantically later
January 2 location merely because it arrived last. The old read model is discarded and rebuilt.

#### Clock skew and collisions

Adapters correct a known device offset into `effectiveAt` while preserving `observedAt`, the
estimated offset, and confidence. Unknown or suspicious clock values are kept with lower
confidence; they are not clamped or rewritten. Exact effective-time collisions use observed time,
append time, and event ID as stable tie-breakers. A user can issue a correction when that mechanical
ordering is semantically wrong.

### Corrections, supersession, and tombstones

A correction has one or more target event IDs, a reason, and either:

- `replace`: suppress target effects and apply a typed lifecycle/location/session/rating/note fact
  from the correction envelope; or
- `tombstone`: suppress target effects without a replacement.

The target events remain stored and exported with the active correction. No normal API physically
deletes individual ledger evidence. Correcting a correction is allowed and deterministically
restores or replaces the earlier effect. SQLite foreign keys must therefore use restrictive
deletion for reading events; edition deletion/export workflows handle the ledger as one aggregate.

### Integration checkpoints

An `IntegrationCheckpoint` records integration key, direction, opaque cursor, device, observed
time, commit time, and an optional previous checkpoint. Chains cannot change integration or
direction and cannot cycle. A checkpoint means all referenced events and its audit marker were
committed atomically. Cursors are opaque operational data, never display text or credential
storage; credentials remain outside this contract.

## Privacy and export

Every event is private by default. `readingEventPrivacyPolicy` is an exhaustive map checked against
the event vocabulary at compile time and in tests.

| Event class | Kinds | Full backup | Portable private export | Share-safe export |
| --- | --- | --- | --- | --- |
| Private activity | start, resume, pause, location, session, finish, DNF | Include | Include | Exclude |
| Private opinion | rating | Include | Include | Exclude |
| Private content | note | Include | Include | Redact text |
| Operational provenance | import, correction | Include | Include | Exclude |
| Operational transport | sync | Include | Exclude | Exclude |

Full backup preserves event IDs, sources, pseudonymous device IDs, checkpoint chains, corrections,
tombstones, and note content so restore is lossless. Portable private export preserves the evidence
needed to explain state but omits sync transport markers and opaque checkpoint cursors. A portable
exporter must retain reference closure: if it exports a correction or batch marker, it also exports
the referenced evidence. Share-safe export is opt-in and contains no reading activity by default;
note records may be represented only as redacted placeholders when structural counts are requested.

Source credentials, unrestricted file paths, human device names, and raw integration secrets are
never ledger fields. Whole-Edition erasure removes its events, snapshots, and orphaned checkpoints
as a privacy transaction; it is distinct from an evidentiary tombstone.

## Required invariants

1. Event, session, device, checkpoint, and snapshot IDs use stable type prefixes.
2. Event corrections and import/sync references resolve and never cross Editions.
3. Event and snapshot Assets belong to the same Edition.
4. Integration/sync provenance resolves to a matching checkpoint and optional SourceRecord.
5. Checkpoint and correction graphs are acyclic.
6. Native locator format and extents match the Edition.
7. A `ProgressSnapshot.sourceEventId` resolves to an event for the same Edition.
8. Snapshots never become authoritative; they can be regenerated from the ledger fixture.

## Rejected alternatives

### Persist only the latest percentage

Rejected because it destroys sessions, native resume locations, provenance, and correction history.

### Order by append time

Rejected because reconnecting an offline device would make old progress look newer than later
reading and would make projections depend on network timing.

### Use last-write-wins source timestamps

Rejected because clocks drift and source timestamps do not establish authority. Separate timestamp
evidence plus explicit correction is auditable and deterministic.

### Edit or delete bad imported rows

Rejected because the system could no longer explain why state changed or safely replay sync. A
correction suppresses effects while retaining evidence.

### Store only normalized progress

Rejected because EPUB resume, audiobook playback, printed page display, and chapter navigation need
native locators. Normalized progress is a confidence-bearing projection.

## Consequences and follow-ups

- QUI-17 must persist events and checkpoints transactionally and index Edition plus all three
  timestamps; snapshots may be rebuilt or cached.
- [QUI-18 / ADR 0006](0006-lossless-legacy-library-migration.md) emits explicit migration-sourced
  lifecycle, location, rating, note, and import-marker events.
- Import and adapter work must commit fact events and their checkpoint/marker atomically.
- Statistics must expose uncertainty instead of treating low-confidence normalized positions or
  timestamps as exact.
- Reread rituals may add a higher-level read-cycle projection without changing this ledger.

## Manual lifecycle capture (2026-09-26)

Explicit app finish, unfinish, date confirmation/correction, reread, and shelf undo now append
manual-source events in the same transaction as the library and progress projections. Commands
have stable retry IDs. Undo checks the latest reading revision and expected progress before
restoring the previous lifecycle fields; unrelated metadata edits survive. Ordinary metadata,
page/progress updates, imported timestamps and loan changes never enter this manual-finish path.

A book retains its canonical `readingEditionId` in the compatibility projection. Capture reuses
native/import associations, migration identity or an unambiguous exact edition ISBN before creating
a local identity. It never merges Works by title. Optional links survive private backup/restore;
archives validate their edition references. Existing snapshot metadata used to establish a local
identity remains migration evidence, not a new exact-field user correction.

“Read again” appends a new start while retaining earlier completions. Moving out of Finished
retracts the current completion. Date corrections replace the effective finish without discarding
its original evidence; successive replacements suppress the full correction ancestry. Undoing a
replacement restores its predecessor. A manual correction remains attached to the original
completion for current lifecycle status even if its corrected date precedes an automatically
captured start. In that case the current projection omits the incompatible start date; it does not
invent a replacement. Effective-date evidence queries still use the corrected date. Later genuine
starts continue to open a new read. This refines correction projection without changing event
storage, provenance, or quarterly eligibility.

A reported finish retains the last native locator when available, without claiming it was the
reader's end position. Historical uncertain/imported finishes retain their original confidence
until the reader explicitly confirms a date. Missing legacy periods are never reconstructed.

Verification: `manual-reading.test.ts` covers corrections, rereads, retries, atomic rollback,
shared Work identity across editions, native locators, imported uncertainty, backup/restore and
stale undo. `manual-reading.spec.ts` exercises the app controls and persisted projections; the
existing DNF browser suite protects its resume/undo behavior. Broader ritual design remains with
[Design finish, DNF, reread, and edition-switch rituals](https://linear.app/hrcoding/issue/QUI-74/design-finish-dnf-reread-and-edition-switch-rituals).

## Foreground EPUB capture (2026-09-26)

New native EPUB sessions carry optional `activeCapture` evidence with kind `epub-foreground`,
version 1, a reader-instance `captureId`, interval index, and start/end boundary reasons. Each
session is a completed, continuous foreground slice with exact start/end timestamps and duration.
The hosts checkpoint every ten seconds and flush on loss of foreground activity, disappearance,
and close. Android also pauses on loss of window focus. Duplicate pause/resume/close callbacks
cannot reopen or recount an interval. Readium/toolkit version remains separate from capture version.

The capture clock measures duration monotonically and anchors timestamps to the wall clock. A
wall/monotonic discrepancy over 250 ms or a callback gap over 30 seconds discards that slice and
marks the next slice as discontinuous. The uncertain gap is never distributed across quarters.
A process kill retains completed outbox slices only; it never reconstructs the unfinished tail
from the next launch time. Normal checkpoint cadence limits that tail to roughly ten seconds;
stalls can lose more, deliberately. This measures foreground reader time, not proof of attention.

The existing durable outbox and acknowledgement path feeds these slices into session events.
Late reliable slices are retained even after a newer location or asset replacement; they cannot
regress the current checkpoint or snapshot. Event IDs make retries idempotent, including a crash
between ledger append and checkpoint persistence. Session projection and private archives retain
capture evidence. Portable schema 9 prevents older readers from silently discarding this evidence;
older archives remain readable without upgrading their historical sessions' reliability.

Quarterly consumers must require supported capture evidence before using EPUB duration. Absence
of `activeCapture` is historical/unknown quality, never implicit version 1. The interval endpoints
support exact calendar-boundary splitting and overlap detection. A checkpoint continues a slice;
a pause/resume gap contributes no time. A discontinuity, missing interval index, or an unfinished
capture followed by a new instance cannot prove visit continuity. Apply the approved same-work,
same-activity interruption threshold of **at most five minutes** only when the complete intervening
activity evidence supports it; work switches and longer breaks end the visit. Work-level visits,
overlap reconciliation, quarterly totals and badge selection belong to the quarterly calculation
layer, not the native session identity. Native slices are not themselves reading visits.

Verification and reproduction are recorded in [the active EPUB capture guide](../../guides/epub-active-time.md).
