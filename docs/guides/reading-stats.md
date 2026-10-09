# Reading stats

Stats is a live view of supported reading evidence. It replaces the Reading navigation
shortcut; the Reading shelf remains in My Books. Quarterly Reviews retain their saved
keepsakes, identities, and achievement badges.

## Periods and comparisons

Month, Quarter, and Year use calendar boundaries in the device's current timezone.
All time includes supported history from 1900 onward. Stats remembers the selected
period and historical offset locally. Current periods stop at the calculation time;
future-dated activity is excluded. Charts show days, weeks, months, or years respectively.

Optional comparisons show the preceding period's actual totals. Completed periods
compare against a complete preceding period. An unfolding period compares the same
number of civil days and the same fraction of the current civil day, capped at the
preceding period's end. Calendar boundaries handle DST and shorter months. All time
has no comparison. Tracking coverage can differ, so the page avoids rankings, decline
arrows, and personal-best claims.

## Evidence and refresh

`calculateReadingFacts` shares the quarterly review's eligibility, correction,
work deduplication, annotation survival, and overlap reconciliation rules. The live
calculator operates on a consistent repository snapshot and does not modify keepsakes.
`calculateQuarterlyReview` continues to require a completed calendar quarter.

Tracked time includes supported local reader/player intervals. Unclassified overlap
counts once toward total time; it is not attributed to reading or listening. Active
days require five minutes. Imported supported completions can count without establishing
any reading time. A dash denotes missing tracking evidence; chart gaps mean no recorded
time, not proof that the reader did not read. Pages across finished books are not used
as a pages-read metric. Personal tags do not establish genres.

The page refreshes on entry, foreground return, and committed storage writes, debounced
to coalesce a burst of changes. Reader/player checkpoint cadence determines freshness
(approximately ten seconds for native EPUB and audiobook playback). A one-minute timer
advances calendar boundaries while the page remains visible. Hidden pages skip refresh;
unmounted pages unsubscribe. Read transactions and rolled-back writes do not trigger
storage notifications. Failed refreshes retain the previous snapshot with a retry action.

## Presentation and verification

Charts use semantic paper/ink tokens with hatching for listening and an outlined
unclassified layer. Arrow keys, Home/End, point selection, and a labeled native selector
provide equivalent exploration. The page uses existing fonts and cover components;
no chart dependency or continuous animation is required.

`reading-stats.test.ts` covers calendar cutoffs, comparison boundaries, allocation,
missing tracking, quarterly parity, and real repository corrections.
`reading-stats.spec.ts` verifies live updates, navigation, keyboard exploration,
book details, selection persistence, four paper themes, large text, responsive layouts,
and committed/read/rollback notification behavior.
