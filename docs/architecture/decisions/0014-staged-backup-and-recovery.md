# ADR 0014: Staged local backup and rollback recovery

- **Status:** Accepted
- **Date:** 2026-08-28
- **Issue:** QUI-22
- **Depends on:** [ADR 0005: Transactional SQLite storage](0005-transactional-sqlite-storage.md), [ADR 0008: Full-fidelity portable export contract](0008-portable-export-contract.md)

## Context

A checksum-valid export is necessary but not sufficient for recovery. A restore can still lose the
only good library if the destination is overwritten before validation, the device runs out of
space while staging, or the restored data prevents the next app launch. Wovenleaf also needs local
recovery points that do not depend on operating-system cloud backup.

## Decision

Wovenleaf uses the accepted `wovenleaf-portable-library` envelope as the one logical backup format.
QUI-22 adds a recovery coordinator and isolated artifact store around it; it does not create a
second serialization of the catalog.

### Local rotation

- A verified automatic recovery point is created after a healthy startup when the newest point is
  at least 24 hours old. The user can create one immediately from Settings.
- The three newest non-staging points are retained. An active restore protects its rollback and
  staging IDs from rotation.
- Native artifacts live under `LibraryNoCloud/recovery`, outside automatic iCloud backup. Web/PWA
  artifacts live in the separate `wovenleaf-recovery` IndexedDB database.
- Local points include private annotations but exclude credentials, device-local handles, raw
  source payloads, and asset bytes. Their previews state how many asset records require relinking.
  External encrypted transport and whole-asset transport remain owned by QUI-64.

### Staged restore and atomic swap

Restore follows this order:

1. Parse the candidate and verify versions, entry membership, byte sizes, SHA-256 checksums, Zod
   schemas, catalog invariants, and the credential-free boundary without writing to SQLite.
2. Build a verified rollback archive from the current database and check that temporary storage can
   hold both archives plus recovery metadata.
3. Write the candidate to the isolated staging store and the current library to a rollback artifact.
4. Persist a pending-restore marker before touching live rows.
5. Reparse the staged bytes and replace the canonical catalog in one SQLite transaction.
6. Run `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, repository schema reads, and identity
   comparisons against the staged aggregate.

Any failure through step 3 leaves SQLite untouched. A failure after the pending marker restores the
rollback artifact and keeps a recoverable marker if rollback itself cannot complete.

### Post-restore launch

The first startup after a restore marks the launch attempt before migrations and repository reads.
A successful storage initialization confirms the restore. If another startup finds an already
attempted marker, the previous restored launch is considered interrupted and the rollback artifact
is atomically applied before normal startup continues. The rollback artifact remains in the normal
three-point rotation after use.

### Preview and failure classes

Settings shows backup date, portable format version, schema version, UTF-8 size, book count,
included asset count, relink count, and validation result before enabling restore. A backup older
than the newest local recovery point is valid but visibly stale and requires the explicit
“Restore this older backup” action.

Automated drills cover stale, future-version, truncated, checksum-tampered, missing-asset, and
low-storage candidates. Every preflight failure proves the current last-good library is unchanged;
the post-launch drill proves the saved rollback is reapplied.

## Privacy and support

Recovery archives are private data products and can contain notes, ratings, reading history, and
library membership. Support must request the allowlisted recovery report, never archive contents.
The report contains only artifact IDs/kinds, timestamps, sizes, versions, validation codes, database
health, and pending-marker state. The operational procedure is in
[the recovery runbook](../../guides/recovery.md).

## Consequences

- Restore needs temporary free space for both the candidate and current library.
- Asset records remain recoverable, while excluded device-owned files are explicit relink work.
- A valid old backup is not silently rejected, but its age is impossible to miss.
- The portable contract remains the migration boundary; implementation-specific SQLite snapshots
  remain limited to pre-destructive schema migrations.
