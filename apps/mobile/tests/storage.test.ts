import { describe, expect, test } from 'bun:test'
import {
  editionIdSchema,
  readingDeviceIdSchema,
  readingEventIdSchema,
  readingEventSchema,
  type Catalog,
} from '../src/domain/catalog'
import { CatalogRepository, ReadingLedgerRepository } from '../src/storage/catalog-repository'
import type { SqlRow, SqlValue } from '../src/storage/database'
import type { MigrationBackupStore, StorageMigration } from '../src/storage/migrations'
import { migrateStorage, STORAGE_MIGRATIONS } from '../src/storage/migrations'
import { CatalogQueryService } from '../src/storage/query-services'
import { representativeCatalog } from './fixtures/catalog'
import { BunSqliteDatabase } from './storage-test-database'

describe('transactional SQLite storage', () => {
  test('routes row-returning connection pragmas through the query path', async () => {
    const database = new AndroidExecSqlDatabase()

    await migrateStorage(database)

    expect(database.queriedStatements[0]).toBe('PRAGMA busy_timeout = 5000')
    expect(database.executedStatements.join('\n')).not.toContain('PRAGMA busy_timeout')
    await database.close()
  })

  test('round-trips the canonical aggregate through normalized repository tables', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const repository = new CatalogRepository(database)

    await repository.replace(representativeCatalog)
    const stored = await repository.read()

    expect(stored).toEqual(catalogOrderedById(representativeCatalog))
    await database.close()
  })

  test('an interrupted catalog transaction never leaves half-applied domain state', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const repository = new CatalogRepository(database)
    await repository.replace(representativeCatalog)
    await database.execute(`
      CREATE TRIGGER interrupt_catalog_replace
      BEFORE INSERT ON editions
      BEGIN
        SELECT RAISE(ABORT, 'simulated interruption');
      END;
    `)

    await expect(repository.replace(representativeCatalog)).rejects.toThrow('simulated interruption')

    const stored = await repository.read()
    expect(stored.works).toHaveLength(representativeCatalog.works.length)
    expect(stored.editions).toHaveLength(representativeCatalog.editions.length)
    expect(stored.readingEvents).toHaveLength(representativeCatalog.readingEvents.length)
    await database.close()
  })

  test('an interrupted ledger append rolls back checkpoints, events, and references', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await new CatalogRepository(database).replace(representativeCatalog)
    const repository = new ReadingLedgerRepository(database)
    const before = await repository.read()
    const editionId = representativeCatalog.editions[0].id
    const events = [
      locationEvent('reading-event:transaction:first', editionId, '2026-08-25T12:00:00.000Z'),
      locationEvent('reading-event:transaction:second', editionId, '2026-08-25T12:01:00.000Z'),
    ]
    await database.execute(`
      CREATE TRIGGER interrupt_ledger_append
      BEFORE INSERT ON reading_events
      WHEN NEW.id = 'reading-event:transaction:second'
      BEGIN
        SELECT RAISE(ABORT, 'simulated ledger interruption');
      END;
    `)

    await expect(repository.append({ events })).rejects.toThrow('simulated ledger interruption')

    expect(await repository.read()).toEqual(before)
    await database.close()
  })

  test('migrations replay once and destructive changes are backed up before execution', async () => {
    const database = new BunSqliteDatabase()
    const backups: string[] = []
    let backupFinished = false
    const backupStore: MigrationBackupStore = {
      async save(key, snapshot) {
        expect(snapshot.length).toBeGreaterThan(0)
        backups.push(key)
        backupFinished = true
        return `memory://${key}`
      },
    }
    const destructiveVersion = STORAGE_MIGRATIONS.length + 1
    const destructiveMigration: StorageMigration = {
      version: destructiveVersion,
      name: 'destructive migration proof',
      kind: 'destructive',
      signature: 'create migration_proof',
      async up(transaction) {
        expect(backupFinished).toBe(true)
        await transaction.execute('CREATE TABLE migration_proof(id TEXT PRIMARY KEY)')
      },
    }
    const migrations = [...STORAGE_MIGRATIONS, destructiveMigration]

    await migrateStorage(database, { migrations, backupStore })
    await migrateStorage(database, { migrations, backupStore })

    const versions = await database.query('SELECT version FROM schema_migrations ORDER BY version')
    expect(versions).toEqual(migrations.map(({ version }) => ({ version })))
    expect(backups).toHaveLength(1)
    const runs = await database.query(
      'SELECT status, backup_key FROM migration_runs WHERE version = ?',
      [destructiveVersion],
    )
    expect(runs).toEqual([{ status: 'completed', backup_key: expect.stringMatching('memory://') }])
    await database.close()
  })

  test('a failed destructive migration is observable and does not advance or change domain data', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await new CatalogRepository(database).replace(representativeCatalog)
    const destructiveVersion = STORAGE_MIGRATIONS.length + 1
    const failingMigration: StorageMigration = {
      version: destructiveVersion,
      name: 'failed destructive migration proof',
      kind: 'destructive',
      signature: 'delete works then interrupt',
      async up(transaction) {
        await transaction.run('DELETE FROM reading_event_references')
        await transaction.run('DELETE FROM progress_snapshots')
        await transaction.run('DELETE FROM reading_events')
        throw new Error('power lost during migration')
      },
    }
    const backupStore: MigrationBackupStore = {
      async save(key) {
        return `memory://${key}`
      },
    }

    await expect(
      migrateStorage(database, {
        migrations: [...STORAGE_MIGRATIONS, failingMigration],
        backupStore,
      }),
    ).rejects.toThrow('power lost during migration')

    const versions = await database.query('SELECT version FROM schema_migrations ORDER BY version')
    expect(versions).toEqual(STORAGE_MIGRATIONS.map(({ version }) => ({ version })))
    const failedRun = await database.query(
      'SELECT status, backup_key, error FROM migration_runs WHERE version = ?',
      [destructiveVersion],
    )
    expect(failedRun).toEqual([
      {
        status: 'failed',
        backup_key: expect.stringMatching('memory://'),
        error: 'power lost during migration',
      },
    ])
    const stored = await new CatalogRepository(database).read()
    expect(stored.readingEvents).toHaveLength(representativeCatalog.readingEvents.length)
    await database.close()
  })

  test('scale fixtures use bounded Work and session timeline query plans', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await new CatalogRepository(database).replace(representativeCatalog)
    const editionId = representativeCatalog.editions[0].id
    await database.execute(`
      WITH RECURSIVE sequence(value) AS (
        VALUES(1)
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value < 10000
      )
      INSERT INTO works(id, kind, title_sort, created_at, updated_at, payload_json)
      SELECT
        printf('work:scale:%05d', value),
        'single',
        printf('Scale Work %05d', value),
        '2026-01-01T00:00:00.000Z',
        printf('2026-01-%02dT00:00:00.000Z', (value % 28) + 1),
        '{}'
      FROM sequence;
    `)
    await database.run(
      `WITH RECURSIVE sequence(value) AS (
         VALUES(1)
         UNION ALL
         SELECT value + 1 FROM sequence WHERE value < 50000
       )
       INSERT INTO reading_events(
         id, edition_id, device_id, kind, session_id,
         effective_at, observed_at, recorded_at, payload_json
       )
       SELECT
         printf('reading-event:scale:%05d', value),
         ?,
         'reading-device:scale-fixture',
         'session',
         printf('reading-session:scale:%05d', value),
         printf('%020d', value),
         printf('%020d', value),
         printf('%020d', value),
         '{}'
       FROM sequence`,
      [editionId],
    )
    const queries = new CatalogQueryService(database)

    const workPlan = await queries.explainRecentWorks()
    const sessionPlan = await queries.explainSessionsForEdition(editionId)

    expect(workPlan.map(({ detail }) => detail).join('\n')).toContain('idx_works_updated_at')
    expect(sessionPlan.map(({ detail }) => detail).join('\n')).toContain(
      'idx_reading_events_sessions_timeline',
    )
    expect(sessionPlan.map(({ detail }) => detail).join('\n')).not.toContain('TEMP B-TREE')
    await database.close()
  })
})

