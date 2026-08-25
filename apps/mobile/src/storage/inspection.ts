import type { SqlDatabase, SqlRow } from './database'
import { readNumber, readText } from './database'
import type { CatalogQueryService, QueryPlanStep } from './query-services'

const DOMAIN_TABLES = [
  'works',
  'editions',
  'assets',
  'identifiers',
  'source_records',
  'reading_events',
  'progress_snapshots',
  'library_books',
] as const

export type StorageInspection = {
  readonly integrity: string
  readonly schemaVersion: number
  readonly recordCounts: Readonly<Record<string, number>>
  readonly indexes: readonly string[]
  readonly recentWorksPlan: readonly QueryPlanStep[]
  readonly migrationRuns: readonly Readonly<Record<string, string | number | null>>[]
}

export async function inspectStorage(
  database: SqlDatabase,
  queries: CatalogQueryService,
): Promise<StorageInspection> {
  const [integrityRows, versionRows, indexRows, migrationRows, recentWorksPlan] = await Promise.all([
    database.query('PRAGMA integrity_check'),
    database.query<SqlRow & { readonly version: number }>(
      'SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations',
    ),
    database.query<SqlRow & { readonly name: string }>(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    ),
    database.query(
      `SELECT version, name, status, started_at, finished_at, duration_ms, backup_key, error
       FROM migration_runs
       ORDER BY started_at DESC
       LIMIT 20`,
    ),
    queries.explainRecentWorks(),
  ])

  const recordCounts: Record<string, number> = {}
  for (const table of DOMAIN_TABLES) {
    const rows = await database.query<SqlRow & { readonly count: number }>(
      `SELECT COUNT(*) AS count FROM ${table}`,
    )
    recordCounts[table] = rows[0] ? readNumber(rows[0], 'count') : 0
  }

  return {
    integrity: integrityRows[0]
      ? readText(integrityRows[0], Object.keys(integrityRows[0])[0] ?? 'integrity_check')
      : 'unknown',
    schemaVersion: versionRows[0] ? readNumber(versionRows[0], 'version') : 0,
    recordCounts,
    indexes: indexRows.map((row) => readText(row, 'name')),
    recentWorksPlan,
    migrationRuns: migrationRows,
  }
}

export function installDevelopmentInspector(
  database: SqlDatabase,
  queries: CatalogQueryService,
): void {
  if (!import.meta.env.DEV) return
  const target = window as Window & {
    __wovenleafStorage?: { inspect(): Promise<StorageInspection> }
  }
  target.__wovenleafStorage = {
    inspect: () => inspectStorage(database, queries),
  }
}
