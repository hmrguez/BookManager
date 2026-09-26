import { describe, expect, test } from 'bun:test'
import { catalogRecordsSchema, contributorSchema, editionSchema, personSchema, readingEventSchema, workSchema } from '../src/domain/catalog'
import { calculateQuarterlyReview, normalizeLanguage, type MetricCoverage, type ReviewEvidence } from '../src/reviews/evidence'
import { reviewQuarter } from '../src/reviews/calendar'
import { REVIEW_BADGES, REVIEW_RULE_VERSION, badgeDevelopment, selectBadges, type RankedBadge } from '../src/reviews/catalogue'
import { classifyGenres, genresForBooks, suggestGenre, type GenreClassification } from '../src/reviews/genres'
import { calculateActivity, type ActivityInterval } from '../src/reviews/activity'
import type { LibraryBook } from '../src/library-model'

const at = '2026-04-02T12:00:00.000Z'
const knownAt = '2026-10-01T12:00:00.000Z'
const quarter = reviewQuarter(2026, 2, 'UTC')
function empty(): ReviewEvidence {
  return { catalog: catalogRecordsSchema.parse({ works: [], editions: [], assets: [], identifiers: [], sourceRecords: [], metadataOverrides: [],
    ownerships: [], loans: [], accessGrants: [], people: [], contributors: [], workParts: [], integrationCheckpoints: [], readingEvents: [], progressSnapshots: [] }),
  books: [], bookEditions: [] }
}
function field(type: string, id: string, name: string, value: unknown) {
  return { value, winner: 'candidate', candidate: { kind: 'local', target: { type, id }, field: name, value, recordedAt: at, method: 'manual-entry' }, resolvedAt: at }
}
function addBook(input: ReviewEvidence, id: string, options: { work?: string; pages?: number; medium?: string; language?: string; series?: string[]; rating?: number } = {}) {
  const workId = `work:${options.work ?? id}`, editionId = `edition:${id}`
  if (!input.catalog.works.some(w => w.id === workId)) input.catalog.works.push(workSchema.parse({ id: workId, kind: 'single', title: field('work', workId, 'work.title', id), createdAt: at, updatedAt: at }))
  input.catalog.editions.push(editionSchema.parse({ id: editionId, workId, medium: options.medium ?? 'ebook', binding: 'paperback',
    title: field('edition', editionId, 'edition.title', id), language: field('edition', editionId, 'edition.language', options.language ?? 'en'),
    ...(options.pages ? { pageCount: field('edition', editionId, 'edition.pageCount', options.pages) } : {}), createdAt: at, updatedAt: at }))
  const book: LibraryBook = { id, readingEditionId: input.catalog.editions.at(-1)!.id, title: id, authors: ['Someone'],
    pageCount: options.pages ?? 0, rating: options.rating ?? 0, notes: '', shelf: 'finished', progress: 100, currentPage: options.pages ?? 0,
    addedAt: at, lastUpdatedAt: at, series: options.series }
  input.books = [...input.books, book]
  return book
}
function finish(input: ReviewEvidence, id: string, time = at, extra: Record<string, unknown> = {}) {
  const event = readingEventSchema.parse({ id: `reading-event:${id}:${input.catalog.readingEvents.length}`, editionId: `edition:${id}`,
    kind: 'finish', position: { locator: { kind: 'percent', fraction: 1 }, normalization: { kind: 'reported-percent', confidence: 1 }, normalizedProgress: 1 },
    source: { kind: 'local', method: 'manual' }, deviceId: 'reading-device:test', observedAt: time, effectiveAt: time, recordedAt: time, timeConfidence: 1, ...extra })
  input.catalog.readingEvents.push(event)
  return event
}
function session(input: ReviewEvidence, id: string, start: string, minutes: number, extra: Record<string, unknown> = {}) {
  const end = new Date(Date.parse(start) + minutes * 60_000).toISOString()
  const event = readingEventSchema.parse({ id: `reading-event:${id}:${input.catalog.readingEvents.length}`, editionId: `edition:${id}`,
    kind: 'session', sessionId: `reading-session:${id}:${input.catalog.readingEvents.length}`, startedAt: start, endedAt: end, activeDurationMs: minutes * 60_000,
    source: { kind: 'local', method: 'audio-player' }, deviceId: 'reading-device:test', observedAt: end, effectiveAt: end, recordedAt: end, timeConfidence: 1, ...extra })
  input.catalog.readingEvents.push(event)
  return event
}
const review = (input: ReviewEvidence, options = {}) => calculateQuarterlyReview(input, { quarter, knownAt, ...options })