class AndroidExecSqlDatabase extends BunSqliteDatabase {
  readonly executedStatements: string[] = []
  readonly queriedStatements: string[] = []

  override async execute(statements: string): Promise<void> {
    this.executedStatements.push(statements)
    if (/\bPRAGMA\s+busy_timeout\b/i.test(statements)) {
      throw new Error('Queries can be performed using SQLiteDatabase query or rawQuery methods only')
    }
    await super.execute(statements)
  }

  override async query<Row extends SqlRow = SqlRow>(
    statement: string,
    values: readonly SqlValue[] = [],
  ): Promise<Row[]> {
    this.queriedStatements.push(statement)
    return super.query<Row>(statement, values)
  }
}

function locationEvent(id: string, editionId: string, timestamp: string) {
  return readingEventSchema.parse({
    id: readingEventIdSchema.parse(id),
    editionId: editionIdSchema.parse(editionId),
    kind: 'location',
    source: { kind: 'local', method: 'manual' },
    deviceId: readingDeviceIdSchema.parse('reading-device:transaction-test'),
    observedAt: timestamp,
    effectiveAt: timestamp,
    recordedAt: timestamp,
    timeConfidence: 1,
    position: {
      locator: { kind: 'percent', fraction: 0.5 },
      normalizedProgress: 0.5,
      normalization: { kind: 'reported-percent', confidence: 1 },
    },
  })
}

function catalogOrderedById(catalog: Catalog): Catalog {
  return Object.fromEntries(
    Object.entries(catalog).map(([key, values]) => [
      key,
      [...values].sort((left, right) => left.id.localeCompare(right.id)),
    ]),
  ) as Catalog
}
