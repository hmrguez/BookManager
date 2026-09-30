import { describe, expect, test } from 'bun:test'
import { parseLibbySnapshot, LIBBY_SHARE_PREFIX } from '../src/libby/model'
import { hasFreshCapture, companionListing } from '../src/libby/setup'
import { LibbyRepository } from '../src/libby/repository'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage } from '../src/storage/migrations'
import { libraryBookSchema } from '../src/library-model'
import { BunSqliteDatabase } from './storage-test-database'

const at = '2026-09-20T10:00:00.000Z'
function snapshot(percent = 0, capturedAt = at) {
  return { kind: 'wovenleaf-libby', version: 1, id: crypto.randomUUID(), capturedAt,
    observations: [{ titleId: '12345', format: 'ebook', title: 'A quiet book', author: 'A. Reader', percent }] }
}
async function setup() {
  const db = new BunSqliteDatabase()
  await migrateStorage(db)
  const repo = new LibbyRepository(db, () => new Date('2026-09-20T12:00:00Z'))
  const library = new LibraryRepository(db)
  const book = libraryBookSchema.parse({ id: 'book:test', title: 'A quiet book', authors: ['A. Reader'],
    pageCount: 200, currentPage: 0, shelf: 'reading', progress: 0, rating: 3, notes: 'Keep me', addedAt: at, lastUpdatedAt: at })
  await library.save(book)
  await repo.configure(true, true, false)
  return { db, repo, library, book }
}

