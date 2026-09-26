import { expect, test } from 'bun:test'
import { deriveReadingState, readingEventSchema } from '../src/domain/catalog'
import { nativeReaderEventSchema, type NativeReaderEvent } from '../src/reader/model'
import { EpubReaderRepository } from '../src/reader/repository'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { migrateStorage } from '../src/storage/migrations'
import { PortableArchiveService } from '../src/storage/portable-archive'
import { fixtureIds, representativeCatalog } from './fixtures/catalog'
import { BunSqliteDatabase } from './storage-test-database'

const start = Date.parse('2026-04-01T00:00:00.000Z')
function interval(sequence: number, offset = sequence * 10_000): NativeReaderEvent {
  return nativeReaderEventSchema.parse({
    id: `reading-event:reader:active-${sequence}`, sequence,
    bookId: 'book:active-time', editionId: fixtureIds.editions.leftHandEbook,
    assetId: fixtureIds.assets.leftHandEpub, assetFingerprint: 'a'.repeat(64),
    sessionId: `reading-session:reader:active-${sequence}`, kind: 'session', platform: 'ios', toolkitVersion: '3.11.0',
    emittedAt: new Date(start + offset + 10_000).toISOString(),
    startedAt: new Date(start + offset).toISOString(), endedAt: new Date(start + offset + 10_000).toISOString(),
    activeDurationMs: 10_000,
    activeCapture: { kind: 'epub-foreground', version: 1, captureId: 'capture:test', intervalIndex: sequence,
      startReason: sequence === 1 ? 'open' : 'checkpoint', endReason: 'checkpoint' },
    locator: { href: 'chapter.xhtml', type: 'application/xhtml+xml', locations: { totalProgression: sequence / 10 } },
  })
}

async function database() {
  const db = new BunSqliteDatabase()
  await migrateStorage(db)
  await new CatalogRepository(db).replace(representativeCatalog)
  return db
}

test('late, duplicated outbox intervals survive without regressing the newer resume checkpoint', async () => {
  const db = await database()
  const reader = new EpubReaderRepository(db)
  expect(await reader.ingest(interval(2))).toBe('applied')
  expect(await reader.ingest(interval(1))).toBe('applied')
  expect(await reader.ingest(interval(1))).toBe('duplicate')
  const events = (await new CatalogRepository(db).read()).readingEvents.filter(e => e.id.includes('reader:active-'))
  expect(events).toHaveLength(2)
  const state = deriveReadingState(fixtureIds.editions.leftHandEbook, events)
  expect(state.sessions.reduce((sum, s) => sum + s.activeDurationMs, 0)).toBe(20_000)
  expect(state.sessions[0]?.activeCapture?.version).toBe(1)
  expect((await reader.checkpointForBook('book:active-time'))?.locator?.locations.totalProgression).toBe(0.2)
  await db.close()
})

test('exact quarter-boundary timestamps and capture provenance survive private archive restore', async () => {
  const db = await database()
  await new EpubReaderRepository(db).ingest(interval(1, -5_000))
  const archive = await new PortableArchiveService(db).create({ createdAt: '2026-04-04T12:00:00.000Z' })
  const target = new BunSqliteDatabase()
  await migrateStorage(target)
  await new PortableArchiveService(target).restore(archive.archive)
  const restored = (await new CatalogRepository(target).read()).readingEvents.find(e => e.id === 'reading-event:reader:active-1')!
  expect(restored).toMatchObject({ startedAt: '2026-03-31T23:59:55.000Z', endedAt: '2026-04-01T00:00:05.000Z',
    activeDurationMs: 10_000, activeCapture: { version: 1, intervalIndex: 1 } })
  await target.close()
  await db.close()
})

test('historical duration stays unversioned and unknown capture versions cannot masquerade as reliable', () => {
  const current = interval(1)
  const old = { ...current, activeCapture: undefined, activeDurationMs: 3600_000 }
  expect(nativeReaderEventSchema.parse(old)).not.toHaveProperty('activeCapture', expect.anything())
  expect(nativeReaderEventSchema.safeParse({ ...current, activeCapture: { version: 2 } }).success).toBe(false)
  expect(nativeReaderEventSchema.safeParse({ ...current, activeDurationMs: 5000 }).success).toBe(false)
  expect(nativeReaderEventSchema.safeParse({ ...current, startedAt: undefined }).success).toBe(false)
})

test('ledger and correction replacements reject falsely labelled exact intervals', () => {
  const native = interval(1)
  if (native.kind !== 'session') throw new Error('fixture')
  const event = { ...native, deviceId: 'reading-device:ios:readium', source: { kind: 'local', method: 'epub-reader' },
    observedAt: native.emittedAt, effectiveAt: native.emittedAt, recordedAt: native.emittedAt, timeConfidence: 1 }
  expect(readingEventSchema.safeParse(event).success).toBe(true)
  expect(readingEventSchema.safeParse({ ...event, activeDurationMs: 9000 }).success).toBe(false)
  expect(readingEventSchema.safeParse({ ...event, kind: 'correction', targetEventIds: ['reading-event:old'],
    reason: 'test', action: { kind: 'replace', replacement: { ...event, activeDurationMs: 9000 } } }).success).toBe(false)
})


test('a checkpoint write failure can replay the already-committed interval exactly once', async () => {
  const db = await database()
  const originalRun = db.run.bind(db)
  let fail = true
  db.run = async (statement, values) => {
    if (fail && statement.includes('INSERT INTO epub_reader_checkpoints')) {
      fail = false
      throw new Error('simulated checkpoint failure')
    }
    return originalRun(statement, values)
  }
  const reader = new EpubReaderRepository(db)
  await expect(reader.ingest(interval(1))).rejects.toThrow('simulated checkpoint failure')
  expect(await reader.ingest(interval(1))).toBe('duplicate')
  const events = (await new CatalogRepository(db).read()).readingEvents.filter(e => e.id.includes('reader:active-'))
  expect(events).toHaveLength(1)
  expect((await reader.checkpointForBook('book:active-time'))?.lastSequence).toBe(1)
  await db.close()
})
