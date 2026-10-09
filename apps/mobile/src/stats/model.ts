import { calculateReadingFacts, type ReviewEvidence } from '../reviews/evidence'
import { monday, nextDate, reviewCalendar, type ReadingRange } from '../reviews/calendar'

export const STATS_PERIODS = ['month', 'quarter', 'year', 'all'] as const
export type StatsPeriod = typeof STATS_PERIODS[number]
export type StatsRequest = { period: StatsPeriod; offset: number; timezone: string; knownAt: string; compare?: boolean }
export type StatsBucket = { date: string; endDate: string; totalMs: number; textMs: number; audioMs: number; unclassifiedMs: number }
const civilMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)

export function statsRange(request: StatsRequest): ReadingRange {
  const calendar = reviewCalendar(request.timezone)
  if (!Number.isFinite(Date.parse(request.knownAt)) || !Number.isInteger(request.offset) || request.offset > 0) throw new Error('Invalid stats period')
  const [year, month] = calendar.date(Date.parse(request.knownAt)).split('-').map(Number)
  const span = request.period === 'year' ? 12 : request.period === 'quarter' ? 3 : 1
  const firstMonth = request.period === 'year' ? 0 : request.period === 'quarter' ? Math.floor((month! - 1) / 3) * 3 : month! - 1
  const startDay = request.period === 'all' ? '1900-01-01' : civilMonth(year!, firstMonth + request.offset * span)
  const endDay = civilMonth(year!, firstMonth + (request.offset + 1) * span)
  if (startDay < '1900-01-01') throw new Error('Stats periods begin in 1900')
  return { timezone: request.timezone, start: new Date(calendar.boundary(startDay)).toISOString(),
    end: request.period === 'all' ? request.knownAt : new Date(calendar.boundary(endDay)).toISOString() }
}

/** Compare civil days, not fixed milliseconds: DST must not move the comparison by an hour. */
export function statsComparisonRange(request: StatsRequest, range = statsRange(request)): ReadingRange | undefined {
  if (request.period === 'all') return undefined
  const previous = statsRange({ ...request, offset: request.offset - 1 })
  const now = Date.parse(request.knownAt)
  if (now >= Date.parse(range.end)) return previous
  const calendar = reviewCalendar(request.timezone)
  const currentDay = calendar.date(now)
  const elapsedDays = Math.round((Date.parse(`${currentDay}T12:00:00Z`) - Date.parse(`${calendar.date(Date.parse(range.start))}T12:00:00Z`)) / 86_400_000)
  const priorDay = nextDate(calendar.date(Date.parse(previous.start)), elapsedDays)
  const fraction = (now - calendar.boundary(currentDay)) / (calendar.boundary(nextDate(currentDay)) - calendar.boundary(currentDay))
  const cutoff = calendar.boundary(priorDay) + fraction * (calendar.boundary(nextDate(priorDay)) - calendar.boundary(priorDay))
  return { ...previous, end: new Date(Math.min(Date.parse(previous.end), cutoff)).toISOString() }
}

export function calculateStats(input: ReviewEvidence, request: StatsRequest) {
  const period = statsRange(request)
  const range = { ...period, end: new Date(Math.min(Date.parse(period.end), Date.parse(request.knownAt))).toISOString() }
  const facts = calculateReadingFacts(input, range, request.knownAt)
  const priorRange = request.compare ? statsComparisonRange(request, period) : undefined
  const prior = priorRange ? calculateReadingFacts(input, priorRange, request.knownAt) : undefined
  const calendar = reviewCalendar(request.timezone)
  const earliest = [...facts.evidence.map(e => e.effectiveAt), ...facts.activity.days.map(d => new Date(calendar.boundary(d.date)).toISOString())].sort()[0]
  const chartStart = request.period === 'all' ? earliest ? calendar.date(Date.parse(earliest)) : calendar.date(Date.parse(range.end)) : calendar.date(Date.parse(range.start))
  const chartEnd = calendar.date(Math.max(Date.parse(range.start), Date.parse(range.end) - 1))
  const days = new Map(facts.activity.days.map(day => [day.date, day]))
  const buckets = new Map<string, StatsBucket>()
  for (let day = chartStart; day <= chartEnd; day = nextDate(day)) {
    const key = request.period === 'month' ? day : request.period === 'quarter' ? monday(day) : request.period === 'year' ? day.slice(0, 7) + '-01' : day.slice(0, 4) + '-01-01'
    const bucket = buckets.get(key) ?? { date: day, endDate: day, totalMs: 0, textMs: 0, audioMs: 0, unclassifiedMs: 0 }
    const activity = days.get(day)
    bucket.endDate = day
    if (activity) for (const field of ['totalMs', 'textMs', 'audioMs', 'unclassifiedMs'] as const) bucket[field] += activity[field]
    buckets.set(key, bucket)
  }
  return { period, range, knownAt: request.knownAt, facts, prior, priorRange, buckets: [...buckets.values()] }
}
export type ReadingStats = ReturnType<typeof calculateStats>
