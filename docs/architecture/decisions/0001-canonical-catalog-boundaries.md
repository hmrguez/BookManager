# ADR 0001: Canonical catalog and access boundaries

- **Status:** Accepted
- **Date:** 2026-08-25
- **Issue:** QUI-15
- **Scope:** Domain contract only; no persistence schema is introduced here

## Context

Wovenleaf currently persists a flat `LibraryBook`. That record combines a conceptual work,
a particular publication, a Google Books result, reading state, shelf placement, and user data.
It cannot represent an EPUB, audiobook, print copy, translated publication, and temporary loan
without fields changing meaning according to format or source.

This decision establishes the identity and ownership boundaries that QUI-16 through QUI-87 can
target. The executable contract lives in `apps/mobile/src/domain/catalog/`; representative
fixtures live in `apps/mobile/tests/fixtures/catalog.ts`.

## Decision

Use a Work → Edition → Asset hierarchy, with orthogonal records for identity evidence,
provenance, access, people, and reading state:

```text
Person ── Contributor ──▶ Work ──▶ Edition ──▶ Asset
                            │          ├──────▶ Identifier
                            │          ├──────▶ Ownership ──▶ AccessGrant
                            │          ├──────▶ Loan ───────▶ AccessGrant
                            │          └──────▶ ProgressSnapshot (projection of QUI-16 ledger)
                            └──────▶ WorkPart ──▶ contained Work

SourceRecord ── claims/observations ──▶ Work | Edition | Person | Identifier
UserMetadataOverride ─────────────────▶ the same entity and field
```

Zod schemas are the runtime source of truth. TypeScript types are inferred from those schemas.
Entity schemas are split by boundary; `catalogSchema` composes them and applies cross-record
invariants. Repository and SQLite work must parse data through the aggregate schema at trust
boundaries.

### Entity ownership

| Entity | Owns | Explicitly does not own |
| --- | --- | --- |
| `Work` | Conceptual identity, canonical/original title context, original language, single/anthology/collection kind | Page count, duration, publication language, ISBN, cover bytes, narrator, progress, shelf, loan state |
| `Edition` | One published/released manifestation: medium, displayed title, language, publisher/date, page count for print/ebook, duration for audio, preferred edition cover | Local file paths, provider payloads, ownership, current progress |
| `Asset` | One content/cover/supplement object and its managed, linked, remote, or missing location | Bibliographic identity, legal ownership, reading state |
| `Identifier` | A normalized canonical identifier attached to its actual owner, plus supporting SourceRecord IDs | Provider-local record IDs; ISBN never identifies a Work |
| `SourceRecord` | Immutable source-local key, observation/import timestamps, raw payload, field claims, identifier observations, confidence | Canonical identity or resolved user-facing values |
| `UserMetadataOverride` | An explicit user correction or deletion for one entity field | Destructive edits to source evidence |
| `Ownership` | A user's durable relationship to one Edition and its acquisition/disposal lifecycle | File presence or temporary availability |
| `Loan` | Lender, Edition, checkout/due/return times, renewals, and provenance | Copied access status or ownership |
| `AccessGrant` | Why an Edition is currently accessible: ownership, loan, subscription, or public domain | Duplicated loan dates or asset location |
| `Person` | A human identity and resolved display/sort names | Role or credit order |
| `Contributor` | Person, target (`Work` or `Edition`), role, credited name, and order | Person identity fields |
| `WorkPart` | Ordered containment of Works in an anthology/collection | A string-only table of contents |
| `ProgressSnapshot` | Edition-scoped, optionally Asset-scoped projection for display and resume | Authoritative event history; [ADR 0003](0003-reading-ledger.md) owns that ledger |

### Required invariants

1. Every entity has a stable, type-prefixed ID. Foreign references must resolve, and IDs are
   unique within each entity collection.
2. A Work groups equivalent intellectual content. Each print, ebook, audiobook, translation,
   abridgement, or otherwise materially different publication is a distinct Edition.
3. Edition-specific page count, duration, language, cover, identifiers, and contributors never
   move onto Work.
4. A Work merge reparents complete Edition records. It never coalesces Editions or rewrites
   their child Asset, Identifier, Contributor, or progress records. Merge history, review,
   split, and undo belong to QUI-20.
5. A cover is an image Asset owned by the same Edition that selects it. A Work cover is a
   derived UI preference, not canonical stored metadata.
6. EPUB/PDF content Assets belong to ebook Editions; M4B/MP3 content Assets belong to audiobook
   Editions. Asset presence never proves ownership.
