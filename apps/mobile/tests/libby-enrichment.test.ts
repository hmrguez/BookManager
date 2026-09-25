import { describe, expect, test } from 'bun:test'
import { libraryBookSchema } from '../src/library-model'
import { LibbyRepository } from '../src/libby/repository'
import { LibbyEnrichment } from '../src/libby/enrichment'
import { attachMissingMetadata, exactEditionMatch } from '../src/libby/enrichment-model'
import { bookSubjectEvidence } from '../src/metadata/subjects'
import { providerBookVariantSchema, editionIdentifiers } from '../src/metadata/model'
import { OpenLibraryProvider } from '../src/metadata/open-library'
import { MetadataSearchService } from '../src/metadata/service'
import { ProviderTransport } from '../src/metadata/transport'
import { LibraryRepository } from '../src/storage/library-repository'
import { MetadataSearchCacheRepository } from '../src/storage/metadata-search-cache'
import { migrateStorage } from '../src/storage/migrations'
import { BunSqliteDatabase } from './storage-test-database'

const at = '2026-09-25T10:00:00.000Z'
const isbn = '9780156453806'
const variant = providerBookVariantSchema.parse({
  id: 'open-library:OL1M', provider: 'open-library', providerName: 'Open Library', externalKey: 'OL1M',
  workKey: 'OL1W', editionKey: 'OL1M', title: 'A quiet book', workTitle: 'A quiet book', authors: ['A. Reader'],
  identifiers: editionIdentifiers([isbn]), verifiedEditionIdentifiers: editionIdentifiers([isbn]),
  medium: 'ebook', pageCount: 900, editionPageCount: 200, thumbnail: 'https://covers.openlibrary.org/b/id/123-M.jpg?default=false', editionThumbnail: 'https://covers.openlibrary.org/b/id/123-M.jpg?default=false',
  subjects: [{ scope: 'work', sourceKey: 'OL1W', values: ['Fiction, fantasy, general'] }],
  confidence: 0.99, observedAt: at, providerRank: 0,
})
const observation = { titleId: '9780156453806', format: 'ebook', title: 'A quiet book', author: 'A. Reader', percent: 20 }
function snapshot(percent = 20, capturedAt = at) { return JSON.stringify({ kind: 'wovenleaf-libby', version: 1, id: crypto.randomUUID(), capturedAt, observations: [{ ...observation, percent }] }) }

async function setup(options: { existing?: boolean; exact?: boolean; fetch?: typeof fetch } = {}) {
  const db = new BunSqliteDatabase()
  await migrateStorage(db)
  let now = new Date(at)
  const clock = () => now
  const repo = new LibbyRepository(db, clock)
  const library = new LibraryRepository(db)
  if (options.existing) await library.save(libraryBookSchema.parse({ id: 'book:existing', title: observation.title,
    authors: [observation.author], identifiers: options.exact ? [isbn] : undefined, format: 'EBOOK',
    pageCount: 0, currentPage: 0, progress: 0, shelf: 'reading', notes: 'PRIVATE-NOTE', tags: ['PRIVATE-TAG'], rating: 3,
    addedAt: at, lastUpdatedAt: at }))
  await repo.configure(true, true, true)
  const calls: string[] = []
  const provider = new OpenLibraryProvider({ now: clock, transport: new ProviderTransport({ maxRetries: 0, sleep: async () => {}, fetch: options.fetch ?? Object.assign(async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return Response.json({ docs: [{ key: '/works/OL1W', title: observation.title, author_name: [observation.author], subject: ['Fiction, fantasy, general'], isbn: ['9780061054884'],
      editions: { docs: [{ key: '/books/OL1M', title: observation.title, isbn: [isbn], physical_format: 'ebook', number_of_pages: 200, cover_i: 123 }] } }] })
  }, { preconnect: () => {} }) }) })
  const metadata = new MetadataSearchService({ provider, cache: new MetadataSearchCacheRepository(db), now: clock })
  const worker = new LibbyEnrichment(repo, metadata)
  return { db, repo, library, worker, metadata, calls, clock, advance: (ms: number) => { now = new Date(now.getTime() + ms) } }
}

