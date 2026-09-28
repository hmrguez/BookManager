import { PrivateErasureService } from '../src/storage/private-erasure'
import { RecoveryService } from '../src/storage/recovery'
import { MemoryRecoveryArtifactStore } from '../src/storage/recovery-store'
import { expect, test } from 'bun:test'
import JSZip from 'jszip'
import { inspectEpub } from '../src/epub/inspect'
import { EpubImportRepository } from '../src/epub/repository'
import { EpubReaderRepository } from '../src/reader/repository'
import { nativeReaderEventSchema } from '../src/reader/model'
import { attachMissingMetadata } from '../src/libby/enrichment-model'
import { providerBookVariantSchema } from '../src/metadata/model'
import { LibraryRepository } from '../src/storage/library-repository'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { PortableArchiveService } from '../src/storage/portable-archive'
import { migrateStorage } from '../src/storage/migrations'
import { QuarterlyReviewRepository } from '../src/reviews/repository'
import { reviewQuarter } from '../src/reviews/calendar'
import { BunSqliteDatabase } from './storage-test-database'

const at = '2026-04-01T12:00:00.000Z'
const request = { quarter: reviewQuarter(2026, 2, 'UTC'), knownAt: '2026-10-01T12:00:00.000Z' }
async function epub() {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml" /></rootfiles></container>')
  zip.file('book.opf', `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="id">
    <metadata><dc:identifier id="id">urn:review:test</dc:identifier><dc:title>A quarter of stories</dc:title><dc:creator>Reader</dc:creator><dc:language>en</dc:language>
    <dc:subject>Fiction, fantasy, general</dc:subject><dc:subject>Fiction, fantasy, general</dc:subject><dc:subject> </dc:subject></metadata>
    <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="chapter" /></spine></package>`)
  zip.file('chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Story</p></body></html>')
  return inspectEpub(await zip.generateAsync({ type: 'uint8array' }), { fileName: 'book.epub' })
}

async function setup() {
  const database = new BunSqliteDatabase(); await migrateStorage(database)
  const inspection = await epub()
  const imported = await new EpubImportRepository(database, { now: () => new Date(at) }).commit({ originalName: 'book.epub', inspection, contentRelativePath: 'books/test.epub' })
  const library = new LibraryRepository(database)
  const current = async () => (await library.list())[0]!
  const before = await current()
  await library.saveManual(before, { ...before, shelf: 'finished', progress: 100, finishedAt: at, lastUpdatedAt: at }, { id: 'finish' })
  return { database, inspection, imported, library, current, repository: new QuarterlyReviewRepository(database) }
}

test('real EPUB import, manual ledger finish, embedded claims and shared provider enrichment reach the engine offline', async () => {
  const ctx = await setup()
  expect(ctx.inspection.subjects).toEqual(['Fiction, fantasy, general'])
  const first = await ctx.repository.calculate(request)
  expect(first.metrics['01']?.value).toBe(1)
  expect(first.genre.suggested).toBe('fantasy')
  expect(first.genre.classifications[0]?.evidence.claims[0]).toMatchObject({ provider: 'embedded-epub', scope: 'edition', values: ['Fiction, fantasy, general'] })
  const candidate = providerBookVariantSchema.parse({ id: 'open-library:test', provider: 'open-library', providerName: 'Open Library', externalKey: 'OL1W', workKey: 'OL1W',
    title: 'A quarter of stories', workTitle: 'A quarter of stories', authors: ['Reader'], identifiers: [], confidence: 1, providerRank: 0, observedAt: at,
    subjects: [{ scope: 'work', sourceKey: 'OL1W', values: ['Fiction, romance, general'] }] })
  await ctx.library.save(attachMissingMetadata(await ctx.current(), candidate))
  const disagreement = await ctx.repository.calculate(request)
  expect(disagreement.genre.suggested).toBeNull()
  expect(disagreement.genre.classifications[0]?.status).toBe('unresolved')
  await ctx.library.save({ ...await ctx.current(), subjectOverride: ['Mystery'] })
  expect((await ctx.repository.calculate(request)).genre.suggested).toBe('mystery')
  await ctx.database.close()
})