7. ISBNs belong to Editions. Absence of an ISBN is valid. Provider record keys belong to
   SourceRecord and must not be promoted to canonical identifiers.
8. Multiple sources reporting the same normalized identifier support one canonical Identifier;
   they do not create duplicate Editions by themselves. Conflicting matches enter the QUI-20
   review flow rather than being silently merged.
9. Every external field observation retains source, observed time, value, and confidence in a
   SourceRecord claim. Identifier observations carry their own confidence and inherit the
   SourceRecord observation time. Raw payload retention can later be redacted by privacy policy
   without changing the canonical contract.
10. A UserMetadataOverride is stored alongside its source/local candidate. If present—including
    an explicit `null` deletion—it wins. Otherwise the selected candidate wins. Choosing among
    competing source candidates is deliberately deferred to QUI-20.
11. Work-level contributors describe the intellectual work (for example, author). Edition-level
    contributors describe a manifestation (for example, translator or narrator). Credit order
    and `creditedAs` are preserved.
12. Anthologies and collections use ordered WorkPart relationships so contained stories remain
    independently identifiable and reusable.
13. Ownership, Loan, and AccessGrant are separate. Loan access is derived from checkout, due,
    and return instants; `dueAt` is an exclusive upper bound. No mutable `isExpired` field is
    persisted.
14. Progress belongs to an Edition. Format locators must match the Edition medium, and an
    optional Asset must belong to that Edition. Cross-format percentages are display
    projections, not a replacement for native locators.
15. Managed file paths are relative to application-controlled storage. Linked files use an
    opaque platform bookmark plus fingerprint; secrets and unrestricted absolute paths do not
    enter the catalog.

### Metadata precedence

Resolution has two intentionally separate stages:

1. QUI-20 selects one candidate from immutable source claims or a local manual/migration value.
2. `resolveMetadataField` applies an exact entity-and-field user override when one exists.

The materialized `ResolvedField` retains the candidate, optional override, winner, and resolution
time. This makes the current value explainable and rebuildable. A correction never edits or
deletes the provider observation it replaced.

### Roadmap ownership map

The complete numbered roadmap maps to the following owners. Future entities named here are
reserved boundaries, not fields to add to Work or Edition.

| Roadmap capability | Owning entity/service boundary |
| --- | --- |
| Identity, paper design, motion, haptics, component review (QUI-6–QUI-14) | `AppIdentity`, `AppearancePreference`, `InteractionPreference`, and UI component contracts; outside the catalog |
| Canonical model, provenance, SQLite, legacy migration, import/export, recovery, privacy (QUI-15–QUI-23) | Current catalog entities; future `ReadingEvent`, `ReadingSession`, `ImportBatch`, `ImportProposal`, `IntegrationCheckpoint`, `ArchiveManifest`, repository/migration services, and secure `CredentialRef` |
| Work/edition detail, Up Next, manual/ISBN capture, lists, search, review, dedupe, providers (QUI-24–QUI-32) | `Work`, `Edition`, `Identifier`, `SourceRecord`, `Person`, `Contributor`, plus future `List`, `ListEntry`, `Tag`, `SavedFilter`, and `ReviewItem` |
| EPUB engine, import, rendering, navigation, typography, annotation, assets (QUI-33–QUI-41) | `Edition`, `Asset`, future `PublicationManifest`, `ReadingLocator`, `Annotation`, `Bookmark`, and `ReaderPreference`; progress through the QUI-16 ledger |
| Audiobook import, playback, sessions, controls, system/car surfaces, profiling (QUI-42–QUI-49) | `Edition.durationMs`, audio `Asset`/future `AudioChapter`, plus `PlaybackQueue`, `PlaybackState`, `ReadingEvent`, `ReadingSession`, and platform media adapters |
| Libby imports, loans/holds, guided reconciliation, experimental signals (QUI-50–QUI-58) | `SourceRecord`, `Loan`, `AccessGrant`, future `Hold`, `ListEntry`, `ImportBatch`, `ReviewItem`, `IntegrationCheckpoint`, and least-privilege adapter boundaries |
| Adapter platform, Audiobookshelf, OPDS, Readwise, migration imports, journal export, backup transport, open APIs (QUI-59–QUI-67) | Adapter/`IntegrationCheckpoint`, `SourceRecord`, `ImportBatch`, `ReviewItem`, `Asset`, reading ledger/`Annotation`, `ArchiveManifest`, and encrypted transport services |
| Today, journal, goals, statistics, reminders, quick capture, rituals, retrospectives, delight (QUI-68–QUI-76) | Derived query models over `ReadingEvent`/`ReadingSession`/`Annotation`; future `JournalEntry`, `Goal`, `Reminder`, and `RitualPreference`, never overloaded Work fields |
| Tests, migration drills, accessibility, budgets, diagnostics, supply chain, localization, builds, beta, release, integration gates (QUI-77–QUI-87) | Fixture/quality gates, migration and backup services, `AppPreference`, `DiagnosticBundle`, release configuration, and integration health policy; catalog text uses language tags and source-aware values |

