import type { ActiveReadingCapture } from '../domain/catalog/active-capture'
import { monday, nextDate, reviewCalendar, type ReadingRange } from './calendar'

export type ActivityInterval = {
  id: string; workId: string; editionId: string; deviceId: string; type: 'text' | 'audio'
  start: number; end: number; active: number; capture?: ActiveReadingCapture
}
export type ActivityBoundary = { at: number; workId: string; type: 'text' | 'audio' }
type Piece = { start: number; end: number; active: number; works: string[]; editions: string[]; types: string[]; refs: string[] }
const add = (map: Map<string, number>, key: string, amount: number) => map.set(key, (map.get(key) ?? 0) + amount)
const unique = (values: string[]) => [...new Set(values)].sort()

export function calculateActivity(intervals: readonly ActivityInterval[], quarter: ReadingRange, boundaries: readonly ActivityBoundary[] = []) {
  const calendar = reviewCalendar(quarter.timezone)
  const start = Date.parse(quarter.start), end = Date.parse(quarter.end)
  const rejected: string[] = []
  const valid = intervals.filter(interval => {
    // Zero clock tolerance: uncertainty is excluded, never silently clamped.
    const ok = [interval.start, interval.end, interval.active].every(Number.isFinite)
      && interval.active > 0 && interval.end > interval.start && interval.active <= interval.end - interval.start
    if (!ok) rejected.push(interval.id)
    return ok
  }).sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
  const clusters: ActivityInterval[][] = []
  let clusterEnd = -Infinity
  for (const interval of valid) {
    if (interval.start >= clusterEnd) { clusters.push([]); clusterEnd = interval.end }
    clusters.at(-1)!.push(interval)
    clusterEnd = Math.max(clusterEnd, interval.end)
  }
  const pieces: Piece[] = []
  const visitIntervals: ActivityInterval[] = []
  for (const cluster of clusters) {
    const uncertain = cluster.some(i => i.active !== i.end - i.start)
    if (uncertain && cluster.length > 1) { rejected.push(...cluster.map(i => i.id)); continue }
    if (uncertain) {
      const i = cluster[0]!
      // An unknown pause cannot be allocated across a day or quarter boundary.
      if (i.start < start || i.end > end || calendar.date(i.start) !== calendar.date(i.end - 1)) {
        if (i.end > start && i.start < end) rejected.push(i.id)
        continue
      }
      pieces.push({ ...i, works: [i.workId], editions: [i.editionId], types: [i.type], refs: [i.id] })
      continue
    }
    const points = [...new Set(cluster.flatMap(i => [i.start, i.end]))].sort((a, b) => a - b)
    for (let index = 1; index < points.length; index++) {
      const left = Math.max(start, points[index - 1]!), right = Math.min(end, points[index]!)
      if (right <= left) continue
      const covering = cluster.filter(i => i.start < right && i.end > left)
      if (!covering.length) continue
      pieces.push({ start: left, end: right, active: right - left,
        works: unique(covering.map(i => i.workId)), editions: unique(covering.map(i => i.editionId)),
        types: unique(covering.map(i => i.type)), refs: unique(covering.map(i => i.id)) })
    }
    // Concurrent works/types cannot establish a single visit. Exact same-work duplicates
    // still contribute only their union, and remain auditable in the resulting facts.
    if (new Set(cluster.map(i => `${i.workId}:${i.type}:${i.deviceId}`)).size === 1) visitIntervals.push(...cluster)
  }
  const textDays = new Map<string, number>()
  const days = new Map<string, number>(), audioDays = new Map<string, number>(), workDays = new Map<string, number>()
  const textWeeks = new Map<string, number>(), audioWeeks = new Map<string, number>()
  const workMs = new Map<string, number>(), editionMs = new Map<string, number>()
  let audioMs = 0, textMs = 0, totalMs = 0
  const refs = new Set<string>()
  for (const piece of pieces) {
    totalMs += piece.active
    piece.refs.forEach(ref => refs.add(ref))
    if (piece.types.length === 1 && piece.types[0] === 'audio') audioMs += piece.active
    if (piece.types.length === 1 && piece.types[0] === 'text') textMs += piece.active
    if (piece.works.length === 1) add(workMs, piece.works[0]!, piece.active)
    if (piece.editions.length === 1) add(editionMs, piece.editions[0]!, piece.active)
    let cursor = piece.start
    while (cursor < piece.end) {
      const day = calendar.date(cursor)
      const next = Math.min(piece.end, calendar.boundary(nextDate(day)))
      const duration = piece.active === piece.end - piece.start ? next - cursor : piece.active
      add(days, day, duration)
      if (piece.works.length === 1) add(workDays, `${piece.works[0]}|${day}`, duration)
      if (piece.types.length === 1) {
        add(piece.types[0] === 'audio' ? audioWeeks : textWeeks, monday(day), duration)
        add(piece.types[0] === 'audio' ? audioDays : textDays, day, duration)
      }
      cursor = next
    }
  }
  const activeDays = [...days].filter(([, value]) => value >= 300_000).map(([day]) => day)
  const weekDays = new Map<string, number>()
  activeDays.forEach(day => add(weekDays, monday(day), 1))
  const perWorkDays = new Map<string, number>()
  for (const [key, value] of workDays) if (value >= 300_000) add(perWorkDays, key.split('|')[0]!, 1)
  const engagedWorks = [...workMs].filter(([, value]) => value >= 600_000).map(([work]) => work).sort()
  const editionMinutes = new Map([...editionMs].map(([id, ms]) => [id, ms / 60_000]))
  const visits = calculateVisits(visitIntervals, intervals, boundaries, start, end)
  return { audioMinutes: audioMs / 60_000, textMinutes: textMs / 60_000, totalMinutes: totalMs / 60_000,
    listeningDays: [...audioDays.values()].filter(value => value >= 300_000).length,
    activeDays: activeDays.length, activeWeeks: weekDays.size, steadyWeeks: [...weekDays.values()].filter(value => value >= 3).length,
    twentyMinuteDays: [...days.values()].filter(value => value >= 1_200_000).length,
    returnDays: Math.max(0, ...perWorkDays.values()),
    mixedWeeks: [...textWeeks].filter(([week, value]) => value >= 600_000 && (audioWeeks.get(week) ?? 0) >= 600_000).length,
    engagedWorks, editionMinutes, visits, refs: [...refs].sort(), rejected: unique(rejected),
    workIds: unique(pieces.flatMap(piece => piece.works)),
    days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, totalMs]) => ({ date, totalMs,
      textMs: textDays.get(date) ?? 0, audioMs: audioDays.get(date) ?? 0,
      unclassifiedMs: totalMs - (textDays.get(date) ?? 0) - (audioDays.get(date) ?? 0) })),
  }
}

