# Goodreads import performance

The local import must complete without waiting for cover lookup. Parsing, review staging,
catalog writes, reading evidence, receipts, checkpoints, and undo history remain local.
Cover enrichment runs separately after the library is saved.

## Measured workload

Measured on an isolated iPhone 17 Pro simulator running iOS 26.5 with a real 1,820-row,
approximately 362 KB Goodreads export on 2026-09-17. The private export is not a repository fixture.

The original native import was terminated at the strict 30-second deadline. Its preview took
2.425 seconds; commit did not finish before termination.

After optimization, fresh full imports with the production review component rendered completed
in **7.962 seconds**, **7.333 seconds**, and **8.271 seconds**. The final run includes the capacity read and measured:

| Stage | Seconds |
| --- | ---: |
| Read file, prepare and persist preview, paint review | 1.987 |
| Commit all reviewed data, receipts, and change history | 5.996 |
| Reload library/catalog/history and paint completion | 0.288 |
| Total local processing | 8.271 |

All 1,820 library books and canonical works were present, with 16,547 journaled changes,
zero excluded rows, and accurate import history. User review time, database initialization,
and optional network cover downloads are outside the processing measurement. The watchdog
includes app startup and terminates the simulator app after 30 seconds regardless of progress.
These are simulator measurements, not a guarantee for every physical device.

## Changes

- Read the catalog once per phase and evolve it in memory. Index identities and normalized
  author names rather than repeatedly normalizing/scanning every existing record.
- Validate the complete canonical graph once at the end of the phase. Project reading state
  using the affected edition's events.
- Check resulting library capacity once inside the transaction.
- Send bounded batches through SQLite's native `executeSet`, preserving statement order.
  Use multi-row inserts for staging, receipts, and the append-only change journal, staying
  below 900 bound variables per statement.
- Skip relationship cleanup for records known to be new; the SQLite plugin's delete handling
  otherwise does thousands of unnecessary schema/relationship checks.
- Count history rows and changes independently. The previous join multiplied every source
  row by every recorded change before aggregation.
- Hash rows in bounded groups, deliver progressive previews, and yield between groups.
- Render 100 compact review rows per page and mount details only on expansion. Show progress
  during saving and completion checkmarks only after the transaction succeeds.

The transaction remains atomic. Chunked writes do not become partial commits. Native write
failures roll back library data, canonical data, receipts, and the change journal together.
Existing repeat-import, stale-preview, capacity, and undo rules remain covered by tests.

The observed export repeated a valid ISBN-10 in its ISBN13 column. The parser now converts
that checksum-validated ISBN to ISBN-13, retaining the original source cell; genuinely invalid
checksums still fail validation.

## Reproduce

From `apps/mobile`, build web assets with `bun run build` and build the iOS simulator app
with the repository's `make ios-build` command from the repository root. Boot a **dedicated
disposable** iOS simulator, then run:

```sh
python3 scripts/benchmark-goodreads-ios.py --device SIMULATOR_UUID --csv /path/to/export.csv
```

The runner resets Wovenleaf only on the supplied simulator, copies the CSV into a temporary
test bundle, and runs the real importer, native SQLite adapter, and review component.
It models an entitled test library; it does not change production purchase enforcement.
It exits unsuccessfully for incomplete imports, totals of 10 seconds or more, and the hard
30-second timeout. It prints only counts/timings, never book titles or private notes.

`tests/import-performance.test.ts` guards the 1,820-book workload, bounded database reads and
bridge batches, streamed previews, concurrent staged imports, and rollback after a chunk failure.
`visual-tests/import-review.spec.ts` covers compact review, expansion, paging, offline commit,
reload, and undo through the app UI.

## Cover lookup verification

Cover lookup starts automatically after the imported library is loaded. It never blocks the
local import transaction. Cover URLs are saved on the library records; images load when displayed,
so this does not promise an offline download of every cover image.

Live verification found that Open Library's legacy Read API returned HTTP 404. Previously,
that optional failure discarded successful primary search matches and stopped the first ISBN
batch. A later batch also failed on an empty publisher string. The provider now skips an absent
legacy endpoint, preserves primary matches on temporary fallback failures without caching
unverified misses, and tolerates blank optional edition fields.

Covers are published after each 40-ISBN batch. Remaining titles are checked in batches of ten,
with title/author identity verification and paginated results. This replaces the previous limit
of twenty individual title searches per run. Cached responses and the existing request spacing
remain in use. User-supplied or existing covers are not overwritten.
Work-level searches run before edition-enriched searches because the latter can hide a known
work cover when Open Library cannot find a matching edition.

A live audit of the same 1,820-row export on 2026-09-17 found **1,233 cover matches (67.7%)**:
970 through ISBN-linked works, 251 through title/author work matches, and 12 additional matches
verified against edition-level API responses saved by the simulator. The other 587 rows had no
confident match in the available search metadata. This is not proof that no cover exists, and
a work-level match may depict another edition. The optional legacy Read API was unavailable.
The private, per-book report is deliberately not a repository fixture.

To run a read-only, resumable audit that generates a searchable HTML report and JSON evidence:

```sh
bun scripts/audit-goodreads-covers.ts /path/to/goodreads.csv /private/output/directory [saved-metadata-evidence.json]
```

The audit caches successful API responses, spaces live requests, and bounds each network request
to twenty seconds. It queries metadata in batches instead of downloading the image collection.
The optional third argument accepts saved metadata-cache entries and independently checks each
edition variant's title and author before including its cover.
Tests cover missing and temporarily unavailable fallback endpoints, blank metadata, paginated
title matches, progressive ISBN results, identity mismatches, and cover display/persistence after
import and reload. Real covers were also observed and persisted in the isolated iOS simulator.
