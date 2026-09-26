import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewKeepsakeRepository } from '../src/reviews/keepsake-repository'
import { keepsakeSchema, pathwayPresentation, type ReviewArtworkManifest } from '../src/reviews/keepsake-model'
import { REVIEW_GENRES } from '../src/reviews/genres'
import { QuarterlyReviewRepository } from '../src/reviews/repository'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage, STORAGE_MIGRATIONS } from '../src/storage/migrations'
import type { SqlValue } from '../src/storage/database'
import { BunSqliteDatabase } from './storage-test-database'
import { reviewQuarter } from '../src/reviews/calendar'

const period = { year: 2026, quarter: 2 }
const createdAt = '2026-07-02T12:00:00.000Z'
const artwork = { achievementVersion: 'seals-test-v1', pathways: Object.fromEntries(REVIEW_GENRES.map(genre => [genre,
  { version: 'test-v1', animation: `${genre}:frames:v1`, finishedStill: `${genre}:still:v1` }])) } as ReviewArtworkManifest
const databases: BunSqliteDatabase[] = []
afterEach(async () => { for (const database of databases.splice(0)) await database.close() })
class FaultDatabase extends BunSqliteDatabase {
  fail = ''
  override async run(statement: string, values?: readonly SqlValue[]) {
    if (this.fail && statement.includes(this.fail)) throw new Error('Injected storage failure')
    return super.run(statement, values)
  }
}
async function setup(options: { empty?: boolean; database?: FaultDatabase } = {}) {
  const database = options.database ?? new FaultDatabase(); databases.push(database)
  await migrateStorage(database)
  const library = new LibraryRepository(database)
  if (!options.empty) {
    const book = { id: 'keepsake-book', title: 'A saved title', authors: ['An author'], pageCount: 430, rating: 4, notes: 'PRIVATE NOTE NEVER COPIED',
      shelf: 'tbr' as const, progress: 0, currentPage: 0, addedAt: '2026-04-01T00:00:00.000Z', lastUpdatedAt: '2026-04-01T00:00:00.000Z' }
    await library.save(book)
    await library.saveManual(book, { ...book, shelf: 'finished', progress: 100, finishedAt: '2026-05-01T12:00:00.000Z' }, { id: 'finish-keepsake' })
  }
  const repository = new ReviewKeepsakeRepository(database, { now: () => new Date(createdAt), deviceTimezone: () => 'Europe/Madrid' })
  return { database, repository, library }
}

test('first opening commits once; edits, missing evidence and new artwork never recalculate saved facts', async () => {
  const { database, repository, library } = await setup()
  const first = await repository.open(period, artwork)
  expect(first.keepsake.facts.metrics['01']?.value).toBe(1)
  expect(first.keepsake.facts.supportingBooks[0]?.title).toBe('A saved title')
  expect(first.keepsake.facts.earned.length).toBeGreaterThan(1)
  expect(JSON.stringify(first.keepsake)).not.toContain('PRIVATE NOTE')
  const book = (await library.list())[0]!
  await library.saveManual(book, { ...book, title: 'Changed title', finishedAt: '2026-03-31T12:00:00.000Z' }, { id: 'correct-keepsake' })
  expect((await new QuarterlyReviewRepository(database).calculate({ quarter: first.keepsake.facts.quarter, knownAt: createdAt })).metrics['01']?.value).toBe(0)
  expect(await repository.open(period, { ...artwork, achievementVersion: 'v2' })).toEqual(first)
  expect(await database.query('SELECT id FROM review_keepsakes')).toHaveLength(1)
  await database.execute('PRAGMA foreign_keys = OFF; DROP TABLE reading_events;')
  expect(await repository.open(period, artwork)).toEqual(first)
})

test('initial write failure rolls back settings and quarter assignment; retry succeeds', async () => {
  const { database, repository } = await setup()
  database.fail = 'INSERT INTO review_keepsakes'
  await expect(repository.open(period, artwork)).rejects.toThrow('Injected storage failure')
  for (const table of ['review_keepsakes', 'review_quarters', 'review_settings']) expect(await database.query(`SELECT * FROM ${table}`)).toHaveLength(0)
  database.fail = ''
  expect((await repository.open(period, artwork)).keepsake.facts.earned.length).toBeGreaterThan(0)
})