function calculateVisits(eligible: ActivityInterval[], all: readonly ActivityInterval[], boundaries: readonly ActivityBoundary[], start: number, end: number) {
  const sorted = [...eligible].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
  const eligibleSet = new Set(eligible)
  const blockers = all.filter(i => !eligibleSet.has(i)).sort((a, b) => a.start - b.start)
  const blockerEnds: number[] = []
  for (const blocker of blockers) blockerEnds.push(Math.max(blocker.end, blockerEnds.at(-1) ?? -Infinity))
  const orderedBoundaries = [...boundaries].sort((a, b) => a.at - b.at)
  const visits: { workId: string; activeMs: number; refs: string[] }[] = []
  let prior: ActivityInterval | undefined
  let current: typeof visits[number] | undefined
  for (const interval of sorted) {
    const clippedStart = Math.max(start, interval.start), clippedEnd = Math.min(end, interval.end)
    if (clippedEnd <= clippedStart) continue
    const gap = prior ? interval.start - prior.end : Infinity
    const previous = prior
    const blockerIndex = lowerBound(blockers, interval.start, i => i.start) - 1
    let uninterruptedEvidence = !!previous && (blockerEnds[blockerIndex] ?? -Infinity) <= previous.end
    if (previous && uninterruptedEvidence) {
      for (let i = lowerBound(orderedBoundaries, previous.end, b => b.at); i < orderedBoundaries.length; i++) {
        const boundary = orderedBoundaries[i]!
        if (boundary.at > interval.start) break
        if (boundary.workId !== interval.workId || boundary.type !== interval.type) { uninterruptedEvidence = false; break }
      }
    }
    const captureContinuous = !interval.capture && !prior?.capture || !!(interval.capture && prior?.capture
      && interval.capture.captureId === prior.capture.captureId
      && interval.capture.intervalIndex === prior.capture.intervalIndex + 1
      && (interval.capture.startReason === 'checkpoint' && prior.capture.endReason === 'checkpoint' && gap === 0
        || interval.capture.startReason === 'resume' && prior.capture.endReason === 'pause'))
    const same = prior && current && prior.workId === interval.workId && prior.type === interval.type
      && prior.deviceId === interval.deviceId && gap <= 300_000 && uninterruptedEvidence && captureContinuous
    if (!same) {
      current = { workId: interval.workId, activeMs: 0, refs: [] }
      visits.push(current)
    }
    current!.activeMs += Math.max(0, clippedEnd - Math.max(clippedStart, same ? prior!.end : clippedStart))
    current!.refs.push(interval.id)
    if (!prior || !same || interval.end >= prior.end) prior = interval
  }
  return visits.filter(visit => visit.activeMs >= 1_800_000).map(({ activeMs, ...visit }) => ({ ...visit, activeMinutes: activeMs / 60_000 }))
}

function lowerBound<T>(values: readonly T[], value: number, key: (item: T) => number) {
  let low = 0, high = values.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (key(values[mid]!) < value) low = mid + 1
    else high = mid
  }
  return low
}
