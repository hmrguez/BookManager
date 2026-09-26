import { readText, type SqlDatabase } from '../storage/database'
import { assertCredentialFree } from '../security'
import { reviewCalendar, reviewQuarter, type ReviewQuarter } from './calendar'
import type { ReviewRequest } from './evidence'
import { QuarterlyReviewRepository } from './repository'
import {
  keepsakeSchema, periodAt, reviewId, reviewIdentitySchema, reviewOrdinal, reviewPeriodSchema, reviewSettingsSchema,
  reviewSteps, reviewTimezoneSchema, saveableReviewFacts, savedQuarterSchema,
  type ReviewArtworkManifest, type ReviewIdentity, type ReviewKeepsake, type ReviewPeriod, type ReviewSettings,
} from './keepsake-model'

type KeepsakeOptions = { now?: () => Date; deviceTimezone?: () => string; voiceExists?: (path: string) => Promise<boolean> }
export class ReviewKeepsakeRepository {
  private readonly database: SqlDatabase
  private readonly options: KeepsakeOptions
  constructor(database: SqlDatabase, options: KeepsakeOptions = {}) {
    this.database = database
    this.options = options
  }

  private now() { return (this.options.now?.() ?? new Date()).toISOString() }

  /** Idempotent, and independent of subsequent device timezone changes. */
  async settings(): Promise<ReviewSettings> {
    return this.database.transaction(database => this.readSettings(database))
  }

  private async readSettings(database: SqlDatabase): Promise<ReviewSettings> {
    const [row] = await database.query('SELECT payload_json FROM review_settings WHERE id = 1')
    if (row) return reviewSettingsSchema.parse(JSON.parse(readText(row, 'payload_json')))
    const settings = reviewSettingsSchema.parse({ schemaVersion: 1,
      initialTimezone: this.options.deviceTimezone?.() ?? Intl.DateTimeFormat().resolvedOptions().timeZone, changes: [] })
    await database.run('INSERT INTO review_settings(id, payload_json) VALUES (1, ?)', [JSON.stringify(settings)])
    return settings
  }

  async changeTimezone(timezone: string): Promise<ReviewSettings> {
    reviewTimezoneSchema.parse(timezone)
    return this.database.transaction(async database => {
      const settings = await this.readSettings(database)
      const next = periodAt(reviewOrdinal(currentPeriod(settings, this.now())) + 1)
      // A second request before the boundary changes the pending setting, never historical assignments.
      const changes = settings.changes.filter(c => reviewOrdinal(c.from) < reviewOrdinal(next))
      const updated = reviewSettingsSchema.parse({ ...settings, changes: [...changes, { from: next, timezone }] })
      await database.run('UPDATE review_settings SET payload_json = ? WHERE id = 1', [JSON.stringify(updated)])
      return updated
    })
  }

  private async read(database: SqlDatabase, period: ReviewPeriod): Promise<ReviewKeepsake | null> {
    const id = reviewId(reviewPeriodSchema.parse(period))
    const [row] = await database.query('SELECT payload_json FROM review_keepsakes WHERE id = ?', [id])
    if (!row) return null
    const saved = keepsakeSchema.parse(JSON.parse(readText(row, 'payload_json')))
    if (saved.id !== id) throw new Error('Saved review identity does not match its storage key')
    return saved
  }

  async get(period: ReviewPeriod) { return this.read(this.database, period) }

  async list(): Promise<ReviewKeepsake[]> {
    return this.database.transaction(async database => {
      const rows = await database.query('SELECT id, payload_json FROM review_keepsakes ORDER BY id DESC')
      return rows.map(row => {
        const saved = keepsakeSchema.parse(JSON.parse(readText(row, 'payload_json')))
        if (saved.id !== readText(row, 'id')) throw new Error('Saved review identity does not match its storage key')
        return saved
      })
    })
  }

  /** No playback content escapes until both calculation and persistence have committed. */
  async open(period: ReviewPeriod, artwork: ReviewArtworkManifest, coverage?: ReviewRequest['coverage']) {
    reviewPeriodSchema.parse(period)
    return this.database.transaction(async database => {
      const existing = await this.read(database, period)
      if (existing) return viewingEntry(existing)
      const settings = await this.readSettings(database)
      const id = reviewId(period)
      const [assignment] = await database.query('SELECT payload_json FROM review_quarters WHERE id = ?', [id])
      const quarter = assignment ? savedQuarterSchema.parse(JSON.parse(readText(assignment, 'payload_json')))
        : reviewQuarter(period.year, period.quarter, timezoneFor(settings, period))
      if (reviewId(quarter) !== id) throw new Error('Saved quarter identity does not match its storage key')
      const createdAt = this.now()
      // Historical manual generation needs evidence; the latest completed quarter also permits an empty reflection.
      const facts = saveableReviewFacts(await new QuarterlyReviewRepository(database, this.options)
        .calculateInTransaction(database, { quarter, knownAt: createdAt, coverage }))
      const latest = latestCompleted(settings, createdAt)
      if (!assignment && reviewOrdinal(period) < reviewOrdinal(latest) && !hasQualifyingEvidence(facts)) throw new Error('No qualifying evidence for this historical quarter')
      const steps = reviewSteps(id, facts.revealIds)
      const saved = keepsakeSchema.parse({ schemaVersion: 1, id, createdAt, facts, artwork, steps,
        identity: { status: 'unselected' }, completedAt: null, progress: { stepId: steps[0]!.id, updatedAt: createdAt } })
      assertCredentialFree(saved)
      if (!assignment) await database.run('INSERT INTO review_quarters(id, payload_json) VALUES (?, ?)', [id, JSON.stringify(quarter)])
      await database.run('INSERT INTO review_keepsakes(id, payload_json) VALUES (?, ?)', [id, JSON.stringify(saved)])
      return viewingEntry(saved)
    })
  }