// Independent transcription ensures tests catch catalogue drift as well as arithmetic bugs.
const ladders = [[1,3,6,12,24,32], [100,500,1500,3000,6000,7800], [200,350,500,750,1000,1300], [1,3,5,8,12], [2,3,4,6,8],
  [2,3,4,6,8], [1,3,5,8,12], [1,3,5,8,12], [60,300,900,1800,3600], [3,7,15,30,60], [3,7,15,30,60], [2,4,6,9,12],
  [1,3,5,8,12], [1,5,10,20,40], [3,5,10,20,30], [1,3,6,12,24], [1,3,6,10,15], [1,2,4,6,10], [2,3,4,5,6],
  [1,3,8,15,30], [1,3,8,15,30], [3,10,25,50,100], [1,3,5,8,12], [2,5,10,20,30], [3,8,15,30,60], [1,3,8,15,30],
  [1,3,6,12,24], [60,300,900,1800,3600], [50,250,750,1500,3000], [3,10,25,50,100]]

describe('approved catalogue', () => {
  test.each(REVIEW_BADGES.map((b, index) => [b, index] as const))('$0.name: all thresholds, interpolation and invalid inputs', (badge, index) => {
    expect(badge.thresholds).toEqual(ladders[index]!)
    for (const [i, threshold] of badge.thresholds.entries()) {
      expect(badgeDevelopment(threshold, badge.thresholds)).toEqual({ tier: i + 1, development: 20 * (i + 1) })
      const prior = badge.thresholds[i - 1] ?? 0
      if (i) expect(badgeDevelopment((prior + threshold) / 2, badge.thresholds)?.development).toBe(20 * i + 10)
    }
    for (const value of [undefined, NaN, Infinity, -1, badge.thresholds[0]! - 0.01]) expect(badgeDevelopment(value, badge.thresholds)).toBeUndefined()
    expect(badgeDevelopment(1e9, badge.thresholds)?.development).toBe(badge.thresholds.length * 20)
  })
  test('cross-unit scores and stretch tier retain approved relative development', () => {
    expect(badgeDevelopment(1800, ladders[1]!)?.development).toBe(64)
    expect(badgeDevelopment(18 * 60, ladders[8]!)?.development).toBe(64)
    expect(badgeDevelopment(6, ladders[0]!)?.development).toBe(60)
    expect(badgeDevelopment(28, ladders[0]!)?.development).toBe(110)
    expect(badgeDevelopment(4, [1, 1])).toBeUndefined()
  })
  test('selection uses bands, records, families, overlap and low-to-high reveal', () => {
    const earned: RankedBadge[] = [
      { id: '01', family: 'completion', development: 100, personalBest: false, workIds: ['a'] },
      { id: '02', family: 'completion', development: 99, personalBest: false, workIds: ['a'] },
      { id: '03', family: 'completion', development: 98, personalBest: true, workIds: ['a'] },
      { id: '10', family: 'rhythm', development: 85, personalBest: false, workIds: ['a'] },
      { id: '11', family: 'rhythm', development: 89, personalBest: false, workIds: ['a'] },
      { id: '22', family: 'reflection', development: 80, personalBest: false, workIds: ['a'] },
      { id: '25', family: 'reflection', development: 82, personalBest: true, workIds: ['a'] },
      { id: '04', family: 'discovery', development: 70, personalBest: false, workIds: ['a'] },
      { id: '05', family: 'discovery', development: 69, personalBest: false, workIds: ['a'] },
    ]
    const selected = selectBadges(earned)
    expect(selected.featured.map(b => b.id)).toEqual(['01', '03', '11', '25', '04'])
    expect(selected.reveal.map(b => b.id)).toEqual(['04', '25', '11', '03', '01'])
    expect(selectBadges([...earned].reverse())).toEqual(selected)
    expect(selectBadges(earned.slice(-2)).featured).toHaveLength(1)
    expect(selectBadges([earned.at(-2)!, { ...earned.at(-1)!, workIds: ['a', 'b'] }]).featured).toHaveLength(2)
  })
})

