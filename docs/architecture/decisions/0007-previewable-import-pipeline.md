# ADR 0007: Previewable, idempotent imports with field-owned undo

- **Status:** Accepted
- **Date:** 2026-08-25
- **Issue:** QUI-19
- **Depends on:** ADR 0002 source precedence, ADR 0003 reading ledger, ADR 0005 transactional SQLite storage

## Context

Wovenleaf will ingest migration CSVs, Libby spreadsheets, metadata responses, publication files,
and self-hosted service records. Those sources have different formats, but they must not invent
different rules for matching, review, commits, repetition, or undo. A parser writing directly to
canonical tables would make a preview incomplete, let repeated files duplicate work, and force
undo to reconstruct state after the fact.

## Decision

Every importer uses the same seven-stage contract:

1. **Parse** source bytes into source-shaped rows. Syntax stays inside the parser.
2. **Normalize** valid rows into a typed record; invalid rows become quarantined validation errors.
3. **Match** stable source identity first, then scoped evidence. Title/author similarity is always
   low-confidence and never silently merges records.
4. **Propose** adds, updates, conflicts, skips, validation errors, match rationale, and exact field
   changes without writing canonical state.
5. **Review** lets the reader exclude a row, remap it, create a distinct record, and inspect why a
   match was proposed. Required source permissions are shown here.
6. **Commit** re-runs the shared commit rules against current state and applies the included rows in
   one SQLite transaction. A stale affected field stops the commit; unrelated field changes do not.
7. **Checkpoint** records the source/content fingerprint, previous checkpoint, result counts, row
   receipts, and field-level change set in the same transaction.

The executable parser boundary is
[`csv-parser.ts`](../../../apps/mobile/src/imports/csv-parser.ts), the pure stage orchestration is
[`pipeline.ts`](../../../apps/mobile/src/imports/pipeline.ts), and preview/commit share
[`commit-rules.ts`](../../../apps/mobile/src/imports/commit-rules.ts). Persistence and undo are owned
by [`import-repository.ts`](../../../apps/mobile/src/storage/import-repository.ts).

### Idempotency

Each committed normalized row receives a local receipt keyed by source, source-local external key,
and a SHA-256 row fingerprint. A repeated row is proposed as a skip before review and is also
claimed with a unique constraint inside the commit transaction to close concurrent races. Excluded
and invalid rows receive no receipt, so the reader can fix or include them in a later attempt.

File fingerprints identify checkpoints and diagnostics; they are not the idempotency boundary. A
changed file can contain both already-committed rows and genuinely new or changed rows.

### Undo

The change set stores one before/after pair for every field changed by the batch. Undo runs in
reverse sequence with compare-and-swap semantics:

- restore a field only when its current value still equals the imported after-value;
- leave a later value untouched and mark that change as preserved;
- delete an import-created record only when the complete record is still unchanged;
- remove a row receipt only when every owned change for that row was safely reversed.

This restores the exact pre-import state when the imported values still own their fields while
retaining later unrelated edits, matching the reconciliation rules in ADR 0002. Checkpoints and
change history remain immutable audit evidence after undo.

### Permissions and privacy

The reference CSV adapter declares three capabilities before commit: read the one selected local
file, write only reviewed library fields, and use no network. Source rows, batches, receipts, and
change sets remain in the local app database and are excluded from diagnostics.

### Reference CSV contract

The first isolated parser accepts UTF-8 CSV with RFC 4180 quoting and these headers:

| Field | Required | Notes |
| --- | --- | --- |
| `external_id` | Recommended | Stable source-local identity; derived from title/authors when absent |
| `title` | Yes | Non-empty |
| `authors` | Yes | One or more names separated by semicolons |
| `shelf` | No | `tbr`, `next`, `reading`, or `finished` (common aliases accepted) |
| `page_count`, `current_page` | No | Non-negative whole numbers; current page cannot exceed page count |
| `progress` | No | Number from 0 through 100, with an optional percent sign |
| `rating` | No | Whole number from 0 through 5 |
| `notes` | No | Quoted when it contains commas or newlines |
| `added_at`, `started_at`, `finished_at` | No | ISO 8601 date or date-time with an explicit timezone |

The fixture at
[`wovenleaf-library.csv`](../../../apps/mobile/tests/fixtures/imports/wovenleaf-library.csv) covers
quoted content, valid rows, and quarantined errors. Repository tests cover repetition, remapping,
checkpoints, exact add undo, and field-level preservation of later edits.

## Consequences

- Later adapters implement parsing and normalization, then emit the shared proposal contract.
- A new writable target must add one reviewed commit-rule adapter; it must not bypass batches or
  write arbitrary table/field names from source data.
- Matching remains explainable because stable identity and every similarity signal are retained on
  the proposal.
- Review batches persist even before commit, enabling a future resumable inbox without changing the
  commit or undo format.
