import { describe, expect, test } from 'bun:test'
import { CatalogRepository } from '../src/storage/catalog-repository'
import {
  createLegacyLibraryRecoveryFile,
  LEGACY_LIBRARY_MIGRATION_KEY,
  migrateLegacyLibrary,
  type LegacyLibraryStorage,
} from '../src/storage/legacy-library-migration'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage, STORAGE_MIGRATIONS } from '../src/storage/migrations'
import {
  currentLegacyLibrary,
  futureFieldsLegacyLibrary,
  malformedLegacyLibrary,
  missingFieldsLegacyLibrary,
} from './fixtures/legacy-library'
import { BunSqliteDatabase } from './storage-test-database'

const migrationTime = new Date('2026-08-25T20:00:00.000Z')

describe('legacy localStorage library migration', () => {
  test('upgrades an existing version-1 SQLite library without changing its compatibility rows', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database, { migrations: STORAGE_MIGRATIONS.slice(0, 1) })
    const existingBook = JSON.parse(currentLegacyLibrary)[0]
    await new LibraryRepository(database).save(existingBook)

    await migrateStorage(database)

    expect(await new LibraryRepository(database).list()).toEqual([existingBook])
    expect(
      await database.query(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('lists', 'list_entries', 'legacy_library_migrations')
         ORDER BY name`,
      ),
    ).toEqual([
      { name: 'legacy_library_migrations' },
      { name: 'list_entries' },
      { name: 'lists' },
    ])
    await database.close()
  })

  test('maps current user and starter records into canonical, list, ledger, and UI storage', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const storage = new MemoryStorage({ 'bookmanager.library.v1': currentLegacyLibrary })

    const result = await migrateLegacyLibrary(database, storage, { now: () => migrationTime })

    expect(result).toEqual({
      status: 'migrated',
      importedBooks: 2,
      sourceKeys: ['bookmanager.library.v1'],
    })
    expect(storage.getItem('bookmanager.library.v1')).toBeNull()

    const catalog = await new CatalogRepository(database).read()
    expect(catalog.works).toHaveLength(2)
    expect(catalog.editions).toHaveLength(2)
    expect(catalog.listEntries).toHaveLength(2)
    expect(catalog.lists.map(({ slug }) => slug).sort()).toEqual([
      'legacy-finished',
      'legacy-reading',
    ])
    expect(catalog.sourceRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { kind: 'migration', name: 'BookManager legacy user library' },
          externalKey: 'google-books:legacy-left-hand',
        }),
        expect.objectContaining({
          source: { kind: 'migration', name: 'Wovenleaf seeded starter library' },
          externalKey: 'starter-piranesi',
        }),
      ]),
    )
    expect(catalog.works).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.objectContaining({ value: 'The Left Hand of Darkness' }),
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-20T10:00:00.000Z',
        }),
      ]),
    )
    expect(catalog.editions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          medium: 'print',
          pageCount: expect.objectContaining({ value: 304 }),
        }),
      ]),
    )
    expect(catalog.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'cover',
          location: expect.objectContaining({
            kind: 'remote',
            uri: 'https://books.example.test/left-hand.jpg',
          }),
        }),
      ]),
    )
    expect(catalog.people).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: expect.objectContaining({ value: 'Ursula K. Le Guin' }),
        }),
      ]),
    )
    expect(catalog.contributors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'author', creditedAs: 'Ursula K. Le Guin', position: 0 }),
      ]),
    )
    expect(
      catalog.readingEvents.filter(
        (event) => event.kind === 'import' && event.source.kind === 'migration',
      ),
    ).toHaveLength(2)
    expect(catalog.readingEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'location',
          position: expect.objectContaining({ locator: { kind: 'page', page: 128 } }),
        }),
        expect.objectContaining({
          kind: 'location',
          position: expect.objectContaining({
            locator: { kind: 'percent', fraction: 0.42 },
            normalizedProgress: 0.42,
          }),
        }),
        expect.objectContaining({ kind: 'rating', value: 4 }),
        expect.objectContaining({
          kind: 'note',
          text: 'Migrated note with private reading context.',
        }),
      ]),
    )
    expect(catalog.progressSnapshots.map(({ status }) => status).sort()).toEqual([
      'finished',
      'reading',
    ])

    const books = await new LibraryRepository(database).list()
    expect(books).toEqual(JSON.parse(currentLegacyLibrary))
    const checkpoint = await database.query(
      `SELECT status, source_count, imported_count, recovery_payload
       FROM legacy_library_migrations WHERE migration_key = ?`,
      [LEGACY_LIBRARY_MIGRATION_KEY],
    )
    expect(checkpoint).toEqual([
      expect.objectContaining({ status: 'completed', source_count: 2, imported_count: 2 }),
    ])
    const recovery = await createLegacyLibraryRecoveryFile(database, storage)
    expect(recovery?.contents).toBe(currentLegacyLibrary)
    await database.close()
  })

  test('fills missing legacy fields conservatively and records inferred lifecycle provenance', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const storage = new MemoryStorage({
      'bookmanager.library.v1': missingFieldsLegacyLibrary,
    })

    await migrateLegacyLibrary(database, storage, { now: () => migrationTime })

    const [book] = await new LibraryRepository(database).list()
    expect(book).toEqual({
      id: 'legacy-missing-fields',
      title: 'A minimally recoverable book',
      authors: [],
      pageCount: 200,
      shelf: 'reading',
      progress: 25,
      currentPage: 50,
      rating: 0,
      notes: '',
      addedAt: '2026-07-01T09:00:00.000Z',
      startedAt: '2026-07-01T09:00:00.000Z',
      lastUpdatedAt: '2026-07-01T09:00:00.000Z',
    })
    const catalog = await new CatalogRepository(database).read()
    const start = catalog.readingEvents.find(({ kind }) => kind === 'start')
    expect(start).toEqual(expect.objectContaining({ kind: 'start', timeConfidence: 0.5 }))
    expect(catalog.progressSnapshots[0]).toEqual(
      expect.objectContaining({ status: 'reading', normalizedProgress: 0.25 }),
    )
    await database.close()
  })

  test('preserves future-unknown fields in immutable source evidence and recovery data', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const storage = new MemoryStorage({
      'wovenleaf.library.v1': futureFieldsLegacyLibrary,
    })

    await migrateLegacyLibrary(database, storage, { now: () => migrationTime })

    const catalog = await new CatalogRepository(database).read()
    expect(catalog.sourceRecords[0].rawPayload).toEqual(
      expect.objectContaining({
        futureReadingMood: { value: 'contemplative', confidence: 0.8 },
      }),
    )
    expect((await createLegacyLibraryRecoveryFile(database, storage))?.contents).toBe(
      futureFieldsLegacyLibrary,
    )
    await database.close()
  })

  test('keeps malformed input untouched and exportable with recovery guidance', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const storage = new MemoryStorage({
      'bookmanager.library.v1': malformedLegacyLibrary,
    })

    const result = await migrateLegacyLibrary(database, storage, { now: () => migrationTime })

    expect(result.status).toBe('recovery-required')
    if (result.status !== 'recovery-required') throw new Error('Expected recovery guidance')
    expect(result.message).toContain('No legacy data was deleted')
    expect(result.message).toContain('Download the recovery copy')
    expect(storage.getItem('bookmanager.library.v1')).toBe(malformedLegacyLibrary)
    expect(await new LibraryRepository(database).list()).toEqual([])
    expect((await new CatalogRepository(database).read()).works).toEqual([])
    expect(await database.query('SELECT status FROM legacy_library_migrations')).toEqual([
      { status: 'failed' },
    ])
    expect((await createLegacyLibraryRecoveryFile(database, storage))?.contents).toBe(
      malformedLegacyLibrary,
    )
    await database.close()
  })

  test('accepts a repaired source after failure while retaining the malformed recovery version', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const storage = new MemoryStorage({
      'bookmanager.library.v1': malformedLegacyLibrary,
    })
    await migrateLegacyLibrary(database, storage, { now: () => migrationTime })
    storage.setItem('bookmanager.library.v1', missingFieldsLegacyLibrary)

    const result = await migrateLegacyLibrary(database, storage, { now: () => migrationTime })

    expect(result.status).toBe('migrated')
    expect(await new LibraryRepository(database).list()).toHaveLength(1)
    const recovery = await createLegacyLibraryRecoveryFile(database, storage)
    expect(recovery?.filename).toBe('wovenleaf-legacy-library-recovery.json')
    const recoverySources = JSON.parse(recovery?.contents ?? '{}').sources
    expect(recoverySources).toEqual(
      expect.arrayContaining([
        { key: 'bookmanager.library.v1', raw: malformedLegacyLibrary },
        { key: 'bookmanager.library.v1', raw: missingFieldsLegacyLibrary },
      ]),
    )
    await database.close()
  })

  test('resumes after verified cleanup failure without duplicating imported records', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const storage = new MemoryStorage(
      { 'bookmanager.library.v1': currentLegacyLibrary },
      { failRemoveCount: 1 },
    )

    const interrupted = await migrateLegacyLibrary(database, storage, { now: () => migrationTime })
    expect(interrupted.status).toBe('recovery-required')
    expect(await database.query('SELECT status FROM legacy_library_migrations')).toEqual([
      { status: 'verified' },
    ])

    const resumed = await migrateLegacyLibrary(database, storage, { now: () => migrationTime })

    expect(resumed.status).toBe('already-migrated')
    const catalog = await new CatalogRepository(database).read()
    expect(catalog.works).toHaveLength(2)
    expect(catalog.editions).toHaveLength(2)
    expect(catalog.listEntries).toHaveLength(2)
    expect(await new LibraryRepository(database).list()).toHaveLength(2)
    expect(await database.query('SELECT status FROM legacy_library_migrations')).toEqual([
      { status: 'completed' },
    ])
    await database.close()
  })

  test('rolls back a failed SQLite import and retries the same checkpoint safely', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await database.execute(`
      CREATE TRIGGER interrupt_legacy_import
      BEFORE INSERT ON editions
      BEGIN
        SELECT RAISE(ABORT, 'simulated legacy interruption');
      END;
    `)
    const storage = new MemoryStorage({ 'bookmanager.library.v1': currentLegacyLibrary })

    const interrupted = await migrateLegacyLibrary(database, storage, { now: () => migrationTime })

    expect(interrupted.status).toBe('recovery-required')
    expect((await new CatalogRepository(database).read()).works).toEqual([])
    expect(await new LibraryRepository(database).list()).toEqual([])
    expect(storage.getItem('bookmanager.library.v1')).toBe(currentLegacyLibrary)
    await database.execute('DROP TRIGGER interrupt_legacy_import;')

    const retried = await migrateLegacyLibrary(database, storage, { now: () => migrationTime })

    expect(retried.status).toBe('migrated')
    expect((await new CatalogRepository(database).read()).works).toHaveLength(2)
    expect(await new LibraryRepository(database).list()).toHaveLength(2)
    await database.close()
  })

  test('refuses to choose between divergent legacy aliases', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const storage = new MemoryStorage({
      'wovenleaf.library.v1': currentLegacyLibrary,
      'bookmanager.library.v1': futureFieldsLegacyLibrary,
    })

    const result = await migrateLegacyLibrary(database, storage, { now: () => migrationTime })

    expect(result.status).toBe('recovery-required')
    expect(storage.getItem('wovenleaf.library.v1')).toBe(currentLegacyLibrary)
    expect(storage.getItem('bookmanager.library.v1')).toBe(futureFieldsLegacyLibrary)
    const recovery = await createLegacyLibraryRecoveryFile(database, storage)
    expect(recovery?.filename).toBe('wovenleaf-legacy-library-recovery.json')
    expect(recovery?.contents).toContain('wovenleaf.library.v1')
    expect(recovery?.contents).toContain('bookmanager.library.v1')
    await database.close()
  })
})

class MemoryStorage implements LegacyLibraryStorage {
  readonly #values: Map<string, string>
  #failRemoveCount: number

  constructor(
    values: Readonly<Record<string, string>> = {},
    options: { readonly failRemoveCount?: number } = {},
  ) {
    this.#values = new Map(Object.entries(values))
    this.#failRemoveCount = options.failRemoveCount ?? 0
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
  }

  removeItem(key: string): void {
    if (this.#failRemoveCount > 0) {
      this.#failRemoveCount -= 1
      throw new Error('simulated archive failure')
    }
    this.#values.delete(key)
  }
}
