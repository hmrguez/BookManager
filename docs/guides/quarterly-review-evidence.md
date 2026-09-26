# Quarterly review evidence engine

Implemented for [Calculate evidence-backed quarterly achievements and genre suggestions](https://linear.app/hrcoding/issue/QUI-110/calculate-evidence-backed-quarterly-achievements-and-genre-suggestions).
The approved [badge catalogue](../design/quarterly-review-badges.md) and the linked Linear resolutions remain the product contract.

`apps/mobile/src/reviews/repository.ts` exposes `QuarterlyReviewRepository.calculate`.
It reads a consistent SQLite transaction and returns a detached, serializable calculation.
`evidence.ts` is the pure calculation boundary; `calendar.ts`, `activity.ts`, `genres.ts`
and `catalogue.ts` own calendar allocation, activity evidence, genre policy and selection.
The repository does not write a keepsake, choose an identity, fetch metadata or change reading history.
The next implementation ticket owns saving and replaying this result.

```ts
const result = await new QuarterlyReviewRepository(database, {
  voiceExists: async path => ((await managedStore.read(path))?.byteLength ?? 0) > 0,
}).calculate({
  quarter: reviewQuarter(2026, 2, 'Europe/Madrid'),
  knownAt: new Date().toISOString(),
})
```

Supply the assigned quarter timezone, not the device's current timezone on replay.
The engine verifies the saved boundaries and refuses an unfinished quarter. The ledger's
`knownAt` cutoff includes later corrections when generating a fresh historical quarter.
Metadata and surviving objects describe the supplied current snapshot; this API is not a
way to reconstruct previously unsaved metadata or hard-deleted annotations at an old cutoff.

## Evidence and conservative exclusions

- Finishes use correction-aware, explicitly dated manual, reviewed Goodreads or legacy evidence.
  One canonical Work counts once per quarter across formats and rereads. Loan returns, positions,
  uncertain import dates and seeded migration events never establish completion.
- Edition page counts describe **pages across books finished**, not pages consumed in the quarter.
  Unambiguous exact-field reader corrections win. Compatible verified provider edition counts can
  fill missing canonical counts. Audio pages and conflicting lengths are unavailable. Supporting
  book/edition labels, effective page values and source references accompany the result.
- Active time comes from validated PDF/audio intervals and version-1 foreground EPUB slices.
  Historical unversioned EPUB sessions remain excluded. The calculation tolerance is **zero
  milliseconds**: duration exceeding elapsed time is rejected, never clamped. Unknown pause
  placement can count only in an isolated interval contained in one local date; overlapping
  uncertain clusters and uncertain boundary allocation are excluded.
- Exact intervals are unioned. Concurrent different Works or activity types contribute once to
  total activity but their overlap is not attributed to a particular Work/type. Calendar splitting
  uses the saved IANA timezone, local midnights, half-open quarters and Monday-based weeks.
  Accumulators retain integer milliseconds until presentation-unit conversion.
- Visits require exact activity with at most five minutes between the same Work, activity type and
  device. Work switches, including a recorded start/resume/location without a completed session,
  end a visit. EPUB visits also require consecutive capture indices and compatible checkpoint or
  pause/resume boundaries within one capture instance. Missing slices, discontinuities and process
  restarts cannot establish continuity. Pauses add no minutes.
- Reflections count surviving, validated native objects by original creation time. Equivalent
  same-Work anchors and duplicate IDs are deduplicated before quarter filtering. Blank notes,
  deleted passages and missing recordings earn nothing. A voice path alone is insufficient:
  callers must supply an actual existence check; absent verification withholds the voice badge.
  Captions for passage notes explicitly refer to passages saved in the quarter that now have notes.
- Metadata conditionals require actual evidence: canonical author identities, known series and
  normalized edition languages. Personal tags never classify books. Page/chapter consumption
  badges stay unavailable because capture does not prove consumption.

## Genre evidence

Provider subject claims retain their original strings, scope, source key and observation time.
New EPUB imports retain optional Dublin Core subjects in the existing import provenance payload,
which already survives private portable backup/restore. No archive format change or reinspection of
old books is required; old imports without subjects remain unknown. The latest replacement package
supplies the embedded claim for its Edition.

Whole-label aliases are intentionally small and versioned with the rules. Compatible labels within
one claim may classify multiple families. Different explicit classifications from peer sources are
unresolved; an exact book subject correction takes precedence. Generic fiction, bare History,
unsupported topics, poetry/comics and umbrella literary labels cannot establish a family.
Contradictory fiction/nonfiction and criticism context remain unresolved.

Classification counts overlap, with one vote per qualifying Work per supported family. Suggestions
require at least 51% classified Works and a unique leader whose lead strictly exceeds all unknown
Works. Ties place tied pathways first; every result still permits any identity or Skip. A selected
identity is deliberately absent from the evidence engine, so it cannot change genre counts.

## Personal bests and selection

The 30 approved ladders use twenty development points per tier; the first three extend to 120.
The result contains all earned badges, supporting facts, selected badge IDs and deterministic reveal
order. It applies five-point ranking bands, personal-best preference within a band, two-per-family
and overlap caps, and at most five highlights. It contains semantic fact keys rather than translated
captions; consumers must retain their qualifiers. Development points are internal, not reader scores.

A personal best requires explicit metric coverage evidence for the current quarter and at least two
previous completed comparable quarters: identical rule/capture versions and timezone, complete
coverage and surviving evidence references. The engine recomputes those quarters from the same
corrected evidence snapshot; saved keepsakes are never comparison inputs. It saves comparison
values, quarters, references and coverage context. Duplicate/partial/incompatible certificates do
not qualify, and improvement must exceed the prior displayed value by one item or one whole minute.

The current repositories do **not** establish complete historical coverage automatically. Callers
must not manufacture certificates from the mere presence of events; by default no personal-best
flag is awarded. Current ratings and passages' current note presence cannot establish historical
comparison values and are withheld from personal-best eligibility even with generic coverage.
Missing tracking remains unavailable, never an invented zero baseline.

## Verification

From `apps/mobile`, run:

```sh
bun test ./tests/quarterly-review.test.ts ./tests/quarterly-review-repository.test.ts
bun run lint
bun run typecheck
```

The tests cover all thirty ladders and invalid inputs, normalization and selection; genre aliases,
source conflicts, overlapping families, exact coverage/lead thresholds and empty/single-book cases;
corrected dates, rereads and format deduplication; DST, midnight, quarter boundaries, overlaps,
pause uncertainty, ten-second slices and visit continuity; reflections and privacy; and strict
personal-best comparisons. Repository tests import an EPUB, record manual finishes and both native
platforms' outbox event shapes, attach shared enrichment claims, and compare the entire calculated
result before and after private backup/restore. They do not claim a native review UI walkthrough.

Saved keepsakes, invitation/replay UI, artwork approvals, explicit update/erasure integration and
social snapshots remain with the implementation map's other children.
