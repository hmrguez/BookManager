# Issue tracker: Linear

Track work in Linear under the Quibu team (`QUI-`).
Team ID: `a9365809-6a13-4171-ab19-a2d9203154f4`.

## Operations

Use the connected Linear tools to read, create, and update issues.
Fetch referenced issues by their `QUI-<number>` identifier, including
relevant relations and discussion.

Publish specs as Linear issues and implementation tickets as sub-issues
of the relevant spec. Record dependencies using Linear blocking relations.
Preserve an existing issue's project. For new work, use the project
specified by the task or its parent; otherwise leave it unset.

Use the team's existing workflow states: Backlog, Todo, In Progress,
In Review, Done, Canceled, and Duplicate. Triage labels describe readiness
separately from workflow state; see `triage-labels.md`.

If Linear is unavailable, report the blocker and retain any draft in the
conversation until it can be published.

## Wayfinding operations

- Map: a parent Linear issue containing Notes, Decisions-so-far, and Fog.
- Children: sub-issues with the question and ticket type
  (`research`, `prototype`, `grilling`, or `task`) in the description.
- Blocking: native Linear blocking relations.
- Frontier: open, unclaimed children whose blockers are resolved;
  choose the lowest issue number first.
- Claim: move the child to In Progress before starting work.
- Resolve: record the answer in the child description, move it to Done,
  and add a gist and issue link to the map's Decisions-so-far.