describe('Libby local progress', () => {
  const coverUrl = 'https://img1.od-cdn.com/ImageType-400/1234-1/{ABC-123}IMG400.JPG'
  test('captures a public cover by URL and fills a missing linked cover without replacing chosen artwork', async () => {
    const { repo, library, book, db } = await setup()
    const first = snapshot(10)
    await repo.ingest(JSON.stringify(first)); await repo.apply('ebook:12345', first.id, book.id, book.lastUpdatedAt)
    const withCover = { ...snapshot(10, '2026-09-20T11:00:00.000Z'), observations: [{ ...first.observations[0]!, coverUrl }] }
    const state = await repo.ingest(JSON.stringify(withCover))
    expect((await library.list())[0]!.thumbnail).toBe(coverUrl)
    expect(state.receipts).toHaveLength(2)
    await repo.undo(state.receipts[1]!.id)
    expect((await library.list())[0]!.thumbnail).toBeUndefined()
    const chosen = { ...(await library.list())[0]!, thumbnail: 'https://example.org/my-cover.jpg', lastUpdatedAt: '2026-09-20T12:30:00.000Z' }
    await library.save(chosen)
    const next = { ...withCover, id: crypto.randomUUID(), capturedAt: '2026-09-20T11:30:00.000Z' }
    await repo.ingest(JSON.stringify(next)); await repo.apply('ebook:12345', next.id, book.id, chosen.lastUpdatedAt)
    expect((await library.list())[0]!.thumbnail).toBe(chosen.thumbnail)
    const other = { ...withCover, id: crypto.randomUUID(), observations: [{ ...withCover.observations[0]!, titleId: '6789', title: 'A new covered loan' }] }
    await repo.configure(true, true, true); await repo.ingest(JSON.stringify(other))
    expect((await library.list()).find(entry => entry.title === 'A new covered loan')?.thumbnail).toBe(coverUrl)
    for (const invalid of ['https://evil.example/cover.jpg', coverUrl + '?token=secret', 'http://img1.od-cdn.com/ImageType-400/a.jpg', 'https://img1.od-cdn.com@evil.example/ImageType-400/a.jpg', 'data:image/png;base64,abc', 'https://ic.od-cdn.com/resize?url=https://evil.example/a.jpg']) {
      expect(() => parseLibbySnapshot(JSON.stringify({ ...first, observations: [{ ...first.observations[0]!, coverUrl: invalid }] }), Date.parse(at))).toThrow()
    }
    await db.close()
  })
  for (const shelf of ['tbr', 'reading', 'next', 'finished', 'dnf'] as const) {
    test(`links the existing ${shelf} book once, preserving its identity and making the shelf move undoable`, async () => {
      const { repo, library, book, db } = await setup()
      const existing = { ...book, shelf, progress: shelf === 'finished' ? 100 : 2, currentPage: 4, thumbnail: 'https://example.org/chosen.jpg', ...(shelf === 'finished' ? { finishedAt: at } : {}) }
      await library.save(existing); await repo.configure(true, true, true)
      const capture = { ...snapshot(10), observations: [{ ...snapshot(10).observations[0]!, coverUrl }] }
      const review = await repo.ingest(JSON.stringify(capture))
      expect(review.items[0]!.status).toBe('pending')
      expect(review.items[0]!.reason).toContain('already in your library')
      expect(await library.list()).toHaveLength(1)
      if (shelf !== 'reading') await expect(repo.apply('ebook:12345', capture.id, book.id, book.lastUpdatedAt)).rejects.toThrow('confirm moving')
      const linked = await repo.apply('ebook:12345', capture.id, book.id, book.lastUpdatedAt, shelf !== 'reading')
      expect((await library.list())[0]).toMatchObject({ id: book.id, shelf: 'reading', progress: 10, notes: 'Keep me', rating: 3, currentPage: 4, thumbnail: existing.thumbnail })
      expect((await library.list())[0]!.finishedAt).toBeUndefined()
      await repo.undo(linked.receipts[0]!.id)
      expect((await library.list())[0]).toMatchObject({ shelf, progress: existing.progress, currentPage: 4 })
      expect((await library.list())[0]!.finishedAt).toBe(existing.finishedAt)
      // Explicit reacceptance resumes the remembered link, then progress advances automatically.
      const next = snapshot(15, '2026-09-20T11:00:00.000Z')
      await repo.ingest(JSON.stringify(next))
      await repo.apply('ebook:12345', next.id, book.id, (await library.list())[0]!.lastUpdatedAt, shelf !== 'reading')
      await repo.ingest(JSON.stringify(snapshot(25, '2026-09-20T11:30:00.000Z')))
      expect(await library.list()).toHaveLength(1)
      expect((await library.list())[0]!.progress).toBe(25)
      expect((await repo.read()).mappings).toHaveLength(1)
      await db.close()
    })
  }
  test('new loans automatically join Reading at nonzero progress, then advance without review or duplicates', async () => {
    const { repo, library, db } = await setup()
    await repo.configure(true, true, true)
    const first = snapshot(5); first.observations[0]!.title = 'A newly borrowed book'
    let state = await repo.ingest(JSON.stringify(first))
    expect(state.items[0]!.status).toBe('applied')
    const id = state.mappings[0]!.bookId
    expect((await library.list()).find(book => book.id === id)).toMatchObject({ title: 'A newly borrowed book', shelf: 'reading', progress: 5, format: 'EBOOK' })
    const forward = { ...first, id: crypto.randomUUID(), capturedAt: '2026-09-20T11:00:00.000Z', observations: [{ ...first.observations[0]!, percent: 23 }] }
    state = await repo.ingest(JSON.stringify(forward))
    expect(state.items[0]!.status).toBe('applied')
    expect((await library.list()).find(book => book.id === id)?.progress).toBe(23)
    await repo.ingest(JSON.stringify(forward))
    expect(await library.list()).toHaveLength(2)
    expect((await repo.read()).receipts).toHaveLength(2)
    await repo.unlink('ebook:12345')
    const next = { ...forward, id: crypto.randomUUID(), capturedAt: '2026-09-20T11:30:00.000Z' }
    state = await repo.ingest(JSON.stringify(next))
    expect(state.mappings).toHaveLength(0)
    expect(state.items[0]!.reason).toContain('unlinked')
    expect(await library.list()).toHaveLength(2)
    await db.close()
  })
  test('automatic adding respects existing titles, opt-out, stale captures and atomic failures', async () => {
    const { repo, library, db } = await setup()
    await repo.configure(true, true, true)
    expect((await repo.ingest(JSON.stringify(snapshot(5)))).items[0]!.reason).toContain('already in your library')
    const fresh = snapshot(20, '2026-09-20T11:00:00.000Z'); fresh.observations[0]!.title = 'New title'; fresh.observations[0]!.titleId = '67890'
    await repo.configure(true, true, false)
    expect((await repo.ingest(JSON.stringify(fresh))).items.find(item => item.key === 'ebook:67890')!.status).toBe('pending')
    await repo.configure(true, true, true)
    const later = { ...fresh, id: crypto.randomUUID(), capturedAt: '2026-09-20T11:30:00.000Z' }
    await db.execute("CREATE TRIGGER reject_libby_insert BEFORE INSERT ON library_books BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;")
    await expect(repo.ingest(JSON.stringify(later))).rejects.toThrow('simulated failure')
    expect(await library.list()).toHaveLength(1)
    expect((await repo.read()).seen).not.toContain(later.id)
    await db.execute('DROP TRIGGER reject_libby_insert;')
    const oldRepo = new LibbyRepository(db, () => new Date('2026-09-24T10:00:00Z'))
    expect((await oldRepo.ingest(JSON.stringify(later))).items.find(item => item.key === 'ebook:67890')!.reason).toContain('day old')
    expect(await library.list()).toHaveLength(1)
    await db.close()
  })
  test('accepts zero and share text, rejects unknown fields, duplicate titles, bad dates and percentages', () => {
    expect(parseLibbySnapshot(LIBBY_SHARE_PREFIX + JSON.stringify(snapshot()), Date.parse(at)).observations[0]!.percent).toBe(0)
    for (const bad of [{ ...snapshot(), cookie: 'secret' }, snapshot(NaN), snapshot(101), snapshot(-1), snapshot(1, '2099-01-01T00:00:00Z')]) {
      expect(() => parseLibbySnapshot(JSON.stringify(bad), Date.parse(at))).toThrow()
    }
    const duplicate = snapshot(); duplicate.observations.push(duplicate.observations[0]!)
    expect(() => parseLibbySnapshot(JSON.stringify(duplicate), Date.parse(at))).toThrow()
  })
  test('matches once, applies forward snapshots atomically, keeps pages/metadata, and never finishes a book', async () => {
    const { repo, library, book, db } = await setup()
    const first = snapshot()
    let state = await repo.ingest(JSON.stringify(first))
    expect(state.items[0]!.status).toBe('pending')
    await repo.apply('ebook:12345', first.id, book.id, book.lastUpdatedAt)
    const forward = snapshot(100, '2026-09-20T11:00:00.000Z')
    state = await repo.ingest(JSON.stringify(forward))
    const updated = (await library.list())[0]!
    expect(updated).toMatchObject({ progress: 100, currentPage: 0, shelf: 'reading', notes: 'Keep me', rating: 3 })
    expect(updated.finishedAt).toBeUndefined()
    expect(state.receipts).toHaveLength(2)
    expect((await repo.ingest(JSON.stringify(forward))).receipts).toHaveLength(2)
    expect((await repo.ingest(JSON.stringify(snapshot(2)))).receipts).toHaveLength(2)
    await db.close()
  })
  test('manual edits and backward changes need review; stale UI cannot overwrite a newer capture', async () => {
    const { repo, library, book, db } = await setup()
    const first = snapshot(30)
    await repo.ingest(JSON.stringify(first)); await repo.apply('ebook:12345', first.id, book.id, book.lastUpdatedAt)
    const backward = snapshot(10, '2026-09-20T11:00:00.000Z')
    expect((await repo.ingest(JSON.stringify(backward))).items[0]!.reason).toContain('earlier')
    const changed = { ...(await library.list())[0]!, progress: 40, lastUpdatedAt: '2026-09-20T12:30:00.000Z' }
    await library.save(changed)
    const next = snapshot(60, '2026-09-20T11:30:00.000Z')
    expect((await repo.ingest(JSON.stringify(next))).items[0]!.reason).toContain('changed')
    await expect(repo.apply('ebook:12345', backward.id, book.id, changed.lastUpdatedAt)).rejects.toThrow('capture changed')
    await expect(repo.apply('ebook:12345', next.id, book.id, book.lastUpdatedAt)).rejects.toThrow('book changed')
    expect((await library.list())[0]!.progress).toBe(40)
    await db.close()
  })
  test('undo restores progress and pauses auto sync; disconnect clears private integration state only', async () => {
    const { repo, library, book, db } = await setup()
    const first = snapshot(30)
    await repo.ingest(JSON.stringify(first))
    const state = await repo.apply('ebook:12345', first.id, book.id, book.lastUpdatedAt)
    await repo.undo(state.receipts[0]!.id)
    expect((await library.list())[0]!.progress).toBe(0)
    expect((await repo.ingest(JSON.stringify(snapshot(50, '2026-09-20T11:00:00.000Z')))).items[0]!.reason).toContain('paused')
    await repo.configure(false, true)
    expect((await repo.read()).mappings).toEqual([])
    expect(await library.list()).toHaveLength(1)
    await expect(repo.ingest(JSON.stringify(snapshot()))).rejects.toThrow('Enable Libby')
    await db.close()
  })
  test('a failed progress write rolls back the inbox and receipt, and completion is protected', async () => {
    const { repo, library, book, db } = await setup()
    const first = snapshot(30)
    await repo.ingest(JSON.stringify(first))
    await db.execute("CREATE TRIGGER reject_libby BEFORE UPDATE ON library_books BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;")
    await expect(repo.apply('ebook:12345', first.id, book.id, book.lastUpdatedAt)).rejects.toThrow('simulated failure')
    expect((await repo.read()).receipts).toHaveLength(0)
    expect((await repo.read()).items[0]!.status).toBe('pending')
    await db.execute('DROP TRIGGER reject_libby;')
    const finished = { ...book, shelf: 'finished' as const, progress: 100 }
    await library.save(finished)
    await expect(repo.apply('ebook:12345', first.id, book.id, book.lastUpdatedAt)).rejects.toThrow('Reading shelf')
    await db.close()
  })
  test('automatic-off and old captures remain for review; partial snapshots keep other links', async () => {
    const { repo, library, book, db } = await setup()
    const first = snapshot(20)
    await repo.ingest(JSON.stringify(first)); await repo.apply('ebook:12345', first.id, book.id, book.lastUpdatedAt)
    await repo.configure(true, false)
    expect((await repo.ingest(JSON.stringify(snapshot(30, '2026-09-20T11:00:00.000Z')))).items[0]!.reason).toContain('off')
    const other = snapshot(0); other.observations[0]!.titleId = '67890'
    await repo.ingest(JSON.stringify(other))
    expect((await repo.read()).mappings).toHaveLength(1)
    expect((await library.list())[0]!.progress).toBe(20)
    const oldRepo = new LibbyRepository(db, () => new Date('2026-09-24T10:00:00Z'))
    await oldRepo.configure(true, true)
    expect((await oldRepo.ingest(JSON.stringify(snapshot(50, '2026-09-21T10:00:00.000Z')))).items.find(item => item.key === 'ebook:12345')!.reason).toContain('day old')
    await db.close()
  })
  test('a later manual edit prevents Undo; a new repository retains replay protection', async () => {
    const { repo, library, book, db } = await setup()
    const first = snapshot(20)
    await repo.ingest(JSON.stringify(first))
    const state = await repo.apply('ebook:12345', first.id, book.id, book.lastUpdatedAt)
    await library.save({ ...(await library.list())[0]!, progress: 42, lastUpdatedAt: '2026-09-20T12:40:00.000Z' })
    await expect(repo.undo(state.receipts[0]!.id)).rejects.toThrow('newer progress')
    const reopened = new LibbyRepository(db, () => new Date('2026-09-20T12:45:00Z'))
    expect((await reopened.ingest(JSON.stringify(first))).receipts).toHaveLength(1)
    expect((await library.list())[0]!.progress).toBe(42)
    await db.close()
  })

})


