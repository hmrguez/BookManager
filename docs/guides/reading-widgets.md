# Reading and streak widgets

Wovenleaf includes native Home Screen widgets for Android and iOS (iOS 17 or later).
After opening the updated app once, add **Reading** or **Reading streak** from the
system widget picker. Everything is local and works offline; covers fall back to
a book symbol when no cached image is available.

## Reading

The widget starts with the currently reading book that most recently advanced.
Metadata edits, notes, ratings, and browsing other books do not change that default.
When no activity exists, the most recently started book is selected.

Tap the progress to open a focused editor with the number selected and a numeric
keyboard. Type a page or percentage, or use the adjustment buttons, then save once.
The editor remembers the unit of the last forward manual recording. Digital books
normally show percentages; physical books and PDFs can show pages. At the end,
the save action explicitly becomes **Finish book**. Stale saves cannot overwrite
newer progress, and a removed book is identified rather than silently replaced.

Medium iOS and Android widgets offer previous/next book buttons. Small iOS widgets
open the editor, where book selection is also available. Horizontal Home Screen
swipes remain system navigation. The iOS widgets share the browsed book selection;
Android instances each retain their own selection. New reading activity resets the
selection to the latest book.

Progress editing happens in the app's focused sheet, not in a Home Screen text field.
There is no separate setup screen, account, or network requirement.

## Reading streak

Any positive advance in any book counts for its local calendar day. There is no
minimum number of pages or minutes. Multiple events and multiple books on the
same day count once. If today has no activity, a streak ending yesterday stays
visible until today ends. Missing a full day resets the current count.

Durable `reading_activity_events` store book ID, stable event ID, timestamp, local
day, source, and exact before/after positions. Manual recording is transactional
with the library change. Reader and audio events retain their unrounded positions,
so advances below one displayed percentage point still count. Duplicate native
messages are idempotent. No-op saves, decreases, opening a book, and metadata edits
do not count. Libby's first capture establishes a baseline; later forward captures
count on their capture day, and undo removes that capture's activity.

Historical percentages do not establish when reading happened, so the migration
creates no synthetic history. Native delayed events use their occurrence timestamp
and the device timezone when ingested. Previously recorded day keys remain stable
when travelling. Deleting a book erases its associated activity. Full SQLite recovery
snapshots retain activity; portable library archives currently do not transfer it.

The native widgets read a small committed snapshot published on launch, app state
changes, and reading/library updates. iOS timelines include midnight entries;
Android uses the system's periodic widget refresh. OS scheduling may delay a visual
refresh. The next app activation republishes current state.

## Verification

- Unit tests: streak continuity and gaps, duplicate days, DST/leap-day boundaries,
  activity ordering, tiny page/ebook/audio advances, baseline handling, stale saves,
  Libby undo, and deletion.
- Browser test: `bunx playwright test reading-widgets.spec.ts` covers the same
  Capacitor URL event used by widgets, save-once recording, book switching, streak
  updates, reduced screen size, and large text.
- Native compilation: Android resources and Java; complete iOS simulator app,
  including the WidgetKit extension and Capacitor bridge.

Physical launcher placement, iOS tinted appearance, system keyboard presentation,
background refresh timing, and signed distribution still need device testing.