const classification = (labels: string[]): GenreClassification => classifyGenres({ claims: [{ provider: 'open-library', sourceKey: '/works/test', scope: 'work', observedAt: at, values: labels }] })
describe('genre evidence', () => {
  test.each([
    [[' Fiction,  fantasy, general ', 'Fantasy'], ['fantasy']],
    [['Mystery & Detective - Hard-Boiled', 'Fiction - Mystery/ Detective'], ['mystery']],
    [['Fiction, romance, general'], ['romance']], [['Fiction, science fiction, general'], ['science-fiction']],
    [['Literary fiction'], ['literary-fiction']], [['Horror tales', 'Ghost stories'], ['horror']],
    [['Nonfiction / Education'], ['nonfiction']], [['Nonfiction', 'History'], ['history']],
    [['History'], []], [['General & Literary Fiction', 'Fiction / General'], []], [['Historical fiction', 'American poetry', 'Comic books, strips'], []],
    [['Science', 'Biography', 'Memoir', 'Essays', 'Self-help'], []], [['Fiction about fantasy'], []],
    [['Fantasy', 'Romance'], ['fantasy', 'romance']],
  ])('whole-label mapping %j', (labels, families) => expect(classification(labels).families).toEqual(families))
  test('contradictions and peer disagreement are unresolved; corrections override exactly', () => {
    expect(classification(['Fantasy', 'Nonfiction']).status).toBe('unresolved')
    expect(classification(['Literary fiction', 'Criticism and interpretation']).status).toBe('unresolved')
    const claims = [classification(['Fantasy']).evidence.claims[0]!, { ...classification(['Romance']).evidence.claims[0]!, provider: 'embedded-epub' }]
    expect(classifyGenres({ claims }).status).toBe('unresolved')
    expect(classifyGenres({ override: ['Mystery'], claims }).families).toEqual(['mystery'])
    expect(classifyGenres({ override: null, claims }).status).toBe('unknown')
    const input = empty(); const book = addBook(input, 'tagged'); book.tags = ['Fantasy']
    expect(genresForBooks([book]).status).toBe('unknown')
  })
  test('strict coverage and unknown lead, ties and sparse reviews', () => {
    const from = (labels: string[][]) => suggestGenre(labels.map((values, i) => ({ workId: String(i), classification: classification(values) })))
    expect(from(Array.from({ length: 10 }, (_, i) => i < 6 ? ['Fantasy'] : [])).suggested).toBe('fantasy')
    expect(from(Array.from({ length: 10 }, (_, i) => i < 4 ? ['Fantasy'] : i < 6 ? ['Mystery'] : [])).suggested).toBeNull()
    expect(from([['Fantasy'], []]).suggested).toBeNull()
    expect(from([['Fantasy']]).suggested).toBe('fantasy')
    expect(from([['Fantasy', 'Romance']]).choices.slice(0, 2)).toEqual(['fantasy', 'romance'])
    expect(from([['Fantasy', 'Romance']]).suggested).toBeNull()
    expect(from([]).suggested).toBeNull()
    expect(from(Array.from({ length: 100 }, (_, i) => i < 51 ? ['Fantasy'] : [])).suggested).toBe('fantasy')
    expect(from([['Fantasy'], ['Fantasy'], ['Mystery'], []]).suggested).toBeNull() // lead == unknown
  })
})