test('interrupted steps reopen paused; completion and replay retain facts and identity', async () => {
  const { repository, database } = await setup()
  const first = (await repository.open(period, artwork)).keepsake
  const next = first.steps[1]!
  await repository.saveProgress(period, next.id)
  await repository.setIdentity(period, { status: 'chosen', genre: 'horror' })
  const reopened = await new ReviewKeepsakeRepository(database).open(period, artwork)
  expect(reopened).toMatchObject({ step: next, paused: true, contentVisible: true })
  expect(reopened.keepsake.facts).toEqual(first.facts)
  expect((await repository.restart(period)).step).toEqual(first.steps[0]!)
  await repository.complete(period)
  const replay = await repository.restart(period)
  expect(replay.keepsake.completedAt).toBe(createdAt)
  expect(replay.keepsake.identity).toEqual({ status: 'chosen', genre: 'horror' })
  expect((await repository.open(period, artwork)).step.kind).toBe('collection')
  expect((await repository.get(period))?.facts).toEqual(first.facts)
  await repository.setIdentity(period, { status: 'removed' })
  expect((await repository.get(period))?.completedAt).toBe(createdAt)
})

test('invalid commands, unsupported versions and failed writes leave last-good bytes intact', async () => {
  const { repository, database } = await setup()
  const saved = (await repository.open(period, artwork)).keepsake
  const before = await database.query('SELECT * FROM review_keepsakes')
  await expect(repository.saveProgress(period, 'other-review:badge:01')).rejects.toThrow()
  await expect(repository.complete(period)).rejects.toThrow()
  database.fail = 'UPDATE review_keepsakes'
  await expect(repository.setIdentity(period, { status: 'skipped' })).rejects.toThrow()
  database.fail = ''
  expect(await database.query('SELECT * FROM review_keepsakes')).toEqual(before)
  const future = JSON.stringify({ ...saved, schemaVersion: 2 })
  await database.run('UPDATE review_keepsakes SET payload_json = ?', [future])
  await expect(repository.open(period, artwork)).rejects.toThrow()
  await expect(repository.restart(period)).rejects.toThrow()
  expect(await database.query('SELECT payload_json FROM review_keepsakes')).toEqual([{ payload_json: future }])
})

test('travel keeps boundaries; explicit timezone changes begin next quarter', async () => {
  const { repository, database } = await setup({ empty: true })
  const first = (await repository.open(period, artwork)).keepsake
  const traveler = new ReviewKeepsakeRepository(database, { now: () => new Date('2026-07-03T00:00:00Z'), deviceTimezone: () => 'Pacific/Honolulu' })
  expect((await traveler.settings()).initialTimezone).toBe('Europe/Madrid')
  expect((await traveler.open(period, artwork)).keepsake).toEqual(first)
  expect((await traveler.changeTimezone('America/New_York')).changes).toEqual([{ from: { year: 2026, quarter: 4 }, timezone: 'America/New_York' }])
  const afterQuarter = new ReviewKeepsakeRepository(database, { now: () => new Date('2026-10-02T12:00:00Z') })
  expect((await afterQuarter.open({ year: 2026, quarter: 3 }, artwork)).keepsake.facts.quarter.timezone).toBe('Europe/Madrid')
  const nextYear = new ReviewKeepsakeRepository(database, { now: () => new Date('2027-01-02T12:00:00Z') })
  expect((await nextYear.open({ year: 2026, quarter: 4 }, artwork)).keepsake.facts.quarter).toEqual(reviewQuarter(2026, 4, 'America/New_York'))
  expect(await database.query('SELECT * FROM review_keepsakes')).toHaveLength(3)
  await expect(traveler.changeTimezone('not/a-zone')).rejects.toThrow()
})

test('dismiss/delete suppress invitations; recreation preserves quarter assignment and reading history', async () => {
  const { repository, database } = await setup()
  expect(await repository.invitation()).toEqual(reviewQuarter(2026, 2, 'Europe/Madrid'))
  await repository.dismissInvitation(period)
  expect(await repository.invitation()).toBeNull()
  const first = (await repository.open(period, artwork)).keepsake
  const evidenceBefore = await database.query('SELECT * FROM reading_events')
  database.fail = 'DELETE FROM review_keepsakes'
  await expect(repository.delete(period)).rejects.toThrow()
  expect(await repository.get(period)).toEqual(first)
  database.fail = ''
  await repository.delete(period)
  expect(await repository.list()).toEqual([])
  expect(await repository.invitation()).toBeNull()
  expect(await database.query('SELECT * FROM reading_events')).toEqual(evidenceBefore)
  expect((await repository.open(period, artwork)).keepsake.facts).toEqual(first.facts)
  await repository.delete(period)
  expect(await repository.invitation()).toBeNull()
})

