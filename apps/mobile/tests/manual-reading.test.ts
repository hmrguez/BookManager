import { expect, test } from 'bun:test'
import { deriveReadingState, type ReadingEvent } from '../src/domain/catalog'
import type { LibraryBook } from '../src/library-model'
import { LibraryRepository } from '../src/storage/library-repository'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { finishPayload } from '../src/storage/manual-reading'
import { migrateStorage } from '../src/storage/migrations'
import { BunSqliteDatabase } from './storage-test-database'

const book: LibraryBook = { id: 'manual-history', title: 'A reader’s book', authors: ['Someone'],
  shelf: 'reading', progress: 42, currentPage: 42, pageCount: 100, rating: 0, notes: '',
  addedAt: '2026-03-01T12:00:00.000Z', startedAt: '2026-03-10T12:00:00.000Z', lastUpdatedAt: '2026-03-10T12:00:00.000Z' }
const finish = (before: LibraryBook, at = '2026-04-02T12:00:00.000Z'): LibraryBook =>
  ({ ...before, shelf: 'finished', progress: 100, currentPage: 100, finishedAt: at, lastUpdatedAt: at })
async function setup() {
  const db = new BunSqliteDatabase()
  await migrateStorage(db)
  const library = new LibraryRepository(db)
  await library.save(book)
  const catalog = new CatalogRepository(db)
  const current = async () => (await library.list())[0]!
  return { db, library, catalog, current }
}
function activeFinishes(events: ReadingEvent[]) {
  const state = deriveReadingState(events[0]!.editionId, events)
  return events.filter((event) => state.appliedEventIds.includes(event.id) && finishPayload(event))
}

test('finish, correction across quarters, retry, and undo retain original evidence', async () => {
  const { db, library, catalog, current } = await setup()
  await library.saveManual(book, finish(book), { id: 'finish' })
  const completed = await current()
  const corrected = { ...completed, finishedAt: '2026-03-31T12:00:00.000Z', lastUpdatedAt: '2026-04-03T12:00:00.000Z' }
  await library.saveManual(completed, corrected, { id: 'date' })
  await library.saveManual(book, finish(book), { id: 'finish' })
  expect((await current()).finishedAt).toBe(corrected.finishedAt)
  const stored = await catalog.read()
  expect(stored.readingEvents).toHaveLength(2)
  expect(activeFinishes(stored.readingEvents).map(({ effectiveAt }) => effectiveAt)).toEqual([corrected.finishedAt])
  expect(stored.progressSnapshots[0]?.finishedAt).toBe(corrected.finishedAt)
  await library.saveManual(await current(), { ...completed, lastUpdatedAt: '2026-04-04T12:00:00.000Z' }, { id: 'undo-date', undoOf: 'date' })
  expect(activeFinishes((await catalog.read()).readingEvents).map(({ effectiveAt }) => effectiveAt)).toEqual([completed.finishedAt!])
  await db.close()
})

test('a genuine reread retains both finishes while unfinish removes only the current finish', async () => {
  const { db, library, catalog, current } = await setup()
  await library.saveManual(book, finish(book), { id: 'first' })
  const first = await current()
  const reread = { ...first, shelf: 'reading' as const, progress: 0, currentPage: 0, finishedAt: undefined,
    startedAt: '2026-05-01T12:00:00.000Z', lastUpdatedAt: '2026-05-01T12:00:00.000Z' }
  await library.saveManual(first, reread, { id: 'reread', reread: true })
  await library.saveManual(await current(), finish(reread, '2026-06-01T12:00:00.000Z'), { id: 'second' })
  expect(activeFinishes((await catalog.read()).readingEvents)).toHaveLength(2)
  const second = await current()
  await library.saveManual(second, { ...second, shelf: 'reading', finishedAt: undefined, lastUpdatedAt: '2026-06-02T12:00:00.000Z' }, { id: 'unfinish' })
  expect(activeFinishes((await catalog.read()).readingEvents).map(({ effectiveAt }) => effectiveAt)).toEqual([first.finishedAt!])
  expect((await catalog.read()).readingEvents).toHaveLength(5)
  await db.close()
})

test('transaction failure rolls back all evidence and can be retried exactly once', async () => {
  const { db, library, catalog, current } = await setup()
  await db.execute(`CREATE TRIGGER interrupt_manual BEFORE UPDATE ON library_books BEGIN SELECT RAISE(ABORT, 'interrupted'); END;`)
  await expect(library.saveManual(book, finish(book), { id: 'crash' })).rejects.toThrow('interrupted')
  expect((await catalog.read()).readingEvents).toHaveLength(0)
  expect((await catalog.read()).editions).toHaveLength(0)
  expect(await current()).toEqual(book)
  await db.execute('DROP TRIGGER interrupt_manual')
  await library.saveManual(book, finish(book), { id: 'crash' })
  await library.saveManual(book, finish(book), { id: 'crash' })
  expect((await catalog.read()).readingEvents).toHaveLength(1)
  await db.close()
})