describe('corrected finish evidence and snapshots', () => {
  test('deduplicates work across formats and rereads; page claims use compatible finished editions', () => {
    const input = empty()
    addBook(input, 'print', { medium: 'print', work: 'same', pages: 400, rating: 5 })
    addBook(input, 'audio', { medium: 'audiobook', work: 'same', pages: 9999 })
    addBook(input, 'short', { pages: 150 })
    finish(input, 'print'); finish(input, 'print', '2026-05-01T00:00:00Z'); finish(input, 'audio'); finish(input, 'short')
    const result = review(input)
    expect(result.metrics['01']?.value).toBe(2)
    expect(result.metrics['02']?.value).toBe(550)
    expect(result.metrics['03']?.value).toBe(400)
    expect(result.metrics['07']?.value).toBe(1)
    expect(result.metrics['08']?.value).toBe(1)
    expect(result.earned.find(b => b.id === '02')?.fact).toBe('pages-across-books-finished')
    expect(result.metrics['29']?.value).toBeUndefined()
    expect(result.metrics['30']?.value).toBeUndefined()
    expect(result.metrics['28']?.value).toBeUndefined()
    expect(result.earned.some(b => ['09', '28'].includes(b.id))).toBe(false)
  })
  test('incompatible edition lengths do not create an arbitrary page total', () => {
    const input = empty(); addBook(input, 'a', { pages: 300, work: 'same' }); addBook(input, 'b', { pages: 500, work: 'same' })
    finish(input, 'a'); finish(input, 'b')
    expect(review(input).metrics['02']?.value).toBeUndefined()
  })
  test('effective corrections cross quarter boundaries while known-at preserves the old fact', () => {
    const input = empty(); addBook(input, 'one', { pages: 400 })
    const original = finish(input, 'one')
    const replacement = { kind: 'finish', position: { locator: { kind: 'percent', fraction: 1 }, normalization: { kind: 'reported-percent', confidence: 1 }, normalizedProgress: 1 } }
    input.catalog.readingEvents.push(readingEventSchema.parse({ ...original, id: 'reading-event:correction', kind: 'correction',
      targetEventIds: [original.id], reason: 'Correct date', action: { kind: 'replace', replacement },
      effectiveAt: '2026-03-31T22:30:00.000Z', recordedAt: '2026-07-03T00:00:00Z' }))
    expect(review(input).metrics['01']?.value).toBe(0)
    expect(review(input, { knownAt: '2026-07-02T00:00:00Z' }).metrics['01']?.value).toBe(1)
    expect(review(input, { quarter: reviewQuarter(2026, 1, 'UTC') }).metrics['01']?.value).toBe(1)
    expect(review(input, { quarter: reviewQuarter(2026, 2, 'Europe/Madrid') }).metrics['01']?.value).toBe(1)
  })
  test('uncertain imports, seeded history and current snapshot status earn no completion', () => {
    const input = empty(); addBook(input, 'one', { pages: 400 })
    finish(input, 'one', at, { timeConfidence: 0.2, source: { kind: 'migration', migrationKey: 'unknown' } })
    finish(input, 'one', at, { source: { kind: 'migration', migrationKey: 'legacy:seeded-starter' } })
    expect(review(input).metrics['01']?.value).toBe(0)
    finish(input, 'one')
    expect(review(input).metrics['01']?.value).toBe(1)
  })
  test('zero and one book, stable labels and no note content', () => {
    expect(review(empty()).earned).toEqual([])
    const input = empty(); const book = addBook(input, 'one', { pages: 150 }); book.notes = 'PRIVATE NOTE'
    finish(input, 'one')
    const result = review(input)
    expect(result.metrics['01']?.value).toBe(1)
    expect(result.featuredIds.length).toBeLessThanOrEqual(2)
    book.title = 'Changed later'
    expect(JSON.stringify(result)).not.toContain('Changed later')
    expect(JSON.stringify(result)).not.toContain('PRIVATE NOTE')
  })
  test('canonical authors and series produce distinct breadth/depth facts', () => {
    const input = empty()
    const personId = 'person:author'
    input.catalog.people.push(personSchema.parse({ id: personId, displayName: field('person', personId, 'person.displayName', 'Author'), createdAt: at, updatedAt: at }))
    for (const id of ['a', 'b', 'c']) {
      addBook(input, id, { series: ['Shared Series'] }); finish(input, id)
      input.catalog.contributors.push(contributorSchema.parse({ id: `contributor:${id}`, personId, role: 'author', target: { type: 'work', id: `work:${id}` }, creditedAs: 'Author', position: 0 }))
    }
    const result = review(input)
    expect(result.metrics['04']?.value).toBe(1)
    expect(result.metrics['05']?.value).toBe(3)
    expect(result.metrics['05']?.detail).toBe('Author')
    expect(result.metrics['06']?.value).toBe(3)
    expect(result.featuredIds.includes('04') && result.featuredIds.includes('05')).toBe(false)
  })
})