  private async mutate(period: ReviewPeriod, change: (saved: ReviewKeepsake, now: string) => void) {
    return this.database.transaction(async database => {
      const saved = await this.read(database, period)
      if (!saved) throw new Error('Saved review not found')
      change(saved, this.now())
      const validated = keepsakeSchema.parse(saved)
      assertCredentialFree(validated)
      await database.run('UPDATE review_keepsakes SET payload_json = ? WHERE id = ?', [JSON.stringify(validated), validated.id])
      return validated
    })
  }

  async setIdentity(period: ReviewPeriod, identity: Exclude<ReviewIdentity, { status: 'unselected' }>) {
    const parsed = reviewIdentitySchema.parse(identity)
    if (parsed.status === 'unselected') throw new Error('Choose, skip or remove the identity')
    return this.mutate(period, saved => { saved.identity = parsed })
  }

  /** Call on step entry, before starting animation. Animation clocks are deliberately ephemeral. */
  async saveProgress(period: ReviewPeriod, stepId: string) {
    return this.mutate(period, (saved, now) => { saved.progress = { stepId, updatedAt: now } })
  }

  async complete(period: ReviewPeriod) {
    return this.mutate(period, (saved, now) => {
      saved.completedAt ??= now
      saved.progress = { stepId: saved.steps.at(-1)!.id, updatedAt: now }
    })
  }

  /** Replay does not clear completion. A subsequent ordinary open still lands in the collection. */
  async restart(period: ReviewPeriod) {
    const saved = await this.mutate(period, (saved, now) => { saved.progress = { stepId: saved.steps[0]!.id, updatedAt: now } })
    return { keepsake: saved, step: saved.steps[0]!, paused: true as const, contentVisible: true as const }
  }

  async dismissInvitation(period: ReviewPeriod) {
    reviewPeriodSchema.parse(period)
    await this.database.transaction(database => this.suppress(database, period))
  }

  private async suppress(database: SqlDatabase, period: ReviewPeriod) {
    await database.run('INSERT OR IGNORE INTO review_invitation_suppressions(quarter_id, suppressed_at) VALUES (?, ?)', [reviewId(period), this.now()])
  }

  async delete(period: ReviewPeriod) {
    reviewPeriodSchema.parse(period)
    await this.database.transaction(async database => {
      // Retain the quarter assignment and suppression even after manual recreation.
      await this.suppress(database, period)
      await database.run('DELETE FROM review_keepsakes WHERE id = ?', [reviewId(period)])
    })
  }

  /** The latest quarter remains reachable after its notification is dismissed. */
  async latestPeriod(): Promise<ReviewPeriod> {
    return this.database.transaction(async database => latestCompleted(await this.readSettings(database), this.now()))
  }

  async invitation(): Promise<ReviewQuarter | null> {
    return this.database.transaction(async database => {
      const settings = await this.readSettings(database)
      const period = latestCompleted(settings, this.now())
      const id = reviewId(period)
      const suppressed = await database.query('SELECT quarter_id FROM review_invitation_suppressions WHERE quarter_id = ?', [id])
      if (suppressed.length || await this.read(database, period)) return null
      const [row] = await database.query('SELECT payload_json FROM review_quarters WHERE id = ?', [id])
      return row ? savedQuarterSchema.parse(JSON.parse(readText(row, 'payload_json')))
        : reviewQuarter(period.year, period.quarter, timezoneFor(settings, period))
    })
  }
}

function hasQualifyingEvidence(facts: ReviewKeepsake['facts']) {
  return Object.values(facts.metrics).some(metric => metric.value !== undefined && metric.value > 0)
}
function timezoneFor(settings: ReviewSettings, period: ReviewPeriod) {
  return settings.changes.filter(c => reviewOrdinal(c.from) <= reviewOrdinal(period)).at(-1)?.timezone ?? settings.initialTimezone
}
function currentPeriod(settings: ReviewSettings, now: string) {
  const day = reviewCalendar(settings.initialTimezone).date(Date.parse(now))
  const nominal = reviewOrdinal({ year: Number(day.slice(0, 4)), quarter: Math.ceil(Number(day.slice(5, 7)) / 3) })
  // Check both sides of a timezone change near midnight instead of using the travelling device's date.
  for (const ordinal of [nominal + 1, nominal, nominal - 1]) {
    const period = periodAt(ordinal)
    if (Date.parse(reviewQuarter(period.year, period.quarter, timezoneFor(settings, period)).start) <= Date.parse(now)) return period
  }
  throw new Error('Cannot determine current review quarter')
}
function latestCompleted(settings: ReviewSettings, now: string) {
  let ordinal = reviewOrdinal(currentPeriod(settings, now)) - 1
  let period = periodAt(ordinal)
  while (Date.parse(reviewQuarter(period.year, period.quarter, timezoneFor(settings, period)).end) > Date.parse(now)) period = periodAt(--ordinal)
  return period
}
export function viewingEntry(saved: ReviewKeepsake) {
  const step = saved.completedAt ? saved.steps.at(-1)! : saved.steps.find(step => step.id === saved.progress.stepId)!
  return { keepsake: saved, step, paused: true as const, contentVisible: true as const }
}
