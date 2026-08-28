# Backup and restore recovery runbook

Use this runbook when Wovenleaf reports an invalid backup, an interrupted restore, a damaged local
recovery index, or a failed post-restore launch.

## Privacy rule

Recovery archives can contain the complete private library, including notes, ratings, reading
history, and identifiers. Do not ask the user to paste archive JSON, send screenshots of its
contents, attach a `.wovenleaf.json` file, or disclose book titles. Do not open an artifact merely
to identify it.

In a development build, collect only the allowlisted report:

```js
await window.__wovenleafStorage.recoveryReport()
```

It contains database health, format/schema versions, artifact IDs and kinds, timestamps, byte
sizes, validation codes, and pending-marker state. It deliberately contains no titles, notes,
ratings, paths, archive entry payloads, credentials, or imported filenames.

## Recovery artifacts

| Artifact | Native location | Web/PWA location | Purpose |
| --- | --- | --- | --- |
| Recovery index | `LibraryNoCloud/recovery/index.json` | `wovenleaf-recovery` IndexedDB, `state` store | Rotation metadata and pending-restore marker |
| Automatic/manual point | `LibraryNoCloud/recovery/artifacts/<artifact-id>.wovenleaf.json` | `wovenleaf-recovery` IndexedDB, `artifacts` store | One of the three rotating logical backups |
| Rollback point | Same artifact directory | Same `artifacts` store | Pre-restore library kept through launch confirmation |
| Staging artifact | Same artifact directory while active | Same `artifacts` store while active | Untrusted candidate isolated before the SQLite transaction |
| Migration snapshot | `LibraryNoCloud/storage-backups/` | `wovenleaf-migration-backups` IndexedDB | SQLite-engine snapshot made only before destructive migrations |

Artifact IDs are random operational identifiers and contain no filenames. A pending marker names
the rollback and staging IDs needed for an interrupted restore. Preserve the index and all artifacts
named by that marker as one set.

## Triage order

1. Ask the user to stop retrying restore and keep the app installed. Reinstallation can remove the
   private app container and its rollback point.
2. Collect the allowlisted recovery report. Record only its validation code and artifact IDs.
3. If `pendingRestore.launchAttempted` is `false`, the candidate swap has not yet completed a test
   launch. Restart once and allow normal startup validation to finish.
4. If `pendingRestore.launchAttempted` is `true`, the next startup automatically restores the named
   rollback point. Do not delete or rotate that artifact.
5. For `low-storage`, free at least the amount shown in the app and retry from the original backup.
   Wovenleaf has not changed the live database at this failure point.
6. For `stale`, confirm that the displayed backup date is the intended point in time. The user must
   choose the explicit older-backup action.
7. For `future-version`, update Wovenleaf to a reader that supports the displayed contract/schema;
   do not edit version fields.
8. For `truncated`, `tampered`, or `missing-asset`, obtain a fresh export or choose another verified
   local point. Do not repair checksums or synthesize missing entries.
9. For `corrupt-database`, preserve the report and artifact set. Avoid manual SQL writes; use the
   newest verified logical point or the pending rollback path.

## Automated drill

Run the recovery contract independently:

```bash
cd apps/mobile
bun test ./tests/recovery.test.ts
```

The drill proves three-point rotation and privacy-safe support output; unchanged last-good data for
stale, future, truncated, tampered, missing-asset, and low-storage failures; atomic successful
restore; and rollback after a simulated failed restored launch.
