# ADR 0011: Duplicate review and identity journal

- Status: accepted
- Date: 2026-08-26
- Issue: QUI-30

## Context

Wovenleaf receives overlapping book records from manual capture, ISBN scans, files, providers, catalogs, and reading services. A title search can find plausible overlap, but it cannot safely decide Work identity. ISBNs belong to Editions, contributors can differ by role, translations and adaptations can resemble one another, and provider metadata can be wrong.

A mistaken merge is especially costly if it detaches progress, annotations, lists, loans, or local assets from the Edition where the reader created them. Low-confidence guesses must also stay out of the capture path.

## Decision

### Local search supplies recall, not identity

Duplicate detection reuses QUI-28's on-device normalization, fuzzy matching, and bounded index to produce a small candidate set. It then scores explicit evidence:

- exact Edition and Work identifiers;
- source-local identity links;
- normalized and fuzzy titles;
- normalized Work contributors;
- publication facts, original language, and Work structure;
- cautions such as an Edition identifier appearing across formats.

Every candidate carries the evidence ledger, confidence, and a `requiresReview` marker. No confidence level performs an automatic merge. High and medium confidence enter the review queue; low confidence remains in a background queue that capture does not open.

### Pair decisions are durable and local

The reader can merge, keep separate, relate, or never suggest a Work pair. The pair key is canonical regardless of display order. Active decisions suppress repeated suggestions without deleting the underlying identifiers, metadata, or source observations. Non-merge decisions can be undone directly.

### Merge previews the destination

Before applying a merge, Wovenleaf computes the moving and destination counts for Editions, assets, progress snapshots, note annotations, list memberships, loans, ownership, and source evidence. It also lists every Edition destination and identifies list memberships that will move or consolidate.

An exact ISBN is strong Edition evidence only. Even an exact ISBN across different formats remains a reviewed candidate and displays a format caution.

### Identity changes retain stable records

A Work merge reparents complete Editions and retains both Work records for recovery. Edition IDs do not change, so their assets, reading events, progress snapshots, annotations, ownership, loans, access, identifiers, and source observations remain attached.

Work-scoped list memberships move to the surviving Work. If both Works already belong to the same list, the source membership is consolidated rather than duplicated. Every Edition assignment and list mutation is validated and written in one SQLite transaction.

### The journal is the undo source of truth

Each merge, split, and Edition reassignment stores the validated identity operation plus exact list mutations in `identity_operations`. Undo uses compare-and-swap rules: it restores only when affected Editions and lists still match the journal's applied state, and refuses to overwrite later reader changes.

Merge decisions point to their journal entry and are undone with the operation. This keeps the review decision, identity assignments, and list destination changes consistent.

## Consequences

- Duplicate review works fully offline and does not send private metadata or notes to a service.
- Search improvements can increase candidate recall without weakening merge safety.
- Merges remain deliberate even when the evidence is very strong.
- Stable Edition children avoid expensive and lossy rewrites across reader-owned data.
- Recoverable Work records and append-only decision history use modest additional storage.
- A future canonical catalog UI can use the repository directly; the development identity desk exercises the complete evidence, preview, decision, and undo interaction now.
