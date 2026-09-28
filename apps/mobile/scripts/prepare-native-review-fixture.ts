/** Synthetic history for com.hmrguez.wovenleaf.reviewtest.dev only.
 * bun scripts/prepare-native-review-fixture.ts /absolute/path/to/new.sqlite
 * Creates a new file; never connects to or overwrites a personal library.
 */
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { BunSqliteDatabase } from '../tests/storage-test-database'
import { migrateStorage } from '../src/storage/migrations'
import { LibraryRepository } from '../src/storage/library-repository'
import { ReviewKeepsakeRepository } from '../src/reviews/keepsake-repository'
import { QuarterlyReviewRepository } from '../src/reviews/repository'
import { reviewQuarter } from '../src/reviews/calendar'

const destination = process.argv[2]
if (!destination || !isAbsolute(destination) || existsSync(destination)) throw new Error('Provide an absolute, unused output path')
const database = new BunSqliteDatabase(destination)
try {
  await migrateStorage(database)
  const library = new LibraryRepository(database)
  for (const [index, pages] of [680, 320, 240].entries()) {
    const book = { id: `review-device-fixture-${index}`, title: `Sample reading ${index + 1}`, authors: [`Sample author ${index + 1}`],
      pageCount: pages, rating: 5, notes: '', subjectOverride: ['Fantasy'], shelf: 'tbr' as const,
      progress: 0, currentPage: 0, addedAt: '2026-04-01T00:00:00.000Z', lastUpdatedAt: '2026-04-01T00:00:00.000Z' }
    await library.save(book)
    await library.saveManual(book, { ...book, shelf: 'finished', progress: 100,
      finishedAt: `2026-05-${String(index + 1).padStart(2, '0')}T12:00:00.000Z` }, { id: `sample-finish-${index}` })
  }
  await new ReviewKeepsakeRepository(database, { deviceTimezone: () => 'Europe/Madrid' }).settings()
  const review = await new QuarterlyReviewRepository(database).calculate({ quarter: reviewQuarter(2026, 2, 'Europe/Madrid'), knownAt: new Date().toISOString() })
  console.log(JSON.stringify({ destination, sampleBooks: 3, suggested: review.genre.suggested,
    earned: review.earned.map(badge => ({ name: badge.name, value: badge.value })) }, null, 2))
  await database.execute('PRAGMA user_version = 1; PRAGMA wal_checkpoint(TRUNCATE);')
} finally { await database.close() }
