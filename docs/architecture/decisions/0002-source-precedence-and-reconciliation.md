# ADR 0002: Source precedence and reversible reconciliation

- **Status:** Accepted
- **Date:** 2026-08-25
- **Issue:** QUI-20
- **Depends on:** ADR 0001 canonical catalog boundaries
- **Scope:** Resolution and operation contract; persistence tables remain owned by QUI-17

## Context

Wovenleaf will receive overlapping claims from local edits, its EPUB and audiobook readers,
embedded files, metadata providers, migration exports, Libby surfaces, and service adapters. These
sources do not have one useful global ranking. A file can be authoritative for its Edition title
and wrong for Work identity; Libby can authoritatively report a loan return without knowing
whether the book was finished; a first-party reader knows its native location without deciding
which format the reader wants to continue.

Last-write-wins would turn clock order into trust, erase corrections, and make adapter removal
destructive. This decision defines how candidates are classified, selected, reviewed, journaled,
and undone while retaining their evidence.

The executable contract lives in
[`apps/mobile/src/domain/catalog/conflicts.ts`](../../../apps/mobile/src/domain/catalog/conflicts.ts)
and [`reconciliation.ts`](../../../apps/mobile/src/domain/catalog/reconciliation.ts). The six
review fixtures and interactive copy live in
[`prototypeFixtures.ts`](../../../apps/mobile/src/conflicts/prototypeFixtures.ts).

## Decision

Resolve one subject and field at a time. Source precedence is a capability policy, not a global
source score. Every candidate retains its value, source, evidence class, observation/effective
times, confidence, and explanation.

### Evidence classes

| Class | Meaning | May do |
| --- | --- | --- |
| **Authoritative** | The source directly owns or emitted this fact inside a declared scope | Auto-select only where an explicit field rule permits it |
| **Observed** | The source directly showed or reported the value but does not own canonical state | Support a choice, agree with peers, or enter review |
| **Inferred** | Wovenleaf derived the value from indirect evidence | Suggest; never silently delete or assert completion |
| **User-corrected** | The reader explicitly chose or entered the exact value | Become a durable exact-field override |

“Authoritative” is always followed mentally by “for what?”. The Wovenleaf EPUB reader is
authoritative for the EPUB locator it emitted. It is not authoritative for audiobook progress,
Work title, loan state, or whether reaching an end boundary means the reader considers the book
finished.

Confidence describes the quality of one source observation. It does not promote a source above a
different source policy. `observedAt` and `effectiveAt` order evidence inside ledgers and explain
when something happened; neither is a cross-source trust score.

### Resolution algorithm

For one subject and field:

1. Keep every valid candidate. Quarantine malformed input; do not convert it into a candidate.
2. Apply an active durable choice only when its subject and field match exactly.
3. If all candidates have the same JSON value, materialize that value as agreement while keeping
   each source as supporting evidence.
4. Otherwise look up the domain + exact field (or domain wildcard) + source + evidence rule.
5. Auto-select only when one value has a strictly stronger rule and that rule explicitly permits
   automatic selection.
6. If the strongest values tie, the best rule is review-only, or no rule exists, create a conflict
   inbox item with an optional recommendation and its rationale.
7. Store the decision; never edit or delete the losing observations.

The evaluator deliberately never reads timestamps when ranking candidates. A Libby Web capture
at 81% tomorrow cannot replace a direct Wovenleaf EPUB locator at 64% today merely because it is
newer. Conversely, two events emitted by one reader are ordered by that reader’s event-ledger
rules from QUI-16, not by this cross-source resolver.

### Field-level rules

| Domain / field | Strong evidence | Review and safety rule |
| --- | --- | --- |
| Work identity (`edition.workId`, duplicate match) | Exact Edition identifiers, edition structure, explicit reader assignment | Title/author similarity only proposes. Merging Works always waits for review unless the reader already made the exact durable assignment. |
| Work metadata (title, subtitle, description, original language) | Exact user correction; multiple independent agreeing observations | Metadata providers are peers by default. File metadata is not automatically promoted from Edition to Work. |
| Edition metadata (title, language, publisher/date, pages/duration, cover) | Exact user correction; metadata embedded in the selected publication for fields it actually declares | Provider disagreement waits for review unless a scoped Edition rule is strictly stronger. Missing fields never clear existing values. |
| Contributors and identifiers | Exact normalized identifier on its Edition; explicitly credited person/role on the correct target | ISBN never identifies a Work. Ambiguous names, translator/narrator scope, or conflicting owners wait for identity review. |
| List placement | Current local action; membership managed by an attached source checkpoint | A repeat import changes only source-managed membership. Absence cannot remove local placement, order, or notes. Detaching makes the list fully local. |
| Progress | Native first-party locator for its Edition/Asset; explicit local correction | Cross-format positions stay separate. Service and Libby observations reconcile; lower-confidence or merely newer positions do not overwrite. |
| Finish state | Explicit finish/DNF/correction event; reviewed historical finish evidence | End-of-file, loan return, 100%, or a migration status can propose but cannot silently assert finish. Rereads remain separate periods. |
| Deletion | Explicit local deletion inside the selected scope | Remote missing, disconnect, or omitted export row is not deletion. Source tombstones affect only source-managed data and enter review when local descendants changed. |