async function link(ctx: Awaited<ReturnType<typeof setup>>) {
  const state = await ctx.repo.ingest(snapshot())
  const book = (await ctx.library.list())[0]!
  if (!state.mappings.length) await ctx.repo.apply(state.items[0]!.key, state.items[0]!.snapshotId, book.id, book.lastUpdatedAt)
  return book
}

describe('Libby shared metadata enrichment', () => {
  test('auto-add commits before lookup; title matches require review and never attach an arbitrary edition', async () => {
    const ctx = await setup()
    const book = await link(ctx)
    expect(ctx.calls).toHaveLength(0)
    await Promise.all([ctx.worker.run('en'), ctx.worker.run('en')])
    expect(ctx.calls).toHaveLength(1)
    const url = new URL(ctx.calls[0]!)
    expect(url.searchParams.get('q')).toBe('title:"A quiet book" AND author:"A. Reader"')
    expect(url.searchParams.has('isbn')).toBe(false) // Libby title ID happens to be a valid ISBN: still not an ISBN.
    const job = (await ctx.repo.read()).enrichment[0]!
    expect(job.status).toBe('review')
    expect((await ctx.library.list())[0]!.metadataSelection).toBeUndefined()
    await ctx.repo.chooseEnrichment(job.id, job.candidates[0]!.id)
    const enriched = (await ctx.library.list())[0]!
    expect(enriched.id).toBe(book.id)
    expect(enriched.pageCount).toBe(0)
    expect(enriched.thumbnail).toBeUndefined()
    expect(enriched.metadataSelection?.variants[0]?.editionKey).toBeUndefined()
    expect(enriched.metadataSelection?.variants[0]?.identifiers).toEqual([])
    expect(bookSubjectEvidence(enriched).claims[0]).toMatchObject({ scope: 'work', sourceKey: 'OL1W', values: ['Fiction, fantasy, general'], provider: 'open-library', observedAt: at })
    await ctx.repo.ingest(snapshot(40, '2026-09-25T10:01:00.000Z'))
    expect((await ctx.library.list())[0]!.progress).toBe(40)
    ctx.advance(120_000)
    await ctx.worker.run('en')
    expect(ctx.calls).toHaveLength(1)
    expect(await ctx.library.list()).toHaveLength(1)
    await ctx.db.close()
  })

  test('verified compatible edition enriches manual link, preserves private fields and survives progress Undo', async () => {
    const ctx = await setup({ existing: true, exact: true })
    await link(ctx)
    const receipt = (await ctx.repo.read()).receipts[0]!
    await ctx.worker.run('en')
    let book = (await ctx.library.list())[0]!
    expect(book).toMatchObject({ id: 'book:existing', pageCount: 200, currentPage: 0, progress: 20, notes: 'PRIVATE-NOTE', tags: ['PRIVATE-TAG'], rating: 3, thumbnail: variant.thumbnail })
    expect(ctx.calls[0]).not.toContain('PRIVATE')
    expect(new URL(ctx.calls[0]!).searchParams.get('isbn')).toBe(isbn)
    expect((await ctx.repo.read()).enrichment[0]!.status).toBe('applied')
    await ctx.repo.undo(receipt.id)
    book = (await ctx.library.list())[0]!
    expect(book).toMatchObject({ progress: 0, pageCount: 200, thumbnail: variant.thumbnail })
    expect(bookSubjectEvidence(book).claims).toHaveLength(1)
    expect((await ctx.repo.read()).mappings[0]!.paused).toBe(true)
    await ctx.db.close()
  })

  test('enrichment cannot erase an intervening manual edit or blanket-bypass conflict guards', async () => {
    const ctx = await setup({ existing: true, exact: true })
    await link(ctx)
    const before = (await ctx.library.list())[0]!
    const receipt = (await ctx.repo.read()).receipts[0]!
    await ctx.library.save({ ...before, progress: 55, thumbnail: 'https://example.org/chosen.jpg', lastUpdatedAt: '2026-09-25T10:00:01.000Z' })
    await ctx.worker.run('en')
    expect((await ctx.library.list())[0]).toMatchObject({ progress: 55, thumbnail: 'https://example.org/chosen.jpg' })
    await expect(ctx.repo.undo(receipt.id)).rejects.toThrow('newer progress')
    expect((await ctx.repo.ingest(snapshot(60, '2026-09-25T10:02:00.000Z'))).items[0]!.reason).toContain('changed')
    await ctx.db.close()
  })

  test('format mismatch, work ISBN unions and explicit empty overrides never become edition facts', () => {
    const book = libraryBookSchema.parse({ id: 'x', title: observation.title, authors: [observation.author], identifiers: [isbn], format: 'AUDIOBOOK', pageCount: 0,
      shelf: 'reading', currentPage: 0, progress: 0, rating: 0, notes: '', addedAt: at, lastUpdatedAt: at })
    expect(exactEditionMatch(book, variant)).toBe(false)
    const attached = attachMissingMetadata(book, variant)
    expect(attached.pageCount).toBe(0)
    expect(attached.metadataSelection?.variants[0]?.editionKey).toBeUndefined()
    expect(exactEditionMatch({ ...book, format: 'EBOOK' }, { ...variant, verifiedEditionIdentifiers: [] })).toBe(false)
    const locked = attachMissingMetadata({ ...book, format: 'EBOOK', metadataLocks: ['pageCount', 'thumbnail'], subjectOverride: null }, variant)
    expect(locked.pageCount).toBe(0)
    expect(locked.thumbnail).toBeUndefined()
    expect(bookSubjectEvidence(locked)).toEqual({ override: null, claims: [] })
    expect(locked.metadataSelection?.variants[0]?.subjects).toEqual(variant.subjects)
  })

  test('offline retries are durable, capped and independent from progress, then resume with the shared cache', async () => {
    let offline = true
    const ctx = await setup({ existing: true, fetch: Object.assign(async () => {
      if (offline) throw new Error('offline')
      return Response.json({ docs: [] })
    }, { preconnect: () => {} }) })
    await link(ctx)
    await ctx.worker.run('en')
    expect((await ctx.repo.read()).enrichment[0]).toMatchObject({ status: 'retry', attempts: 1 })
    await ctx.repo.ingest(snapshot(30, '2026-09-25T10:01:00.000Z'))
    expect((await ctx.library.list())[0]!.progress).toBe(30)
    await ctx.worker.run('en')
    expect((await ctx.repo.read()).enrichment[0]!.attempts).toBe(1)
    offline = false
    ctx.advance(3_600_001)
    const reopened = new LibbyEnrichment(new LibbyRepository(ctx.db, ctx.clock), ctx.metadata)
    await reopened.run('en')
    expect((await ctx.repo.read()).enrichment[0]).toMatchObject({ status: 'no-match', attempts: 2 })
    ctx.advance(86_400_000)
    await reopened.run('en')
    expect((await ctx.repo.read()).enrichment[0]!.attempts).toBe(2)
    await ctx.db.close()
  })

  test('bounded legacy backfill shares positive cache; stale identity, disconnect and unlink reject in-flight results', async () => {
    const ctx = await setup({ existing: true })
    const original = (await ctx.library.list())[0]!
    for (let i = 0; i < 5; i++) await ctx.library.save({ ...original, id: `legacy:${i}`, sourceNames: ['Libby'] })
    await ctx.worker.run('en')
    expect((await ctx.repo.read()).enrichment.filter(job => job.status === 'review')).toHaveLength(3)
    expect(ctx.calls).toHaveLength(1)
    ctx.advance(60_001)
    await ctx.worker.run('en')
    expect((await ctx.repo.read()).enrichment.filter(job => job.status === 'review')).toHaveLength(5)
    expect(ctx.calls).toHaveLength(1)
    const job = (await ctx.repo.read()).enrichment[0]!
    await ctx.library.save({ ...original, id: job.bookId, title: 'Different work' })
    await expect(ctx.repo.chooseEnrichment(job.id, job.candidates[0]!.id)).rejects.toThrow('changed')
    await ctx.repo.configure(false, false)
    await ctx.repo.finishEnrichment(job.id, [variant], true)
    expect((await ctx.repo.read()).enrichment).toEqual([])
    await ctx.repo.configure(true, true, true)
    await link(ctx)
    ctx.advance(60_001)
    const batch = await ctx.repo.prepareEnrichment()
    await ctx.repo.unlink('ebook:9780156453806')
    for (const { job: pending } of batch) await ctx.repo.finishEnrichment(pending.id, [variant], true)
    expect((await ctx.library.list()).find(book => book.id === original.id)?.metadataSelection).toBeUndefined()
    await ctx.db.close()
  })

  test('failure committing enrichment rolls back metadata, baseline and Undo; lease can retry after restart', async () => {
    const ctx = await setup({ existing: true, exact: true })
    await link(ctx)
    const before = await ctx.repo.read()
    await ctx.db.execute("CREATE TRIGGER reject_enrichment BEFORE UPDATE ON library_books BEGIN SELECT RAISE(ABORT, 'disk full'); END;")
    await ctx.worker.run('en')
    expect((await ctx.library.list())[0]!.pageCount).toBe(0)
    expect((await ctx.repo.read()).mappings).toEqual(before.mappings)
    expect((await ctx.repo.read()).receipts).toEqual(before.receipts)
    await ctx.db.execute('DROP TRIGGER reject_enrichment;')
    ctx.advance(3_600_001)
    await new LibbyEnrichment(new LibbyRepository(ctx.db, ctx.clock), ctx.metadata).run('en')
    expect((await ctx.library.list())[0]!.pageCount).toBe(200)
    expect(ctx.calls).toHaveLength(1)
    await ctx.db.close()
  })
})

