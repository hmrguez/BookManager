import { Database } from 'bun:sqlite'

const path = process.argv[2]
if (!path) {
  throw new Error('Usage: bun run storage:inspect -- /absolute/path/to/wovenleafSQLite.db')
}

const database = new Database(path, { readonly: true })
try {
  const integrity = database.query('PRAGMA integrity_check').all()
  const migrations = database
    .query('SELECT version, name, applied_at, duration_ms FROM schema_migrations ORDER BY version')
    .all()
  const runs = database
    .query(
      `SELECT version, name, status, started_at, finished_at, duration_ms, backup_key, error
       FROM migration_runs
       ORDER BY started_at DESC
       LIMIT 20`,
    )
    .all()
  const counts = database
    .query(
      `SELECT 'works' AS table_name, COUNT(*) AS count FROM works
       UNION ALL SELECT 'editions', COUNT(*) FROM editions
       UNION ALL SELECT 'assets', COUNT(*) FROM assets
       UNION ALL SELECT 'reading_events', COUNT(*) FROM reading_events
       UNION ALL SELECT 'progress_snapshots', COUNT(*) FROM progress_snapshots
       UNION ALL SELECT 'library_books', COUNT(*) FROM library_books`,
    )
    .all()
  const indexes = database
    .query(
      `SELECT name, tbl_name
       FROM sqlite_master
       WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all()

  console.log(JSON.stringify({ path, integrity, migrations, runs, counts, indexes }, null, 2))
} finally {
  database.close()
}