The numeric priorities and automatic/review flags are executable in `DEFAULT_PRECEDENCE_RULES`.
They are implementation detail for the decisions above, not a public “trust percentage.” Adding a
new adapter is incomplete until it has at least one rule, fixture, and example in this ADR.

### Durable choices

A reader can apply a resolution once or remember it. A remembered choice stores:

- stable choice ID;
- exact subject and field;
- chosen value and optional candidate ID;
- decision time and optional note.

The choice wins future resolutions for that exact subject/field until replaced or undone. It does
not freeze the entity. For example, choosing Open Library’s `work.title` does not block an EPUB
from supplying `edition.publisher`, a provider from adding a missing description, or another
source from supporting an ISBN. Explicit `null` remains a valid field deletion where the field
contract permits it; it does not delete the entity.

### Initial adapter and first-party reader examples

This matrix covers every source in the initial contract. Each row illustrates scope rather than a
global rank.

| Source | Evidence in this example | Example decision |
| --- | --- | --- |
| Local manual capture | User-corrected | A corrected title becomes a durable `work.title` override; later publisher and identifier candidates remain useful. |
| Legacy `bookmanager.library.v1` migration | Observed | Seeds title/progress when alone, but never merges by title or outranks direct publication evidence. |
| ISBN scan | Observed | Strongly proposes an Edition match; two possible Works still enter identity review. |
| EPUB/M4B embedded file metadata | Authoritative for declared Edition fields | An EPUB publisher can beat generic provider metadata for that Edition; it cannot rename the Work silently. |
| Wovenleaf EPUB reader | Authoritative for its native locator | Its older CFI/page event beats a newer low-confidence Libby observation; reaching the end only proposes finish. |
| Wovenleaf audiobook player | Authoritative for its audio timestamp | Owns the local Asset position; cross-format Continue choice versus EPUB remains reviewable. |
| Google Books | Observed | Supplies missing metadata; a title disagreement with Open Library waits for review even when Google is newer. |
| Open Library | Observed | Can support the same ISBN and add useful fields without duplicating the Edition; peer disagreement waits for review. |
| Libby timeline spreadsheet | Authoritative for exported circulation facts; inferred for reading state | A return closes the Loan but never marks the Work finished. |
| Libby tag spreadsheet | Observed, checkpoint-managed membership | Updates only mapped membership; a later absent row cannot delete a local list entry or Work. |
| Libby Web capture | Observed | A visible percentage is lower-trust progress and never replaces newer or older first-party progress silently. |
| Approved OverDrive API | Observed source-local identity and circulation facts | Provider IDs support a match but never become canonical Work IDs; unavailable live state does not erase local data. |
| Audiobookshelf | Observed service progress and library state | Pull progress waits when offline local playback may be ahead; push/pull scopes stay separate to prevent loops. |
| OPDS | Observed catalog/acquisition metadata | Imported bytes pass normal fingerprint and Edition matching; a changed catalog entry is reviewable, not a silent new Edition. |
| Calibre catalog | Observed, often user-maintained | Edition metadata can be useful and higher-context than a generic provider, but custom values remain source claims. |
| Readwise | Observed annotation state/tombstone | A deleted highlight is auto-scoped only when unchanged locally; a later local note turns deletion into review. |
| Goodreads CSV | Observed migration snapshot | Shelves, dates, and status create source-managed proposals; rereads become reading periods and local later edits survive repeat import. |
| StoryGraph CSV | Observed migration snapshot | A finish date is preserved as evidence; disagreement with Goodreads or the local ledger waits for review. |
| KOReader sidecar/stat export | Observed with parser/version confidence | Progress may be strong but remains reviewable against a first-party locator; unsupported versions emit no guess. |
| Calibre reading statistics | Inferred unless a fixture proves direct semantics | Suggests sessions/progress at lower trust and is always imported read-only. |
| Hardcover optional API | Observed | A removable proof adapter may add metadata; write capabilities remain off until conflict/deletion semantics are proven. |
| BookWyrm optional API | Observed and instance-local | Instance metadata may fill gaps but cannot silently replace canonical fields or turn Wovenleaf into a social-state mirror. |

## Conflict inbox contract

The inbox has six initial categories: Work identity, metadata, list placement, progress, finish
state, and deletion. Each item shows:

- the exact subject and field at risk;
- every candidate’s human source name, evidence class, value, observation time, confidence, and
  plain-language explanation;
- what the decision changes and, just as importantly, what it does not change;
- a recommendation when policy can explain one without auto-selecting it;
- apply-once versus durable exact-field choice;
- resolution history and undo.

The development-only interactive prototype is available at `/__conflicts`:

```bash
make conflicts
```

The implementation is
[`ConflictInboxPrototype.tsx`](../../../apps/mobile/src/conflicts/ConflictInboxPrototype.tsx).
It uses a semantic queue, labelled detail region, `fieldset`/radio choices, a native checkbox,
real buttons, visible focus, a logical DOM/focus order, status announcements, text labels in
addition to color, and layouts that reflow for narrow screens and large text. All decisions are
possible with Tab, Shift+Tab, Space, Enter, and radio arrow keys. The Playwright contract exercises
selection, apply, live feedback, and undo using keyboard controls and accessible names.

## Merge, split, Edition reassignment, and undo

Identity changes are immutable journal operations applied transactionally with their Edition
updates:

| Operation | Required before-state | Forward effect | Undo |
| --- | --- | --- | --- |
| Merge Works | Absorbed and surviving Work IDs plus **every** Edition currently on the absorbed Work | Reparent complete Editions to the survivor; retain the absorbed Work as recoverable identity history | Restore each recorded Edition to the absorbed Work |
| Split Work | Existing Work, new Work, and explicit Edition subset | Move only those stable Edition IDs to the new Work | Restore those Editions to the source Work |
| Reassign Edition | One Edition and its exact before/after Work IDs | Change only `Edition.workId` | Restore its previous Work |

Asset, Identifier, Contributor, cover, progress, ownership, loan, access, and SourceRecord rows keep
their Edition foreign key and do not move independently. No operation coalesces Editions or deletes
source evidence. Persistence must retain both Works until history/retention policy can prove the
operation is no longer undoable.

Undo uses compare-and-swap semantics. It proceeds only when every affected Edition still has the
operation’s expected after-Work. If a later reassignment touched one of those Editions, undo stops
for review instead of overwriting later work. Unrelated later changes on other fields or Editions
remain untouched.

Import-batch undo from QUI-19 stores these identity operation IDs in its change set. Undo reverses
only changes still owned by that batch; later unrelated edits are not rolled back.

## Deletion and disconnect rules

Deletion is a proposal with scope, never the interpretation of absence:

- **Disable adapter:** stop future runs; keep credentials/checkpoint and all canonical data.
- **Disconnect adapter:** revoke/remove its credential reference; retain imported data and source
  evidence unless the reader separately requests scoped removal.
- **Delete source data:** preview candidate records and descendants owned exclusively by that
  source; protect anything with local edits or other supporting sources.
- **Remote tombstone:** remove automatically only inside explicit source-managed scope with no
  later local dependency; otherwise create a deletion conflict.
- **Missing from page/export/outage:** mark the observation stale or incomplete. Never infer a
  tombstone.

## Fixtures and verification

- `PROTOTYPE_CONFLICTS` contains one parsed item for every inbox category.
- Domain tests prove a newer low-trust value loses to the scoped first-party rule, every source has
  a precedence example, durable choices are exact-field only, all prototype items require review,
  and merge/split/reassignment round-trip without changing Edition IDs.
- Undo tests prove a later reassignment blocks destructive rollback.
- Browser tests prove the prototype exposes named queue/detail/choice controls and keyboard apply
  and undo behavior.

## Rejected alternatives

### Last write wins

Rejected because timestamps express ordering, not authority, and offline clocks/source latency make
cross-source order unreliable.

### One global source ranking

Rejected because authority is field- and scope-specific. A circulation service can know a due date
better than a metadata provider while knowing less about local progress.

### Copy the chosen value and discard candidates

Rejected because it destroys explanation, adapter removal safety, future re-resolution, and audit.

### Make a user correction own the whole entity

Rejected because correcting one title must not block useful identifiers, descriptions, covers,
contributors, or Edition metadata.

### Implement merge by deleting the duplicate Work or coalescing Editions

Rejected because undo could not restore exact identity boundaries and Edition children could be
misassigned or erased.

## Consequences and follow-ups

- QUI-17 must persist candidates, durable choices, review items, and identity operation journals
  transactionally without flattening evidence into canonical rows.
- QUI-19 imports must emit shared candidates/operations rather than writing canonical tables.
- QUI-16 owns same-source reading event ordering, correction, clock-skew, and supersession; this ADR
  owns cross-source field choice.
- QUI-32 and QUI-50–QUI-67 must add adapter-specific rules/fixtures before enabling writes or
  deletion propagation.
- Product surfaces may auto-resolve safe cases, but must retain an explanation path and expose
  reviewed history where a durable choice exists.