test('repaired native outbox slices are integrated without inflating replay and survive portable restore', async () => {
  const ctx = await setup()
  const reader = new EpubReaderRepository(ctx.database)
  for (let index = 0; index < 20; index++) {
    const start = Date.parse(at) + index * 30_000
    const event = nativeReaderEventSchema.parse({
      id: `reading-event:review-native:${index}`, sequence: index + 1, bookId: ctx.imported.bookId, editionId: ctx.imported.editionId,
      assetId: ctx.imported.assetId, assetFingerprint: ctx.inspection.contentHash,
      sessionId: `reading-session:review-native:${index}`, kind: 'session', platform: index % 2 ? 'android' : 'ios', toolkitVersion: 'test',
      emittedAt: new Date(start + 30_000).toISOString(), startedAt: new Date(start).toISOString(), endedAt: new Date(start + 30_000).toISOString(), activeDurationMs: 30_000,
      activeCapture: { kind: 'epub-foreground', version: 1, captureId: 'review:test', intervalIndex: index,
        startReason: index ? 'checkpoint' : 'open', endReason: index === 19 ? 'close' : 'checkpoint' },
      locator: { href: 'chapter.xhtml', type: 'application/xhtml+xml', locations: { totalProgression: 0.5 } },
    })
    expect(await reader.ingest(event)).toBe('applied'); expect(await reader.ingest(event)).toBe('duplicate')
  }
  const before = await ctx.repository.calculate(request)
  expect(before.metrics['28']?.value).toBe(10); expect(before.metrics['17']?.value).toBe(1)
  expect(before.metrics['11']?.value).toBe(1)
  expect(before.evidence.filter(e => e.capture !== null)).toHaveLength(20)
  const archive = await new PortableArchiveService(ctx.database).create({ createdAt: request.knownAt })
  const restored = new BunSqliteDatabase(); await migrateStorage(restored)
  await new PortableArchiveService(restored).restore(archive.archive)
  const after = await new QuarterlyReviewRepository(restored).calculate(request)
  expect(after).toEqual(before)
  await restored.close(); await ctx.database.close()
})

test('repository applies post-quarter corrections without losing original ledger evidence or mutating a previous result', async () => {
  const ctx = await setup()
  const saved = await ctx.repository.calculate(request)
  const before = await ctx.current()
  await ctx.library.saveManual(before, { ...before, finishedAt: '2026-03-31T12:00:00.000Z', lastUpdatedAt: '2026-08-01T00:00:00.000Z' }, { id: 'correct-date' })
  expect((await ctx.repository.calculate(request)).metrics['01']?.value).toBe(0)
  expect(saved.metrics['01']?.value).toBe(1)
  expect((await new CatalogRepository(ctx.database).read()).readingEvents).toHaveLength(2)
  await ctx.database.close()
})


test('private erasure removes an imported EPUB dependency graph and provider claims without affecting another book', async () => {
  const ctx = await setup()
  const other = { ...await ctx.current(), id: 'unrelated-book', title: 'Unrelated book', readingEditionId: undefined, manualReadingRevision: undefined, shelf: 'tbr' as const, finishedAt: undefined }
  await ctx.library.save(other)
  const recovery = new RecoveryService(ctx.database, { store: new MemoryRecoveryArtifactStore(), eraseOtherCopies: async () => {}, availableBytes: async () => 1e9 })
  const erasure = new PrivateErasureService(ctx.database, recovery)
  const preview = await erasure.preview(ctx.imported.bookId)
  expect(preview.books).toEqual(['A quarter of stories'])
  await erasure.erase(preview.token)
  expect((await ctx.library.list()).map(b => b.title)).toEqual(['Unrelated book'])
  expect(await ctx.database.query('PRAGMA foreign_key_check')).toEqual([])
  expect((await new CatalogRepository(ctx.database).read()).editions).toEqual([])
  expect((await new CatalogRepository(ctx.database).read()).sourceRecords).toEqual([])
  await ctx.database.close()
})
