# 0010 — Reading status stays independent from custom shelves

**Status:** Accepted
**Issue:** QUI-27

## Decision

Every library book has exactly one reading status represented by the four default shelves:
To Be Read, Up Next, Reading, or Finished. A book may independently belong to any number of
custom shelves and have any number of tags.

The default shelves are the workflow surface. Their book rows keep the direct Next, Start,
progress, Finish, and rating actions. A book row rendered inside a custom shelf has no quick
actions; it opens the same book-detail surface, where reading status can still be changed.

Custom shelves are manually ordered. Keyboard and touch users can set a one-based position in
the shelf editor without drag and drop. The editor renders at most 80 matching books at once and
uses search to reach any item in a large library. Batch membership and order save in one
transaction. Persisted positions are sparse so direct single-entry moves normally update one row;
a shelf is rebalanced only when adjacent positions have no remaining gap.

Pinning changes shortcut and display order only. Archiving hides a shelf without changing books
or membership. Deleting a custom shelf removes that shelf and its membership rows, never the
books. Removing a book from the library removes its custom-shelf and tag memberships.

## Consequences

- Moving a book between default shelves never changes its custom collections or tags.
- Adding or removing custom-shelf membership never changes reading status or progress.
- A custom shelf can be deleted or archived without risking library data.
- Portable archives include custom shelves, order, pin/archive state, membership, and tags.
- Schema-1 portable archives restore with an empty organization model; the additive SQLite
  migration leaves all existing four-shelf data unchanged.