test('empty review can complete; future and empty historical quarters cannot generate', async () => {
  const { repository } = await setup({ empty: true })
  const saved = (await repository.open(period, artwork)).keepsake
  expect(saved.facts.earned).toEqual([])
  expect(saved.steps.map(s => s.kind)).toEqual(['reflection', 'pathway', 'collection'])
  await repository.setIdentity(period, { status: 'skipped' })
  await repository.complete(period)
  expect((await repository.open(period, artwork)).step.kind).toBe('collection')
  await expect(repository.open({ year: 2026, quarter: 1 }, artwork)).rejects.toThrow('No qualifying evidence')
  await expect(repository.open({ year: 2026, quarter: 3 }, artwork)).rejects.toThrow('completed quarter')
})

test('unavailable old animation keeps its still, facts and navigation', async () => {
  const { repository } = await setup()
  await repository.open(period, artwork)
  const saved = await repository.setIdentity(period, { status: 'chosen', genre: 'fantasy' })
  const before = structuredClone(saved)
  expect(pathwayPresentation(saved, key => key.includes(':still:'))).toEqual({ version: 'test-v1', animation: null, finishedStill: 'fantasy:still:v1', stillAvailable: true })
  expect(pathwayPresentation(saved, () => false)?.stillAvailable).toBe(false)
  expect(saved).toEqual(before)
})

test('schema rejects incomplete selection and private payload without reinterpreting rule versions', async () => {
  const { repository } = await setup()
  const saved = (await repository.open(period, artwork)).keepsake
  expect(keepsakeSchema.parse({ ...saved, facts: { ...saved.facts, ruleVersion: 'old-semantic-v0' } }).facts.ruleVersion).toBe('old-semantic-v0')
  for (const facts of [{ ...saved.facts, note: 'private' }, { ...saved.facts, revealIds: ['unearned'] },
    { ...saved.facts, featuredIds: [...saved.facts.featuredIds, saved.facts.featuredIds[0]] }]) expect(keepsakeSchema.safeParse({ ...saved, facts }).success).toBe(false)
  expect(keepsakeSchema.safeParse({ ...saved, steps: saved.steps.slice(1) }).success).toBe(false)
})