function interval(id: string, time: string, minutes: number, options: Partial<ActivityInterval> = {}): ActivityInterval {
  return { id, workId: 'work:a', editionId: 'edition:a', deviceId: 'device:a', type: 'audio', start: Date.parse(time),
    end: Date.parse(time) + minutes * 60_000, active: minutes * 60_000, ...options }
}
describe('activity allocation', () => {
  test('exact overlapping intervals union; ambiguous pause clusters are excluded', () => {
    const a = interval('a', at, 60), b = interval('b', '2026-04-02T12:30:00Z', 60)
    const result = calculateActivity([a, b], quarter)
    expect(result.audioMinutes).toBe(90); expect(result.visits).toHaveLength(1)
    expect(result.visits[0]?.activeMinutes).toBe(90)
    expect(calculateActivity([a, { ...b, active: 30 * 60_000 }], quarter).totalMinutes).toBe(0)
    expect(calculateActivity([{ ...a, active: 30 * 60_000 }], quarter).audioMinutes).toBe(30)
    expect(calculateActivity([{ ...a, active: 30 * 60_000 }], quarter).visits).toHaveLength(0)
    expect(calculateActivity([{ ...a, active: 61 * 60_000 }], quarter).totalMinutes).toBe(0)
  })
  test('overlap across works and formats is not doubled or falsely attributed', () => {
    const result = calculateActivity([interval('a', at, 20), interval('b', at, 20, { workId: 'work:b', editionId: 'edition:b', type: 'text' })], quarter)
    expect(result.totalMinutes).toBe(20); expect(result.audioMinutes).toBe(0); expect(result.textMinutes).toBe(0)
    expect(result.engagedWorks).toEqual([]); expect(result.visits).toEqual([])
  })
  test('boundary splitting, pause uncertainty, DST and partial Monday weeks', () => {
    const q1 = reviewQuarter(2026, 1, 'Europe/Madrid')
    expect(q1.start).toBe('2025-12-31T23:00:00.000Z'); expect(q1.end).toBe('2026-03-31T22:00:00.000Z')
    const crossing = interval('boundary', '2026-03-31T21:50:00Z', 20)
    expect(calculateActivity([crossing], q1).totalMinutes).toBe(10)
    expect(calculateActivity([{ ...crossing, active: 10 * 60_000 }], q1).totalMinutes).toBe(0)
    const dst = interval('dst', '2026-03-29T00:30:00Z', 120)
    expect(calculateActivity([dst], q1).totalMinutes).toBe(120)
    expect(calculateActivity([dst], q1).activeDays).toBe(1)
    expect(calculateActivity([interval('midnight', '2026-04-02T23:55:00Z', 10)], quarter).activeDays).toBe(2)
    expect(reviewQuarter(2024, 1, 'UTC').end).toBe('2024-04-01T00:00:00.000Z')
  })
  test('visits join five-minute interruptions, exclude pauses and stop at work switches', () => {
    const a = interval('a', at, 15), b = interval('b', '2026-04-02T12:20:00Z', 15)
    expect(calculateActivity([a, b], quarter).visits[0]?.activeMinutes).toBe(30)
    expect(calculateActivity([a, { ...b, start: b.start + 1, end: b.end + 1 }], quarter).visits).toEqual([])
    const other = interval('other', '2026-04-02T12:16:00Z', 1, { workId: 'work:b', editionId: 'edition:b' })
    expect(calculateActivity([a, other, b], quarter).visits).toEqual([])
  })
  test('new EPUB slices count; old durations never acquire capture quality', () => {
    const input = empty(); addBook(input, 'epub')
    session(input, 'epub', at, 60, { source: { kind: 'local', method: 'epub-reader' } })
    expect(review(input).metrics['28']?.value).toBeUndefined()
    for (let i = 0; i < 120; i++) session(input, 'epub', new Date(Date.parse(at) + i * 30_000).toISOString(), 0.5, {
      source: { kind: 'local', method: 'epub-reader' }, activeCapture: { kind: 'epub-foreground', version: 1, captureId: 'test', intervalIndex: i,
        startReason: i ? 'checkpoint' : 'open', endReason: i === 119 ? 'close' : 'checkpoint' } })
    const result = review(input)
    expect(result.metrics['28']?.value).toBe(60); expect(result.metrics['16']?.value).toBe(1)
  })
  test('EPUB index gaps and new process instances cannot bridge visits', () => {
    const slices = Array.from({ length: 60 }, (_, i) => interval(String(i), new Date(Date.parse(at) + i * 30_000).toISOString(), 0.5, {
      type: 'text', capture: { kind: 'epub-foreground', version: 1, captureId: 'test', intervalIndex: i, startReason: i ? 'checkpoint' : 'open', endReason: 'checkpoint' } }))
    expect(calculateActivity(slices, quarter).visits).toHaveLength(1)
    expect(calculateActivity(slices.filter((_, i) => i !== 30), quarter).visits).toHaveLength(0)
    slices[30]!.capture!.captureId = 'new'
    expect(calculateActivity(slices, quarter).visits).toHaveLength(0)
  })
  test('five-minute days, ten-minute engagement, mixed weeks and edition language', () => {
    const input = empty(); addBook(input, 'audio', { medium: 'audiobook', language: 'es-ES' })
    session(input, 'audio', at, 10)
    for (const date of ['2026-04-03T12:00:00Z', '2026-04-04T12:00:00Z']) session(input, 'audio', date, 5)
    const result = review(input)
    expect(result.metrics['10']?.value).toBe(3); expect(result.metrics['13']?.value).toBe(1)
    expect(result.metrics['17']?.value).toBe(1); expect(result.metrics['19']?.value).toBe(1)
    expect(normalizeLanguage('eng')).toBe('en'); expect(normalizeLanguage('und')).toBeUndefined()
    const activity = calculateActivity([interval('audio', at, 10), interval('text', '2026-04-03T12:00:00Z', 10, { type: 'text' })], quarter)
    expect(activity.mixedWeeks).toBe(1)
  })
})