test('an explicit empty shelf verifies capture without deleting existing books or accepting an ambiguous empty payload', async () => {
  const { repo, library, db } = await setup()
  const empty = { ...snapshot(), observations: [], emptyShelf: true }
  expect(() => parseLibbySnapshot(JSON.stringify({ ...empty, emptyShelf: undefined }))).toThrow()
  expect(() => parseLibbySnapshot(JSON.stringify({ ...snapshot(), emptyShelf: true }))).toThrow()
  expect(() => parseLibbySnapshot(JSON.stringify({ ...empty, emptyShelf: 'true' }))).toThrow()
  const state = await repo.ingest(JSON.stringify(empty))
  expect(state.lastCapturedAt).toBe(at)
  expect(state.lastVerifiedCaptureAt).toBeUndefined()
  const verified = await repo.ingest(JSON.stringify(empty), true)
  expect(verified.lastVerifiedCaptureAt).toBe(at)
  expect(state.items).toHaveLength(0)
  expect(await library.list()).toHaveLength(1)
  expect(hasFreshCapture(state.lastCapturedAt, '2026-09-20T11:00:00.000Z')).toBe(false)
  expect(hasFreshCapture(state.lastCapturedAt, at)).toBe(true)
  const older = await repo.ingest(JSON.stringify({ ...empty, id: crypto.randomUUID(), capturedAt: '2026-09-19T10:00:00.000Z' }))
  expect(older.lastCapturedAt).toBe(at)
  db.close()
})

test('setup only opens the selected browser’s trusted marketplace', () => {
  expect(companionListing('quetta', 'https://chromewebstore.google.com/detail/test')).toBe('https://chromewebstore.google.com/detail/test')
  expect(companionListing('firefox', undefined, 'https://addons.mozilla.org/android/addon/test/')).toBe('https://addons.mozilla.org/android/addon/test/')
  for (const url of ['javascript:alert(1)', 'https://chromewebstore.google.com.evil.example/', 'https://secret@chromewebstore.google.com/', 'https://chromewebstore.google.com:8443/']) expect(companionListing('quetta', url)).toBeUndefined()
  for (const override of [undefined, '', '   ']) expect(companionListing('firefox', 'https://chromewebstore.google.com/detail/test', override)).toBe('https://addons.mozilla.org/en-US/firefox/addon/wovenleaf-libby-progress/')
  expect(companionListing('firefox', undefined, 'https://addons.mozilla.org.evil.example/')).toBeUndefined()
  expect(companionListing('quetta')).toBeUndefined()
  expect(companionListing('safari')).toBeUndefined()
  expect(hasFreshCapture(undefined, at)).toBe(false)
})