test('disk restart preserves offline entry and timezone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wovenleaf-keepsake-'))
  try {
    const path = join(directory, 'library.db'), first = new FaultDatabase(path)
    const { repository } = await setup({ database: first })
    await repository.open(period, artwork)
    await repository.setIdentity(period, { status: 'chosen', genre: 'fantasy' })
    await repository.saveProgress(period, 'review:2026-Q2:pathway')
    const expected = await repository.open(period, artwork)
    databases.splice(databases.indexOf(first), 1); await first.close()
    const reopened = new BunSqliteDatabase(path)
    try {
      await migrateStorage(reopened)
      const restored = new ReviewKeepsakeRepository(reopened, { deviceTimezone: () => 'Asia/Tokyo' })
      expect(await restored.open(period, artwork)).toEqual(expected)
      expect((await restored.settings()).initialTimezone).toBe('Europe/Madrid')
    } finally { await reopened.close() }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('additive migration preserves old rows, rolls back failure, and skips successful replay', async () => {
  const database = new FaultDatabase(); databases.push(database)
  await migrateStorage(database, { migrations: STORAGE_MIGRATIONS.slice(0, -1) })
  const before = await database.query('SELECT * FROM schema_migrations')
  database.fail = 'INSERT INTO schema_migrations'
  await expect(migrateStorage(database)).rejects.toThrow()
  expect(await database.query("SELECT name FROM sqlite_master WHERE name = 'review_keepsakes'")).toEqual([])
  expect(await database.query('SELECT * FROM schema_migrations')).toEqual(before)
  database.fail = ''
  await migrateStorage(database)
  expect(await new ReviewKeepsakeRepository(database).list()).toEqual([])
  const events: string[] = []
  await migrateStorage(database, { observe: e => events.push(e.type) })
  expect(events.every(e => e === 'skipped')).toBe(true)
})

test('personal-best comparison values, coverage, evidence and selection remain frozen after prior-quarter corrections', async () => {
  const { repository, library, database } = await setup()
  for (const [id, finishedAt] of [['previous-a', '2025-11-01T12:00:00.000Z'], ['previous-b', '2026-02-01T12:00:00.000Z'], ['current-b', '2026-05-02T12:00:00.000Z']]) {
    const book = { id: id!, title: id!, authors: ['Someone'], pageCount: 0, rating: 0, notes: '', shelf: 'tbr' as const,
      progress: 0, currentPage: 0, addedAt: finishedAt!, lastUpdatedAt: finishedAt! }
    await library.save(book)
    await library.saveManual(book, { ...book, shelf: 'finished', progress: 100, finishedAt }, { id: `finish-${id}` })
  }
  const coverage = [reviewQuarter(2025, 4, 'Europe/Madrid'), reviewQuarter(2026, 1, 'Europe/Madrid'), reviewQuarter(2026, 2, 'Europe/Madrid')]
    .map(quarter => ({ quarter, metricId: '01', ruleVersion: 'quarterly-evidence-v1', captureVersion: 'manual-test-v1', complete: true,
      evidenceRefs: [`test-coverage:${quarter.year}:${quarter.quarter}`] }))
  const first = (await repository.open(period, artwork, coverage)).keepsake
  const badge = first.facts.earned.find(b => b.id === '01')!
  expect(badge.personalBest).toBe(true)
  expect(badge.comparisons.map(c => c.value)).toEqual([1, 1])
  expect(badge.comparisons.every(c => c.refs.length && c.workIds.length && c.coverage.complete)).toBe(true)
  const previous = (await library.list()).find(b => b.id === 'previous-a')!
  await library.saveManual(previous, { ...previous, finishedAt: '2026-05-03T12:00:00.000Z' }, { id: 'move-comparison-finish' })
  const fresh = await new QuarterlyReviewRepository(database).calculate({ quarter: first.facts.quarter, knownAt: createdAt, coverage })
  expect(fresh.earned.find(b => b.id === '01')?.comparisons.map(c => c.value)).toEqual([0, 1])
  expect((await repository.open(period, artwork)).keepsake).toEqual(first)
})

test('failed deletion rolls back newly written invitation suppression', async () => {
  const { repository, database } = await setup()
  await repository.open(period, artwork)
  database.fail = 'DELETE FROM review_keepsakes'
  await expect(repository.delete(period)).rejects.toThrow()
  expect(await database.query('SELECT * FROM review_invitation_suppressions')).toEqual([])
  expect(await repository.get(period)).not.toBeNull()
})

test('quarter availability uses the saved zone at DST, year rollover and travel boundaries', async () => {
  const { database } = await setup({ empty: true })
  let now = '2026-03-31T21:59:59.999Z'
  const repo = new ReviewKeepsakeRepository(database, { now: () => new Date(now), deviceTimezone: () => 'Europe/Madrid' })
  expect((await repo.invitation())?.quarter).toBe(4)
  now = '2026-03-31T22:00:00.000Z'
  expect(await repo.invitation()).toEqual(reviewQuarter(2026, 1, 'Europe/Madrid'))
  now = '2026-12-31T23:00:00.000Z'
  expect(await repo.invitation()).toEqual(reviewQuarter(2026, 4, 'Europe/Madrid'))
})

test('a deleted empty keepsake can be recreated manually after it becomes historical', async () => {
  const { repository, database } = await setup({ empty: true })
  const original = (await repository.open(period, artwork)).keepsake
  await repository.delete(period)
  const later = new ReviewKeepsakeRepository(database, { now: () => new Date('2027-01-02T12:00:00Z'), deviceTimezone: () => 'Asia/Tokyo' })
  const recreated = (await later.open(period, artwork)).keepsake
  expect(recreated.facts.quarter).toEqual(original.facts.quarter)
  expect(recreated.facts.earned).toEqual([])
  expect(await database.query('SELECT * FROM review_invitation_suppressions')).toHaveLength(1)
})