describe('personal bests', () => {
  const coverage = (q: ReturnType<typeof reviewQuarter>, id = '01', complete = true): MetricCoverage => ({
    quarter: q, metricId: id, ruleVersion: REVIEW_RULE_VERSION, captureVersion: 'manual-v1', complete, evidenceRefs: ['coverage:test'],
  })
  test('requires two completed comparable quarters, strict improvement and retained context', () => {
    const input = empty()
    for (const id of ['a', 'b', 'c']) { addBook(input, id); finish(input, id) }
    finish(input, 'a', '2025-10-10T12:00:00Z'); finish(input, 'a', '2026-01-10T12:00:00Z'); finish(input, 'b', '2026-01-11T12:00:00Z')
    const certificates = [coverage(quarter), coverage(reviewQuarter(2025, 4, 'UTC')), coverage(reviewQuarter(2026, 1, 'UTC'))]
    const earned = (all: MetricCoverage[]) => review(input, { coverage: all }).earned.find(b => b.id === '01')!
    expect(earned([]).personalBest).toBe(false)
    expect(earned(certificates.slice(0, 2)).personalBest).toBe(false)
    expect(earned(certificates).personalBest).toBe(true)
    expect(earned(certificates).comparisons.map(c => c.value)).toEqual([1, 2])
    expect(earned([...certificates, certificates[1]!]).personalBest).toBe(false)
    expect(earned(certificates.map((c, i) => i === 2 ? { ...c, complete: false } : c)).personalBest).toBe(false)
    expect(earned(certificates.map((c, i) => i === 2 ? { ...c, captureVersion: 'changed' } : c)).personalBest).toBe(false)
    finish(input, 'c', '2026-01-12T12:00:00Z')
    expect(earned(certificates).personalBest).toBe(false)
  })
  test('a duration record requires a whole displayed minute, never growth percentages', () => {
    const input = empty(); addBook(input, 'a', { medium: 'audiobook' })
    session(input, 'a', '2025-10-10T12:00:00Z', 60); session(input, 'a', '2026-01-10T12:00:00Z', 60)
    session(input, 'a', at, 60.5)
    const certificates = [coverage(quarter, '09'), coverage(reviewQuarter(2025, 4, 'UTC'), '09'), coverage(reviewQuarter(2026, 1, 'UTC'), '09')]
    expect(review(input, { coverage: certificates }).earned.find(b => b.id === '09')?.personalBest).toBe(false)
    session(input, 'a', '2026-04-03T12:00:00Z', 0.5)
    expect(review(input, { coverage: certificates }).earned.find(b => b.id === '09')?.personalBest).toBe(true)
    session(input, 'a', '2026-01-11T12:00:00Z', 0.5)
    expect(review(input, { coverage: certificates }).earned.find(b => b.id === '09')?.personalBest).toBe(false)
  })
})

test('output is permutation-invariant and invalid quarter/cutoff cannot award future achievements', () => {
  const input = empty(); addBook(input, 'b'); addBook(input, 'a'); finish(input, 'b'); finish(input, 'a')
  const first = review(input)
  input.catalog.readingEvents.reverse(); input.catalog.editions.reverse(); input.books = [...input.books].reverse()
  expect(review(input)).toEqual(first)
  expect(() => review(input, { knownAt: at })).toThrow('completed quarter')
  expect(() => review(input, { quarter: { ...quarter, end: at } })).toThrow('boundaries')
  expect(() => reviewQuarter(2026, 5, 'UTC')).toThrow('Invalid')
  expect(() => reviewQuarter(2026, 1, 'Bogus/Zone')).toThrow()
})