test('stale undo cannot erase a later correction and progress alone creates no completion', async () => {
  const { db, library, catalog, current } = await setup()
  await library.save({ ...book, progress: 100, currentPage: 100 })
  expect((await catalog.read()).readingEvents).toHaveLength(0)
  const before = await current()
  await library.saveManual(before, finish(before), { id: 'finish' })
  const completed = await current()
  await library.saveManual(completed, { ...completed, finishedAt: '2026-04-01T12:00:00.000Z', lastUpdatedAt: '2026-04-03T12:00:00.000Z' }, { id: 'correct' })
  await expect(library.saveManual(await current(), { ...book, lastUpdatedAt: '2026-04-04T12:00:00.000Z' }, { id: 'stale', undoOf: 'finish' })).rejects.toThrow('later reading change')
  expect(activeFinishes((await catalog.read()).readingEvents)).toHaveLength(1)
  await db.close()
})

test('successive corrections replace one finish; undo restores the prior correction', async () => {
  const { db, library, catalog, current } = await setup()
  await library.saveManual(book, finish(book), { id: 'finish' })
  for (const day of ['03', '04']) {
    const before = await current()
    await library.saveManual(before, { ...before, finishedAt: `2026-03-${day}T12:00:00.000Z`, lastUpdatedAt: `2026-04-${day}T12:00:00.000Z` }, { id: `date-${day}` })
  }
  expect(activeFinishes((await catalog.read()).readingEvents).map(({ effectiveAt }) => effectiveAt)).toEqual(['2026-03-04T12:00:00.000Z'])
  const before = await current()
  await library.saveManual(before, { ...before, finishedAt: '2026-03-03T12:00:00.000Z', lastUpdatedAt: '2026-04-05T12:00:00.000Z' }, { id: 'undo-second', undoOf: 'date-04' })
  expect(activeFinishes((await catalog.read()).readingEvents).map(({ effectiveAt }) => effectiveAt)).toEqual(['2026-03-03T12:00:00.000Z'])
  await db.close()
})

test('correcting a finish before a captured start does not silently turn completion into reading', async () => {
  const { db, library, catalog, current } = await setup()
  await library.saveManual(book, finish(book), { id: 'first' })
  const completed = await current()
  await library.saveManual(completed, { ...completed, shelf: 'reading', progress: 0, currentPage: 0, finishedAt: undefined,
    startedAt: '2026-07-01T12:00:00.000Z', lastUpdatedAt: '2026-07-01T12:00:00.000Z' }, { id: 'reread', reread: true })
  const reading = await current()
  await library.saveManual(reading, finish(reading, '2026-07-02T12:00:00.000Z'), { id: 'second' })
  const second = await current()
  await library.saveManual(second, { ...second, finishedAt: '2026-06-30T12:00:00.000Z', lastUpdatedAt: '2026-07-03T12:00:00.000Z' }, { id: 'date' })
  expect((await catalog.read()).progressSnapshots[0]?.status).toBe('finished')
  expect((await catalog.read()).progressSnapshots[0]?.finishedAt).toBe('2026-06-30T12:00:00.000Z')
  await db.close()
})

test('cross-edition finishes keep canonical Work identity and native positions', async () => {
  const { representativeCatalog, fixtureIds } = await import('./fixtures/catalog')
  const { db, library, catalog } = await setup()
  await catalog.replace(representativeCatalog)
  for (const [index, editionId] of [fixtureIds.editions.leftHandEbook, fixtureIds.editions.leftHandAudio].entries()) {
    const before = { ...book, id: `format-${index}`, readingEditionId: editionId }
    await library.save(before)
    await library.saveManual(before, finish(before, '2026-09-01T12:00:00.000Z'), { id: `format-${index}` })
  }
  const result = await catalog.read()
  const finishes = result.readingEvents.filter((event) => event.kind === 'finish')
  expect(finishes).toHaveLength(2)
  expect(new Set(finishes.map((event) => result.editions.find(({ id }) => id === event.editionId)?.workId))).toEqual(new Set([fixtureIds.works.leftHand]))
  const ebook = finishes.find((event) => event.editionId === fixtureIds.editions.leftHandEbook)!
  expect(ebook.kind === 'finish' && ebook.position.locator.kind).toBe('epub')
  expect(result.editions).toHaveLength(representativeCatalog.editions.length)
  await db.close()
})