test('ambiguous work matches are not silently chosen; dismissal survives replay', async () => {
  const ctx = await setup()
  await link(ctx)
  const [{ job }] = await ctx.repo.prepareEnrichment()
  await ctx.repo.finishEnrichment(job!.id, [variant, { ...variant, id: 'open-library:OL2M', workKey: 'OL2W', editionKey: 'OL2M' }], true)
  const pending = (await ctx.repo.read()).enrichment[0]!
  expect(pending.status).toBe('review')
  expect(pending.candidates).toHaveLength(2)
  await ctx.repo.chooseEnrichment(pending.id, null)
  ctx.advance(120_000)
  await ctx.worker.run('en')
  expect(ctx.calls).toHaveLength(0)
  expect((await ctx.library.list())[0]!.metadataSelection).toBeUndefined()
  await ctx.db.close()
})

test('three failed attempts stop traffic until an explicit eligible retry', async () => {
  let calls = 0
  const ctx = await setup({ fetch: Object.assign(async () => { calls++; throw new Error('offline') }, { preconnect: () => {} }) })
  await link(ctx)
  for (let i = 0; i < 4; i++) { await ctx.worker.run('en'); ctx.advance(86_400_001) }
  expect(calls).toBe(3)
  const job = (await ctx.repo.read()).enrichment[0]!
  await ctx.repo.retryEnrichment(job.id)
  await ctx.worker.run('en')
  expect(calls).toBe(4)
  await ctx.db.close()
})

test('shared provider normalizes raw subjects without mistaking an edition-shaped result for a work', async () => {
  const provider = new OpenLibraryProvider({ transport: new ProviderTransport({ fetch: Object.assign(async () => Response.json({ docs: [{
    key: '/works/OL123M', title: 'An edition in a work-shaped URL', subject: ['  Horror tales  '],
    isbn: [isbn], physical_format: ['audiobook'],
  }] }), { preconnect: () => {} }) }) })
  const [found] = await provider.search({ query: isbn, locale: 'en', limit: 1 })
  expect(found?.workKey).toBeUndefined()
  expect(found?.editionKey).toBe('OL123M')
  expect(found?.medium).toBe('audiobook')
  expect(found?.subjects).toEqual([{ scope: 'edition', sourceKey: 'OL123M', values: ['  Horror tales  '] }])
})

test('an empty queue scan does not delay the first arriving loan', async () => {
  const ctx = await setup()
  await ctx.worker.run('en')
  expect((await ctx.repo.read()).enrichmentResumeAt).toBeUndefined()
  await link(ctx)
  await ctx.worker.run('en')
  expect((await ctx.repo.read()).enrichment[0]!.status).toBe('review')
  expect(ctx.calls).toHaveLength(1)
  await ctx.db.close()
})