describe('surviving reflection evidence', () => {
  const locator = { href: 'chapter.xhtml', type: 'application/xhtml+xml', locations: { cfi: 'epubcfi(/6/2)' } }
  const annotation = (id: string, createdAt = at) => ({
    id, bookId: 'a', editionId: 'edition:a', assetId: 'asset:a', assetFingerprint: 'a'.repeat(64), locator,
    quote: 'A PRIVATE PASSAGE', prefix: '', suffix: '', note: '', tags: [], color: 'ochre' as const,
    createdAt, updatedAt: createdAt, deletedAt: undefined as string | undefined, anchor: { status: 'exact' as const },
    provenance: { source: 'epub-reader' as const, platform: 'ios' as const, toolkitVersion: 'test' },
  })
  test('deduplicates anchors, excludes deleted objects, counts creation not editing and leaks no text', () => {
    const input = empty(); addBook(input, 'a')
    const annotations = [annotation('a'), annotation('duplicate'), { ...annotation('deleted'), deletedAt: at },
      { ...annotation('old', '2026-03-31T12:00:00Z'), locator: { ...locator, href: 'old.xhtml' }, note: 'added in April', updatedAt: at },
      ...['b', 'c'].map((id, i) => ({ ...annotation(id, `2026-04-0${i + 3}T12:00:00Z`), locator: { ...locator, href: `${id}.xhtml` }, note: 'kept thought' })),
    ]
    input.readerAnnotations = [{ version: 1, bookId: 'a', editionId: 'edition:a', annotations, updatedAt: at }]
    let result = review(input)
    expect(result.metrics['22']?.value).toBe(3); expect(result.metrics['23']?.value).toBe(1)
    expect(result.metrics['24']?.value).toBe(3); expect(result.metrics['25']?.value).toBe(2)
    expect(JSON.stringify(result)).not.toContain('PRIVATE PASSAGE'); expect(JSON.stringify(result)).not.toContain('kept thought')
    annotations[0]!.note = 'added later'; annotations[0]!.updatedAt = '2026-08-02T00:00:00Z'
    result = review(input)
    expect(result.metrics['25']?.value).toBe(3)
    expect(result.earned.find(b => b.id === '25')?.fact).toBe('passages-saved-this-quarter-now-with-notes')
    annotations[0]!.deletedAt = '2026-08-03T00:00:00Z'; annotations[1]!.deletedAt = '2026-08-03T00:00:00Z'
    expect(review(input).metrics['22']?.value).toBe(2)
  })
  test('bookmark and note kinds stay separate; a path alone cannot prove a recording survives', () => {
    const input = empty(); addBook(input, 'a')
    const bookmark = { id: 'reader:bookmark', assetId: 'asset:a', assetFingerprint: 'a'.repeat(64), locator, createdAt: at, updatedAt: at }
    input.readerNavigation = [{ version: 1, bookId: 'a', editionId: 'edition:a', bookmarks: [bookmark, { ...bookmark, id: 'dupe' }], updatedAt: at }]
    const audioBase = { bookId: 'a', editionId: 'edition:a', assetId: 'asset:a', queueId: 'q', playbackSessionId: 's', snapshotRevision: 1,
      absolutePositionMs: 10_000, chapterId: null, createdAt: at, updatedAt: at }
    input.audioAnnotations = [
      { ...audioBase, id: 'bookmark', kind: 'bookmark', note: '' },
      { ...audioBase, id: 'bookmark-copy', kind: 'bookmark', note: '' },
      { ...audioBase, id: 'note', kind: 'text-note', note: 'PRIVATE AUDIO NOTE' },
      { ...audioBase, id: 'empty', kind: 'text-note', note: '  ' },
      { ...audioBase, id: 'voice', kind: 'voice-note', note: '', voiceRelativePath: 'private.m4a', voiceDurationMs: 3000 },
    ]
    let result = review(input)
    expect(result.metrics['20']?.value).toBe(1); expect(result.metrics['21']?.value).toBe(1)
    expect(result.metrics['26']?.value).toBe(1); expect(result.metrics['27']?.value).toBe(0)
    input.survivingVoiceNoteIds = ['voice']; result = review(input)
    expect(result.metrics['27']?.value).toBe(1)
    expect(JSON.stringify(result)).not.toContain('PRIVATE AUDIO NOTE'); expect(JSON.stringify(result)).not.toContain('private.m4a')
  })
})

