import { describe, expect, test } from 'bun:test'
import { libraryBookSchema } from '../src/library-model'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage } from '../src/storage/migrations'
import { readActivity, readingStreak, recordReadingAdvance } from '../src/widgets/activity'
import { usesPages, widgetBooks, widgetRoute } from '../src/widgets/snapshot'
import { BunSqliteDatabase } from './storage-test-database'

const book = libraryBookSchema.parse({
  id: 'book-one', title: 'A book', authors: ['An author'], pageCount: 1000,
  shelf: 'reading', progress: 10, currentPage: 100, rating: 0, notes: '',
  addedAt: '2026-09-01T12:00:00Z', lastUpdatedAt: '2026-09-01T12:00:00Z',
})
const day = (number: number) => new Date(2026, 8, number, 12)

describe('Reading widgets', () => {
  test('digital positions and the last recorded unit take precedence over catalog page counts', () => {
    expect(usesPages(book)).toBe(true)
    expect(usesPages({ ...book, format: 'EPUB' })).toBe(false)
    expect(usesPages({ ...book, format: 'AUDIOBOOK' })).toBe(false)
    expect(usesPages(book, 'manual-percent')).toBe(false)
    expect(usesPages(book, 'manual-page')).toBe(true)
    expect(usesPages({ ...book, pageCount: 0 }, 'manual-page')).toBe(false)
  })
  test('a stale widget save cannot overwrite progress or create activity', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const library = new LibraryRepository(database)
    await library.save(book)
    await library.save({ ...book, currentPage: 102, lastUpdatedAt: day(21).toISOString() }, 'page')
    await expect(library.save({ ...book, currentPage: 103 }, 'page', book.lastUpdatedAt)).rejects.toThrow('changed')
    expect((await library.list())[0]?.currentPage).toBe(102)
    expect(await database.query('SELECT * FROM reading_activity_events')).toHaveLength(1)
    await database.close()
  })

  test('streak counts a day once across books and allows today to remain unfinished', () => {
    expect(readingStreak(['2026-09-20', '2026-09-21', '2026-09-21'], day(22))).toEqual({ count: 2, readToday: false })
    expect(readingStreak(['2026-09-20', '2026-09-21', '2026-09-22'], day(22))).toEqual({ count: 3, readToday: true })
    expect(readingStreak(['2026-09-20'], day(22))).toEqual({ count: 0, readToday: false })
    expect(readingStreak(['2026-09-20', '2026-09-22'], day(22))).toEqual({ count: 1, readToday: true })
    expect(readingStreak(['2026-09-23'], day(22))).toEqual({ count: 0, readToday: false })
  })
  test('calendar arithmetic crosses month, leap-year and DST boundaries', () => {
    expect(readingStreak(['2024-02-28', '2024-02-29', '2024-03-01'], new Date(2024, 2, 1, 12)).count).toBe(3)
    expect(readingStreak(['2026-03-28', '2026-03-29', '2026-03-30'], new Date(2026, 2, 30, 12)).count).toBe(3)
  })
  test('default book follows actual progress, not metadata changes', () => {
    const other = { ...book, id: 'book-two', lastUpdatedAt: '2030-01-01T00:00:00Z' }
    const finished = { ...book, id: 'finished', shelf: 'finished' as const }
    expect(widgetBooks([other, finished, book], new Map([[book.id, '2026-09-21'], [finished.id, '2026-09-22']])).map(({ id }) => id)).toEqual([book.id, other.id])
  })
  test('only explicit forward progress writes durable activity, including sub-percent pages', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const library = new LibraryRepository(database)
    await library.save(book)
    await library.save({ ...book, notes: 'A note', lastUpdatedAt: day(20).toISOString() })
    expect((await readActivity(database)).days).toEqual([])
    const advanced = { ...book, currentPage: 101, lastUpdatedAt: day(21).toISOString() }
    await library.save(advanced, true)
    await library.save(advanced, true)
    await library.save({ ...advanced, currentPage: 99 }, true)
    expect((await database.query('SELECT * FROM reading_activity_events')).length).toBe(1)
    expect((await readActivity(database)).days).toEqual(['2026-09-21'])
    expect((await readActivity(database)).recent.get(book.id)).toBe(day(21).toISOString())
    await database.close()
  })
  test('native events are idempotent and preserve tiny advances; deletion erases book activity', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const library = new LibraryRepository(database)
    await library.save(book)
    const event = { id: 'native-event', bookId: book.id, occurredAt: day(22).toISOString(), source: 'reader', before: 0.10001, after: 0.10002 }
    await recordReadingAdvance(database, event)
    await recordReadingAdvance(database, event)
    await recordReadingAdvance(database, { ...event, id: 'unchanged', after: event.before })
    expect((await database.query('SELECT * FROM reading_activity_events')).length).toBe(1)
    await library.remove(book.id)
    expect((await readActivity(database)).days).toEqual([])
    await database.close()
  })
  test('deep links preserve encoded book IDs and reject other routes', () => {
    const url = widgetBooks([{ ...book, id: 'book:a/b?c' }], new Map())[0]!.url
    expect(widgetRoute(url)).toEqual({ bookId: 'book:a/b?c', streak: false })
    expect(widgetRoute('wovenleaf://widgets/streak')?.streak).toBe(true)
    expect(widgetRoute('https://widgets/reading')).toBeUndefined()
    expect(widgetRoute('wovenleaf://widgets/unknown')).toBeUndefined()
  })
})