### Representative fixture decisions

The executable fixture proves:

- Google Books and Open Library can support one ISBN without duplicating it.
- One Work can have independent EPUB and audiobook Editions, Assets, covers, and progress.
- A translated Edition carries its own language and translator while retaining the original Work.
- An anthology contains ordered, independently identifiable Works.
- An Edition without an ISBN remains valid.
- A Libby Loan expires exactly at `dueAt`, and AccessGrant derives that state.
- A user title correction wins while the incorrect source claim remains available for explanation.
- Work reparenting changes only `Edition.workId`; pages, duration, language, covers, identifiers,
  narrator credits, Assets, and progress stay attached to stable Edition IDs.

## Rejected alternatives

### Keep extending `LibraryBook`

Rejected because every format adds nullable fields with conditional meanings. It cannot represent
multiple Editions or independent progress and turns merges into destructive overwrites.

### Put publication fields on Work

Rejected because page count, duration, language, narrator, publisher, identifiers, and cover vary
by Edition. Selecting one value would erase or mislabel another Edition.

### Treat every file or provider result as an Edition

Rejected because Assets can be relinked, replaced, missing, or split across files, while provider
records are observations. Neither is durable bibliographic identity.

### Use ISBN or provider IDs as primary keys

Rejected because ISBN can be missing, malformed, reused by bad data, or reported by several
sources. Provider IDs have only source-local meaning.

### Infer ownership from a file, shelf, or loan

Rejected because possession, organization, legal ownership, and time-limited access are distinct.
A removed file can still be owned, and a Libby stream can be accessible without being owned.

### Store contributors as author/narrator string arrays

Rejected because it loses person identity, role scope, credit spelling, order, translators,
editors, anthology membership, and future merge review.

### Let the latest source overwrite canonical fields

Rejected because timestamps do not establish authority and overwriting destroys provenance and
user corrections. Source choice must be explicit and reviewable.

## Migration consequences

QUI-17/QUI-18 must migrate each valid legacy `LibraryBook` conservatively:

| Legacy field | Destination |
| --- | --- |
| `id` from Google Books | SourceRecord `externalKey`; create new stable Work/Edition IDs |
| `title` | Work and initial Edition candidates marked `legacy-migration` |
| `authors[]` | Person plus ordered Work-level Contributor records; do not split uncertain names automatically |
| `thumbnail` | Remote cover Asset on the Edition, retaining the URL/source evidence |
| `pageCount` | Print/ebook Edition field; never Work |
| `shelf` | Future List/ListEntry migration boundary |
| `progress`, `currentPage`, `startedAt`, `finishedAt` | QUI-16 migration events and an Edition-scoped projection |
| `rating`, `notes` | QUI-16 reading/journal records with migration provenance |
| `addedAt`, `lastUpdatedAt` | Creation/migration provenance; preserve original values where valid |

Migration creates one Work and one best-effort Edition per legacy row before deduplication. It
does not infer missing ISBNs, merge by title alone, or delete the legacy recovery copy. Ambiguous
format, person, and identity matches enter review. The existing localStorage contract remains
unchanged until the transactional migration issues land.

## Consequences and follow-ups

- The model is more relational than the current UI, but each future feature has a single owner.
- Read views will join or project several records; repositories should expose purpose-built query
  models rather than leaking storage rows into React.
- [QUI-16 / ADR 0003](0003-reading-ledger.md) defines authoritative reading events, sessions,
  locations, normalization, correction, and provenance while keeping Edition as the progress target.
- QUI-20 must define candidate selection, conflict review, reversible merge/split operations,
  and undo without weakening the source/override boundary above.
- QUI-17 must translate these Zod contracts into normalized SQLite tables and transactions. Any
  schema shortcut that collapses these entities requires a superseding ADR before implementation.
