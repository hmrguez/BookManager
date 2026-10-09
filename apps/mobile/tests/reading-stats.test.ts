import { describe, expect, test } from 'bun:test'
import { catalogRecordsSchema, editionSchema, readingEventSchema, workSchema } from '../src/domain/catalog'
import { calculateStats, statsComparisonRange, statsRange, type StatsRequest } from '../src/stats/model'
import { calculateQuarterlyReview, type ReviewEvidence } from '../src/reviews/evidence'
import { reviewQuarter } from '../src/reviews/calendar'
import { QuarterlyReviewRepository } from '../src/reviews/repository'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage } from '../src/storage/migrations'
import { BunSqliteDatabase } from './storage-test-database'

const now = '2026-10-09T12:00:00.000Z'
const request: StatsRequest = { period: 'month', offset: 0, timezone: 'Europe/Madrid', knownAt: now, compare: true }
function evidence(): ReviewEvidence {
  const field = (type: string, id: string, name: string, value: string) => ({ value, winner: 'candidate', candidate: { kind: 'local', target: { type, id }, field: name, value, recordedAt: now, method: 'manual-entry' }, resolvedAt: now })
  return { catalog: catalogRecordsSchema.parse({ works: ['a', 'b'].map(id => workSchema.parse({ id: `work:${id}`, kind: 'single', title: field('work', `work:${id}`, 'work.title', id), createdAt: now, updatedAt: now })),
    editions: ['a', 'b'].map(id => editionSchema.parse({ id: `edition:${id}`, workId: `work:${id}`, medium: id === 'a' ? 'audiobook' : 'ebook',
      title: field('edition', `edition:${id}`, 'edition.title', id), language: field('edition', `edition:${id}`, 'edition.language', 'en'), createdAt: now, updatedAt: now })),
    assets: [], identifiers: [], sourceRecords: [], metadataOverrides: [], ownerships: [], loans: [], accessGrants: [], people: [], contributors: [], workParts: [], integrationCheckpoints: [], readingEvents: [], progressSnapshots: [] }), books: [], bookEditions: [] }
}
function session(input: ReviewEvidence, id: string, start: string, minutes: number) {
  if (id === 'b' && minutes > 0.5) {
    for (let offset = 0; offset < minutes; offset += 0.5) session(input, id, new Date(Date.parse(start) + offset * 60_000).toISOString(), Math.min(0.5, minutes - offset))
    return
  }
  const end = new Date(Date.parse(start) + minutes * 60_000).toISOString()
  input.catalog.readingEvents.push(readingEventSchema.parse({ id: `reading-event:${id}:${input.catalog.readingEvents.length}`, editionId: `edition:${id}`, kind: 'session', sessionId: `reading-session:${input.catalog.readingEvents.length}`, startedAt: start, endedAt: end, activeDurationMs: minutes * 60_000,
    ...(id === 'b' ? { activeCapture: { kind: 'epub-foreground', version: 1, captureId: 'test', intervalIndex: 0, startReason: 'open', endReason: 'close' } } : {}),
    source: { kind: 'local', method: id === 'a' ? 'audio-player' : 'epub-reader' }, deviceId: 'reading-device:test', observedAt: end, effectiveAt: end, recordedAt: end, timeConfidence: 1 }))
}
function finish(input: ReviewEvidence, at: string, extra: Record<string, unknown> = {}) {
  input.catalog.readingEvents.push(readingEventSchema.parse({ id: `reading-event:finish:${input.catalog.readingEvents.length}`, editionId: 'edition:a', kind: 'finish',
    position: { locator: { kind: 'percent', fraction: 1 }, normalizedProgress: 1, normalization: { kind: 'reported-percent', confidence: 1 } },
    source: { kind: 'local', method: 'manual' }, deviceId: 'reading-device:test', effectiveAt: at, observedAt: at, recordedAt: at, timeConfidence: 1, ...extra }))
}