test('inferred imported date stays uncertain until an explicit confirmation, retaining provenance', async () => {
  const { readingEventSchema } = await import('../src/domain/catalog')
  const { db, library, catalog, current } = await setup()
  await library.saveManual(book, finish(book), { id: 'seed' })
  const stored = await catalog.read()
  const old = readingEventSchema.parse({ ...stored.readingEvents[0], id: 'reading-event:imported:undated',
    source: { kind: 'migration', migrationKey: 'legacy:user' }, timeConfidence: 0.2 })
  await catalog.replace({ ...stored, readingEvents: [old], progressSnapshots: [] })
  const before = await current()
  await library.save({ ...before, notes: 'An unrelated edit' })
  expect((await catalog.read()).readingEvents).toEqual([old])
  await library.saveManual(await current(), { ...before, lastUpdatedAt: '2026-04-03T12:00:00.000Z' }, { id: 'confirmed', confirmFinish: true })
  const events = (await catalog.read()).readingEvents
  expect(events.find(({ id }) => id === old.id)).toEqual(old)
  expect(activeFinishes(events)).toMatchObject([{ kind: 'correction', timeConfidence: 1, source: { kind: 'local', method: 'manual' } }])
  await db.close()
})

test('private portable restore retains manual evidence, corrections and edition association', async () => {
  const { PortableArchiveService } = await import('../src/storage/portable-archive')
  const { db, library, catalog, current } = await setup()
  await library.saveManual(book, finish(book), { id: 'finish' })
  const before = await current()
  await library.saveManual(before, { ...before, finishedAt: '2026-03-31T12:00:00.000Z', lastUpdatedAt: '2026-04-03T12:00:00.000Z' }, { id: 'date' })
  const archive = await new PortableArchiveService(db).create({ createdAt: '2026-04-04T12:00:00.000Z' })
  const target = new BunSqliteDatabase()
  await migrateStorage(target)
  await new PortableArchiveService(target).restore(archive.archive)
  expect(await new LibraryRepository(target).list()).toEqual(await library.list())
  expect((await new CatalogRepository(target).read()).readingEvents).toEqual((await catalog.read()).readingEvents)
  await target.close()
  await db.close()
})

test('shelf-only changes can be undone without inventing activity; later progress is protected', async () => {
  const { db, library, current } = await setup()
  await library.save({ ...book, shelf: 'tbr' })
  const before = await current()
  const next = { ...before, shelf: 'next' as const, lastUpdatedAt: '2026-04-01T12:00:00.000Z' }
  await library.saveManual(before, next, { id: 'queue' })
  await library.saveManual(await current(), { ...before, lastUpdatedAt: '2026-04-02T12:00:00.000Z' }, { id: 'undo-queue', undoOf: 'queue' })
  expect((await current()).shelf).toBe('tbr')
  const start = await current()
  await library.saveManual(start, { ...start, shelf: 'reading', lastUpdatedAt: '2026-04-03T12:00:00.000Z' }, { id: 'start' })
  await library.saveEdits(await current(), { ...await current(), progress: 80, currentPage: 80 })
  await expect(library.saveManual(await current(), { ...start, lastUpdatedAt: '2026-04-04T12:00:00.000Z' },
    { id: 'undo-start', undoOf: 'start', undoProgress: { progress: 42, currentPage: 42 } })).rejects.toThrow('later reading change')
  await db.close()
})

test('an unrelated queued edit cannot resurrect a failed finish or erase the edition link', async () => {
  const { db, library, current } = await setup()
  const failedOptimisticFinish = finish(book)
  await library.saveEdits(failedOptimisticFinish, { ...failedOptimisticFinish, notes: 'Kept note' })
  expect((await current()).shelf).toBe('reading')
  const before = await current()
  await library.saveManual(before, finish(before), { id: 'finish' })
  const editionId = (await current()).readingEditionId
  await library.saveEdits(failedOptimisticFinish, { ...failedOptimisticFinish, notes: 'Later note' })
  expect((await current()).readingEditionId).toBe(editionId)
  expect((await current()).notes).toBe('Later note')
  await db.close()
})

test('a later genuine reread stays open even when the previous finish was corrected to a later effective date', async () => {
  const { db, library, catalog, current } = await setup()
  await library.saveManual(book, finish(book), { id: 'finish' })
  const before = await current()
  await library.saveManual(before, { ...before, finishedAt: '2026-04-20T12:00:00.000Z', lastUpdatedAt: '2026-04-03T12:00:00.000Z' }, { id: 'date' })
  const corrected = await current()
  await library.saveManual(corrected, { ...corrected, shelf: 'reading', progress: 0, currentPage: 0,
    finishedAt: undefined, startedAt: '2026-04-10T12:00:00.000Z', lastUpdatedAt: '2026-04-10T12:00:00.000Z' }, { id: 'reread', reread: true })
  expect((await catalog.read()).progressSnapshots[0]?.status).toBe('reading')
  await db.close()
})
