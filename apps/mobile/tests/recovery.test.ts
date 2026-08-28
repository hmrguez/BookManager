import { describe, expect, test } from 'bun:test'
import { createStarterLibrary } from '../src/library-model'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage } from '../src/storage/migrations'
import { createPortableArchive } from '../src/storage/portable-archive'
import { RecoveryError, RecoveryService } from '../src/storage/recovery'
import { MemoryRecoveryArtifactStore } from '../src/storage/recovery-store'
import { representativeCatalog } from './fixtures/catalog'
import { BunSqliteDatabase } from './storage-test-database'

const originalTime = '2026-08-28T08:00:00.000Z'
const candidateTime = '2026-08-27T08:00:00.000Z'
const originalLibrary = createStarterLibrary(originalTime).slice(0, 3).map((book, index) => ({
  ...book,
  notes: index === 0 ? 'Private recovery drill note.' : book.notes,
}))
const restoredLibrary = originalLibrary.map((book, index) => index === 0
  ? { ...book, notes: 'Restored candidate note.', rating: 5 }
  : book)

describe('backup, restore, and recovery drills', () => {
  test('rotates three verified local points and emits a private support inventory', async () => {
    const database = await seededDatabase()
    const store = new MemoryRecoveryArtifactStore()
    let currentTime = Date.parse('2026-08-28T08:00:00.000Z')
    let sequence = 0
    const recovery = new RecoveryService(database, {
      store,
      now: () => {
        const date = new Date(currentTime)
        currentTime += 24 * 60 * 60 * 1_000
        return date
      },
      createId: (kind) => `${kind}:test:${++sequence}`,
      availableBytes: async () => Number.MAX_SAFE_INTEGER,
    })

    await recovery.createSnapshot('automatic')
    await recovery.createSnapshot('manual')
    await recovery.createSnapshot('manual')
    await recovery.createSnapshot('manual')

    const snapshots = await recovery.listSnapshots()
    expect(snapshots).toHaveLength(3)
    expect(snapshots.every(({ validation }) => validation.status !== 'invalid')).toBe(true)
    expect(snapshots.map(({ createdAt }) => createdAt)).toEqual([
      '2026-08-31T08:00:00.000Z',
      '2026-08-30T08:00:00.000Z',
      '2026-08-29T08:00:00.000Z',
    ])

    const report = await recovery.createSupportReport()
    expect(report.database.integrity).toBe('ok')
    expect(report.artifacts).toHaveLength(3)
    expect(JSON.stringify(report)).not.toContain('Private recovery drill note')
    expect(JSON.stringify(report)).not.toContain(originalLibrary[0].title)
    await database.close()
  })

  test('rejects stale, future, truncated, tampered, and missing-asset candidates without changing the last good library', async () => {
    const database = await seededDatabase()
    const store = new MemoryRecoveryArtifactStore()
    const recovery = recoveryAt(database, store, '2026-08-28T09:00:00.000Z')
    await recovery.createSnapshot('automatic')
    const valid = await createPortableArchive(representativeCatalog, restoredLibrary, {
      createdAt: candidateTime,
    })
    const future = parsedArchive(valid.archive)
    future.manifest.formatVersion = 99
    const tampered = parsedArchive(valid.archive)
    tampered.entries['data/library.json'] = tampered.entries['data/library.json'].slice(0, -12)
    const missingAsset = parsedArchive(valid.archive)
    missingAsset.manifest.assets = {
      records: 'included',
      contents: 'selected',
      includedIds: [representativeCatalog.assets[0].id],
    }
    const cases = [
      { code: 'stale', archive: valid.archive },
      { code: 'future-version', archive: JSON.stringify(future) },
      { code: 'truncated', archive: valid.archive.slice(0, -60) },
      { code: 'tampered', archive: JSON.stringify(tampered) },
      { code: 'missing-asset', archive: JSON.stringify(missingAsset) },
    ] as const

    for (const drill of cases) {
      const preview = await recovery.inspectArchive(drill.archive)
      expect(preview.validation.code).toBe(drill.code)
      await expect(recovery.restore(drill.archive)).rejects.toMatchObject({ code: drill.code })
      expect(await new LibraryRepository(database).list()).toEqual(originalLibrary)
    }
    await database.close()
  })

  test('stages a valid backup, swaps atomically, and rolls back after a failed restored launch', async () => {
    const database = await seededDatabase()
    const store = new MemoryRecoveryArtifactStore()
    const recovery = recoveryAt(database, store, '2026-08-28T09:00:00.000Z')
    await recovery.createSnapshot('automatic')
    const candidate = await createPortableArchive(representativeCatalog, restoredLibrary, {
      createdAt: candidateTime,
    })

    const result = await recovery.restore(candidate.archive, { allowStale: true })
    expect(result.pendingLaunchConfirmation).toBe(true)
    expect(await new LibraryRepository(database).list()).toEqual(restoredLibrary)
    expect(await store.readPendingRestore()).toMatchObject({
      rollbackArtifactId: result.rollbackArtifactId,
    })

    expect(await recovery.beginPendingLaunch()).toMatchObject({ status: 'testing-restored-library' })
    expect(await recovery.beginPendingLaunch()).toMatchObject({ status: 'rolled-back' })
    expect(await new LibraryRepository(database).list()).toEqual(originalLibrary)
    expect(await store.readPendingRestore()).toBeUndefined()
    expect(await store.read(result.rollbackArtifactId)).toBeDefined()
    await database.close()
  })

  test('fails a low-storage drill before staging or overwriting the current database', async () => {
    const database = await seededDatabase()
    const store = new MemoryRecoveryArtifactStore()
    const candidate = await createPortableArchive(representativeCatalog, restoredLibrary, {
      createdAt: originalTime,
    })
    const recovery = new RecoveryService(database, {
      store,
      now: () => new Date('2026-08-28T09:00:00.000Z'),
      createId: (kind) => `${kind}:low-storage`,
      availableBytes: async () => 32,
    })

    await expect(recovery.restore(candidate.archive)).rejects.toBeInstanceOf(RecoveryError)
    await expect(recovery.restore(candidate.archive)).rejects.toMatchObject({ code: 'low-storage' })
    expect(await new LibraryRepository(database).list()).toEqual(originalLibrary)
    expect(await store.list()).toEqual([])
    await database.close()
  })
})

async function seededDatabase(): Promise<BunSqliteDatabase> {
  const database = new BunSqliteDatabase()
  await migrateStorage(database)
  await new CatalogRepository(database).replace(representativeCatalog)
  await new LibraryRepository(database).replace(originalLibrary)
  return database
}

function recoveryAt(
  database: BunSqliteDatabase,
  store: MemoryRecoveryArtifactStore,
  timestamp: string,
): RecoveryService {
  let sequence = 0
  return new RecoveryService(database, {
    store,
    now: () => new Date(timestamp),
    createId: (kind) => `${kind}:test:${++sequence}`,
    availableBytes: async () => Number.MAX_SAFE_INTEGER,
  })
}

function parsedArchive(archive: string): {
  manifest: {
    formatVersion: number
    assets: { records: string; contents: string; includedIds: string[] }
  }
  entries: Record<string, string>
} {
  return JSON.parse(archive)
}