describe('live calendar periods', () => {
  test('month, quarter and year respect local midnight and keep future activity out', () => {
    expect(statsRange(request).start).toBe('2026-09-30T22:00:00.000Z')
    expect(statsRange({ ...request, period: 'quarter' }).end).toBe('2026-12-31T23:00:00.000Z')
    expect(statsRange({ ...request, period: 'year' }).start).toBe('2025-12-31T23:00:00.000Z')
    const input = evidence(); finish(input, '2026-10-10T12:00:00Z'); session(input, 'a', '2026-10-10T12:00:00Z', 10)
    const stats = calculateStats(input, request)
    expect(stats.facts.metrics['01']?.value).toBe(0)
    expect(stats.facts.activity.totalMinutes).toBe(0)
    expect(stats.buckets.at(-1)?.date).toBe('2026-10-09')
  })
  test('comparisons match elapsed civil days across DST and clamp shorter months', () => {
    expect(statsComparisonRange(request)?.end).toBe('2026-09-09T12:00:00.000Z')
    expect(statsComparisonRange({ ...request, knownAt: '2026-03-30T12:00:00Z' })?.end).toBe('2026-02-28T23:00:00.000Z')
    expect(statsComparisonRange({ ...request, offset: -1 })?.end).toBe('2026-08-31T22:00:00.000Z')
    expect(statsComparisonRange({ ...request, period: 'all' })).toBeUndefined()
    expect(() => statsRange({ ...request, offset: 1 })).toThrow()
  })
  test('midnight splitting and mixed-format overlap conserve total time without false attribution', () => {
    const input = evidence()
    session(input, 'a', '2026-10-01T21:50:00Z', 30)
    session(input, 'b', '2026-10-01T22:00:00Z', 10)
    const stats = calculateStats(input, request)
    expect(stats.buckets[0]).toMatchObject({ date: '2026-10-01', totalMs: 600_000, audioMs: 600_000 })
    expect(stats.buckets[1]).toMatchObject({ totalMs: 1_200_000, audioMs: 600_000, textMs: 0, unclassifiedMs: 600_000 })
    expect(stats.buckets.reduce((sum, bucket) => sum + bucket.totalMs, 0)).toBe(stats.facts.activity.totalMinutes * 60_000)
    expect(stats.facts.activity.activeDays).toBe(2)
  })
  test('no captured time remains unknown; imported completions do not imply captured hours', () => {
    const input = evidence(); finish(input, '2026-10-03T12:00:00Z', { source: { kind: 'migration', migrationKey: 'goodreads' } })
    const stats = calculateStats(input, request)
    expect(stats.facts.metrics['01']?.value).toBe(1)
    expect(stats.facts.metrics['11']?.value).toBeUndefined()
    expect(stats.facts.activity.refs).toEqual([])
    expect(stats.buckets.every(bucket => bucket.totalMs === 0)).toBe(true)
  })
  test('completed quarter metrics remain identical and all-time has no comparison', () => {
    const input = evidence(); session(input, 'a', '2026-08-15T12:00:00Z', 30); finish(input, '2026-08-15T14:00:00Z')
    const quarterly = calculateQuarterlyReview(input, { quarter: reviewQuarter(2026, 3, 'Europe/Madrid'), knownAt: now })
    expect(calculateStats(input, { ...request, period: 'quarter', offset: -1 }).facts.metrics).toEqual(quarterly.metrics)
    const all = calculateStats(input, { ...request, period: 'all' })
    expect(all.prior).toBeUndefined()
    expect(all.buckets).toHaveLength(1)
    expect(all.buckets[0]?.totalMs).toBe(1_800_000)
  })
})

test('live repository sees committed finishes and corrections in one snapshot', async () => {
  const database = new BunSqliteDatabase(); await migrateStorage(database)
  const library = new LibraryRepository(database)
  const book = { id: 'live-book', title: 'A live story', authors: ['Author'], shelf: 'reading' as const, pageCount: 100, currentPage: 20, progress: 20, rating: 0, notes: '', addedAt: now, lastUpdatedAt: now }
  await library.save(book)
  await library.saveManual(book, { ...book, shelf: 'finished', currentPage: 100, progress: 100, finishedAt: now }, { id: 'live-finish' })
  const repository = new QuarterlyReviewRepository(database)
  const first = await repository.stats({ ...request, knownAt: '2026-10-09T13:00:00Z' })
  expect(first.facts.metrics['01']?.value).toBe(1)
  const before = (await library.list())[0]!
  await library.saveManual(before, { ...before, finishedAt: '2026-09-08T12:00:00Z' }, { id: 'live-correction' })
  const second = await repository.stats({ ...request, knownAt: '2026-10-09T13:00:00Z' })
  expect(second.facts.metrics['01']?.value).toBe(0)
  expect(second.prior?.metrics['01']?.value).toBe(1)
  expect(first.facts.metrics['01']?.value).toBe(1)
  await database.close()
})