test('an explicit page correction takes precedence without crossing edition formats', () => {
  const input = empty(); const book = addBook(input, 'a', { pages: 400 }); finish(input, 'a')
  book.metadataLocks = ['pageCount']; book.pageCount = 600
  expect(review(input).metrics['02']?.value).toBe(600)
  book.pageCount = 0
  expect(review(input).metrics['02']?.value).toBeUndefined()
})

test('a work switch without a completed session still ends a reading visit', () => {
  const input = empty(); addBook(input, 'a', { medium: 'audiobook' }); addBook(input, 'b', { medium: 'audiobook' })
  session(input, 'a', at, 15); session(input, 'a', '2026-04-02T12:20:00Z', 15)
  expect(review(input).metrics['16']?.value).toBe(1)
  const switchEvent = finish(input, 'b', '2026-04-02T12:17:00Z')
  input.catalog.readingEvents[input.catalog.readingEvents.indexOf(switchEvent)] = readingEventSchema.parse({ ...switchEvent, kind: 'resume' })
  expect(review(input).metrics['16']?.value).toBe(0)
})

test('ten-second checkpoints land exactly on ten- and thirty-minute thresholds', () => {
  const slices = Array.from({ length: 180 }, (_, i) => interval(String(i), new Date(Date.parse(at) + i * 10_000).toISOString(), 1 / 6, {
    type: 'text', capture: { kind: 'epub-foreground', version: 1, captureId: 'test', intervalIndex: i,
      startReason: i ? 'checkpoint' : 'open', endReason: i === 179 ? 'close' : 'checkpoint' },
  }))
  expect(calculateActivity(slices.slice(0, 60), quarter).engagedWorks).toEqual(['work:a'])
  expect(calculateActivity(slices, quarter).visits[0]?.activeMinutes).toBe(30)
})

test('genre contradictions across peers cannot hide behind unsupported labels', () => {
  expect(classifyGenres({ claims: [classification(['Fiction']).evidence.claims[0]!, classification(['Nonfiction']).evidence.claims[0]!] }).status).toBe('unresolved')
})

test('only a verified compatible provider edition fills missing page evidence', async () => {
  const { providerBookVariantSchema, editionIdentifiers } = await import('../src/metadata/model')
  const { attachMissingMetadata } = await import('../src/libby/enrichment-model')
  const input = empty(); const book = addBook(input, 'a'); finish(input, 'a')
  book.format = 'EPUB'; book.identifiers = ['9780156453806']
  const variant = providerBookVariantSchema.parse({ id: 'open-library:a', provider: 'open-library', providerName: 'Open Library', externalKey: 'OL1M', editionKey: 'OL1M', workKey: 'OL1W',
    title: 'a', workTitle: 'a', authors: ['Someone'], identifiers: editionIdentifiers(book.identifiers), verifiedEditionIdentifiers: editionIdentifiers(book.identifiers),
    medium: 'ebook', editionPageCount: 600, pageCount: 9000, observedAt: at, confidence: 1, providerRank: 0 })
  input.books = [attachMissingMetadata(book, variant)]
  const result = review(input)
  expect(result.metrics['02']?.value).toBe(600)
  expect(result.supportingBooks[0]?.editions[0]?.pageCount).toBe(600)
  expect(result.supportingBooks[0]?.editions[0]?.pageEvidenceRefs).toContain('open-library:OL1M')
  input.books = [attachMissingMetadata(book, { ...variant, medium: 'audiobook' })]
  expect(review(input).metrics['02']?.value).toBeUndefined()
})

test('invalid durations and repeated session IDs cannot inflate recorded time', () => {
  const input = empty(); addBook(input, 'a', { medium: 'audiobook' })
  const a = session(input, 'a', at, 60)
  session(input, 'a', at, 60, { sessionId: a.kind === 'session' ? a.sessionId : '', activeDurationMs: 120 * 60_000 })
  expect(review(input).metrics['09']?.value).toBeUndefined()
  expect(review(input).excludedEvidence).toHaveLength(2)
  expect(() => readingEventSchema.parse({ ...a, activeDurationMs: -1 })).toThrow()
})
