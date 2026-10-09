import { deriveReadingState, type Catalog, type ReadingEvent } from '../domain/catalog'
import type { LibraryBook } from '../library-model'
import { exactEditionMatch } from '../libby/enrichment-model'
import { readerAnnotationStateSchema, readerNavigationStateSchema, type ReaderAnnotationState, type ReaderNavigationState } from '../reader/model'
import { audiobookAnnotationSchema, type AudiobookAnnotation } from '../playback/controls'
import { calculateActivity, type ActivityBoundary, type ActivityInterval } from './activity'
import { reviewCalendar, reviewQuarter, type ReviewQuarter, type ReadingRange } from './calendar'
import { REVIEW_BADGES, REVIEW_RULE_VERSION, REVIEW_SELECTION_VERSION, badgeDevelopment, selectBadges, type BadgeDefinition } from './catalogue'
import { genresForBooks, suggestGenre, type SubjectClaim } from './genres'

export type ReviewEvidence = {
  catalog: Catalog
  books: readonly LibraryBook[]
  /** Only explicit import/reading associations, never title matching. */
  bookEditions: readonly { bookId: string; editionId: string }[]
  embeddedSubjects?: readonly (SubjectClaim & { editionId: string })[]
  readerAnnotations?: readonly ReaderAnnotationState[]
  readerNavigation?: readonly ReaderNavigationState[]
  audioAnnotations?: readonly AudiobookAnnotation[]
  /** Actual file existence, not merely a stored path. Paths/text never enter the result. */
  survivingVoiceNoteIds?: readonly string[]
}
export type Metric = { value?: number; workIds: string[]; refs: string[]; detail?: string; unavailable?: string }
export type MetricCoverage = {
  quarter: ReviewQuarter; metricId: string; ruleVersion: string; captureVersion: string
  complete: boolean; evidenceRefs: readonly string[]
}
export type ReviewRequest = {
  quarter: ReviewQuarter; knownAt: string
  /** Explicit coverage evidence; absence never means complete tracking. */
  coverage?: readonly MetricCoverage[]
}
export type Comparison = { quarter: ReviewQuarter; value: number; coverage: MetricCoverage; refs: string[]; workIds: string[] }
export type EarnedBadge = BadgeDefinition & Metric & {
  value: number; tier: number; development: number; personalBest: boolean
  comparisons: Comparison[]; coverage?: MetricCoverage
}

export function calculateQuarterlyReview(input: ReviewEvidence, request: ReviewRequest) {
  const quarter = validateQuarter(request.quarter)
  const knownAt = Date.parse(request.knownAt)
  if (!Number.isFinite(knownAt) || knownAt < Date.parse(quarter.end)) throw new Error('A review requires a completed quarter and valid evidence cutoff')
  const current = calculateReadingFacts(input, quarter, request.knownAt)
  const earned: EarnedBadge[] = []
  const previousFacts = new Map<string, ReturnType<typeof calculateReadingFacts>>()
  for (const definition of REVIEW_BADGES) {
    const metric = current.metrics[definition.id]!
    const development = badgeDevelopment(metric.value, definition.thresholds)
    if (!development || metric.value === undefined) continue
    const coverage = uniqueCoverage(request.coverage ?? [], quarter, definition.id)
    const comparisons: Comparison[] = []
    if (coverage && validCoverage(coverage) && !current.uncertainMetrics.includes(definition.id)) {
      for (const previous of request.coverage ?? []) {
        if (previous.metricId !== definition.id || !validCoverage(previous) || previous.captureVersion !== coverage.captureVersion
          || previous.quarter.timezone !== quarter.timezone || Date.parse(previous.quarter.end) > Date.parse(quarter.start)
          || uniqueCoverage(request.coverage ?? [], previous.quarter, definition.id) !== previous) continue
        const priorQuarter = validateQuarter(previous.quarter)
        const key = `${priorQuarter.year}-${priorQuarter.quarter}`
        let facts = previousFacts.get(key)
        if (!facts) { facts = calculateReadingFacts(input, priorQuarter, request.knownAt); previousFacts.set(key, facts) }
        const prior = facts.metrics[definition.id]!
        if (prior.value === undefined || facts.uncertainMetrics.includes(definition.id)) continue
        comparisons.push({ quarter: priorQuarter, value: prior.value, coverage: structuredClone(previous), refs: prior.refs, workIds: prior.workIds })
      }
    }
    comparisons.sort((a, b) => a.quarter.start.localeCompare(b.quarter.start))
    // Durations are represented in minutes, so every metric has a one-unit display resolution.
    const personalBest = comparisons.length >= 2 && metric.value >= Math.max(...comparisons.map(c => c.value)) + 1
    earned.push({ ...definition, ...metric, value: metric.value, ...development, personalBest, comparisons,
      ...(coverage ? { coverage: structuredClone(coverage) } : {}) })
  }
  const selection = selectBadges(earned)
  return structuredClone({ quarter, knownAt: request.knownAt, ruleVersion: REVIEW_RULE_VERSION, selectionVersion: REVIEW_SELECTION_VERSION,
    metrics: current.metrics, earned, featuredIds: selection.featured.map(b => b.id), revealIds: selection.reveal.map(b => b.id),
    genre: current.genre, supportingBooks: current.supportingBooks, evidence: current.evidence,
    excludedEvidence: current.excludedEvidence,
  })
}

function validateQuarter(quarter: ReviewQuarter) {
  const expected = reviewQuarter(quarter.year, quarter.quarter, quarter.timezone)
  if (expected.start !== quarter.start || expected.end !== quarter.end) throw new Error('Review quarter boundaries do not match its saved timezone')
  return expected
}
function uniqueCoverage(all: readonly MetricCoverage[], quarter: ReviewQuarter, metricId: string) {
  const matches = all.filter(c => c.metricId === metricId && c.quarter.year === quarter.year && c.quarter.quarter === quarter.quarter)
  return matches.length === 1 && matches[0]!.quarter.start === quarter.start && matches[0]!.quarter.end === quarter.end
    && matches[0]!.quarter.timezone === quarter.timezone ? matches[0] : undefined
}
function validCoverage(coverage: MetricCoverage) {
  try { validateQuarter(coverage.quarter) } catch { return false }
  return coverage.complete && coverage.ruleVersion === REVIEW_RULE_VERSION && coverage.captureVersion.trim().length > 0 && coverage.evidenceRefs.length > 0
}
const sorted = (values: readonly string[]) => [...new Set(values)].sort()
const payloadFor = (event: ReadingEvent) => event.kind === 'correction'
  ? event.action.kind === 'replace' ? event.action.replacement : undefined : event
const isSeed = (event: ReadingEvent) => event.source.kind === 'migration' && event.source.migrationKey.includes('seeded-starter')

export function calculateReadingFacts(input: ReviewEvidence, quarter: ReadingRange, knownAt: string) {
  const { catalog } = input
  const start = Date.parse(quarter.start), end = Date.parse(quarter.end)
  const inQuarter = (at: string) => Date.parse(at) >= start && Date.parse(at) < end
  const calendar = reviewCalendar(quarter.timezone)
  const editions = new Map(catalog.editions.map(e => [String(e.id), e]))
  const bindings = [...input.bookEditions, ...input.books.flatMap(book => book.readingEditionId ? [{ bookId: book.id, editionId: book.readingEditionId }] : [])]
  const booksForEdition = (id: string) => input.books.filter(book => bindings.some(binding => binding.bookId === book.id && binding.editionId === id))
  const booksForWork = (workId: string) => input.books.filter(book => bindings.some(binding => binding.bookId === book.id && editions.get(binding.editionId)?.workId === workId))
  const active = catalog.editions.flatMap(edition => {
    const events = catalog.readingEvents.filter(event => event.editionId === edition.id)
    const state = deriveReadingState(edition.id, events, { knownAt })
    const ids = new Set(state.appliedEventIds)
    return events.filter(event => ids.has(event.id))
  }).sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt) || a.id.localeCompare(b.id))
  const excludedEvidence: string[] = []
  const finishes = new Map<string, ReadingEvent[]>()
  const intervals: ActivityInterval[] = []
  const boundaries: ActivityBoundary[] = []
  const sessionIds = new Map<string, string>()
  for (const event of active) {
    const payload = payloadFor(event)
    const edition = editions.get(event.editionId)!
    if (!payload || isSeed(event)) continue
    if (['start', 'resume', 'location', 'session'].includes(payload.kind)) {
      boundaries.push({ at: payload.kind === 'session' ? Date.parse(payload.startedAt) : Date.parse(event.effectiveAt),
        workId: edition.workId, type: edition.medium === 'audiobook' ? 'audio' : 'text' })
    }
    if (payload.kind === 'finish' && inQuarter(event.effectiveAt)) {
      const supported = event.timeConfidence === 1 && (event.source.kind === 'local' && event.source.method === 'manual'
        || event.source.kind === 'migration' || event.source.kind === 'integration' && event.source.integrationKey === 'goodreads-csv')
      if (!supported) { excludedEvidence.push(event.id); continue }
      finishes.set(edition.workId, [...finishes.get(edition.workId) ?? [], event])
    }
    if (payload.kind !== 'session') continue
    const supported = event.timeConfidence === 1 && Date.parse(payload.endedAt) <= Date.parse(knownAt) && event.source.kind === 'local'
      && (event.source.method === 'audio-player' && edition.medium === 'audiobook'
        || event.source.method === 'pdf-reader' && catalog.assets.some(a => a.id === event.assetId && a.editionId === edition.id && a.format === 'pdf')
        || event.source.method === 'epub-reader' && edition.medium === 'ebook' && payload.activeCapture?.kind === 'epub-foreground' && payload.activeCapture.version === 1)
    if (!supported) {
      if (Date.parse(payload.endedAt) > start && Date.parse(payload.startedAt) < end) excludedEvidence.push(event.id)
      continue
    }
    const previous = sessionIds.get(payload.sessionId)
    if (previous) {
      // Stable session IDs cannot describe two independent intervals.
      const existing = intervals.find(i => i.id === previous)
      if (existing && (existing.start !== Date.parse(payload.startedAt) || existing.end !== Date.parse(payload.endedAt)
        || existing.active !== payload.activeDurationMs || existing.workId !== edition.workId)) {
        existing.active = NaN
        excludedEvidence.push(event.id)
      }
      continue
    }
    sessionIds.set(payload.sessionId, event.id)
    intervals.push({ id: event.id, workId: edition.workId, editionId: edition.id, deviceId: event.deviceId,
      type: edition.medium === 'audiobook' ? 'audio' : 'text', start: Date.parse(payload.startedAt), end: Date.parse(payload.endedAt),
      active: payload.activeDurationMs, capture: payload.activeCapture })
  }
  const metrics: Record<string, Metric> = {}
  const metric = (id: string, value: number | undefined, workIds: string[], refs: string[], detail?: string) => {
    metrics[id] = { value, workIds: sorted(workIds), refs: sorted(refs), ...(detail ? { detail } : {}),
      ...(value === undefined ? { unavailable: 'insufficient-evidence' } : {}) }
  }
  const works = [...finishes.keys()].sort()
  const finishRefs = (ids: readonly string[]) => ids.flatMap(id => finishes.get(id)!.map(e => e.id))
  metric('01', works.length, works, finishRefs(works))
  const pageEvidence = new Map<string, { value?: number; refs: readonly string[] }>(catalog.editions.map(edition => {
    const unknown = { value: undefined as number | undefined, refs: [] as string[] }
    if (edition.medium === 'audiobook') return [edition.id, unknown] as const
    // A compatibility book with multiple attached editions cannot override one arbitrarily.
    const linkedBooks = booksForEdition(edition.id).filter(book =>
      new Set(bindings.filter(b => b.bookId === book.id).map(b => b.editionId)).size === 1 && !/audio/i.test(book.format ?? ''))
    const overrides = linkedBooks.filter(book => book.metadataLocks?.includes('pageCount'))
    if (overrides.length) return [edition.id, new Set(overrides.map(b => b.pageCount)).size === 1
      ? { value: overrides[0]!.pageCount || undefined, refs: overrides.map(b => `library-book:${b.id}:pageCount`) } : unknown] as const
    if (edition.pageCount) return [edition.id, { value: edition.pageCount.value,
      refs: [edition.id, ...(edition.pageCount.candidate.kind === 'source' ? [edition.pageCount.candidate.sourceRecordId] : [])] }] as const
    const variants = linkedBooks.flatMap(book => (book.metadataSelection?.variants ?? []).filter(variant =>
      variant.medium === edition.medium && exactEditionMatch(book, variant) && variant.editionPageCount))
    return [edition.id, new Set(variants.map(v => v.editionPageCount)).size === 1
      ? { value: variants[0]!.editionPageCount, refs: variants.map(v => `${v.provider}:${v.editionKey}`) } : unknown] as const
  }))
  const lengths = works.flatMap(workId => {
    const values = finishes.get(workId)!.flatMap(event => {
      const edition = editions.get(event.editionId)!
      if (edition.medium === 'audiobook') return []
      const pages = pageEvidence.get(edition.id)?.value
      return pages && Number.isInteger(pages) && pages > 0 ? [{ workId, pages, eventId: event.id, editionId: edition.id }] : []
    })
    // Different known edition lengths for the same finished Work are incompatible, not additive.
    return new Set(values.map(v => v.pages)).size === 1 ? values.slice(0, 1) : []
  })
  metric('02', lengths.length ? lengths.reduce((sum, v) => sum + v.pages, 0) : undefined, lengths.map(v => v.workId), lengths.flatMap(v => [v.eventId, v.editionId, ...pageEvidence.get(v.editionId)!.refs]))
  const longest = [...lengths].sort((a, b) => b.pages - a.pages || a.workId.localeCompare(b.workId))[0]
  metric('03', longest?.pages, longest ? [longest.workId] : [], longest ? [longest.eventId, longest.editionId] : [])
  const authorWorks = new Map<string, string[]>()
  const seriesWorks = new Map<string, string[]>()
  for (const work of works) {
    const contributors = catalog.contributors.filter(c => c.role === 'author' && (c.target.type === 'work' && c.target.id === work
      || c.target.type === 'edition' && finishes.get(work)!.some(e => e.editionId === c.target.id)))
    for (const id of new Set(contributors.map(c => c.personId))) {
      if (!catalog.people.some(p => p.id === id)) continue
      authorWorks.set(id, sorted([...(authorWorks.get(id) ?? []), work]))
    }
    const series = sorted(booksForWork(work).flatMap(b => b.series ?? []).map(s => s.trim().toLowerCase()).filter(Boolean))
    for (const id of series) seriesWorks.set(id, [...seriesWorks.get(id) ?? [], work])
  }
  const most = (map: Map<string, string[]>) => [...map].sort(([a, aw], [b, bw]) => bw.length - aw.length || a.localeCompare(b))[0]
  const author = most(authorWorks), series = most(seriesWorks)
  const authored = sorted([...authorWorks.values()].flat())
  metric('04', authorWorks.size || undefined, authored, [...finishRefs(authored), ...authorWorks.keys()])
  metric('05', author?.[1].length, author?.[1] ?? [], author ? [...finishRefs(author[1]), author[0]] : [], author ? catalog.people.find(p => p.id === author[0])?.displayName.value : undefined)
  metric('06', series?.[1].length, series?.[1] ?? [], series ? finishRefs(series[1]) : [], series?.[0])
  const short = lengths.filter(v => v.pages <= 200).map(v => v.workId)
  metric('07', lengths.length ? short.length : undefined, short, finishRefs(short))
  const rated = works.filter(work => {
    const ratings = booksForWork(work).map(b => b.rating).filter(r => r > 0)
    return ratings.length > 0 && new Set(ratings).size === 1 && ratings[0]! >= 4
  })
  metric('08', rated.length, rated, finishRefs(rated))
  const activity = calculateActivity(intervals, quarter, boundaries)
  const activityValues: Record<string, number | undefined> = {
    '09': activity.audioMinutes, '10': activity.listeningDays, '11': activity.activeDays,
    '12': activity.activeWeeks, '13': activity.steadyWeeks, '14': activity.twentyMinuteDays, '15': activity.returnDays,
    '16': activity.visits.length, '17': activity.engagedWorks.length, '18': activity.mixedWeeks, '28': activity.textMinutes,
  }
  for (const [id, value] of Object.entries(activityValues)) metric(id,
    !activity.refs.length || ['09', '10'].includes(id) && !activity.audioMinutes || id === '28' && !activity.textMinutes
      ? undefined : value, activity.workIds, activity.refs)
  const languages = sorted([...activity.editionMinutes].flatMap(([id, minutes]) => {
    if (minutes < 10) return []
    const language = normalizeLanguage(editions.get(id)?.language.value)
    return language ? [language] : []
  }))
  metric('19', languages.length || undefined, activity.engagedWorks, activity.refs, languages.join(', '))
  const objects = reflectionObjects(input, editions, knownAt).filter(o => inQuarter(o.createdAt))
  const objectMetric = (id: string, matching: typeof objects, value = matching.length) => metric(id, value, matching.map(o => o.workId), matching.map(o => o.id))
  objectMetric('20', objects.filter(o => o.kind === 'reader-bookmark'))
  objectMetric('21', objects.filter(o => o.kind === 'audio-bookmark'))
  const passages = objects.filter(o => o.kind === 'passage')
  objectMetric('22', passages)
  objectMetric('23', passages, new Set(passages.map(o => o.workId)).size)
  objectMetric('24', passages, new Set(passages.map(o => calendar.date(Date.parse(o.createdAt)))).size)
  objectMetric('25', passages.filter(o => o.hasNote))
  objectMetric('26', objects.filter(o => o.kind === 'audio-note'))
  objectMetric('27', objects.filter(o => o.kind === 'voice-note'))
  metric('29', undefined, [], []); metric('30', undefined, [], [])
  metrics['29']!.unavailable = metrics['30']!.unavailable = 'consumption-capture-unavailable'
  const genre = suggestGenre(works.map(workId => ({ workId, classification: genresForBooks(booksForWork(workId),
    (input.embeddedSubjects ?? []).filter(c => editions.get(c.editionId)?.workId === workId)) })))
  const supportingBooks = sorted([...works, ...activity.workIds, ...objects.map(o => o.workId)]).map(workId => ({
    workId, title: booksForWork(workId).find(b => b.metadataLocks?.includes('title'))?.title
      ?? catalog.works.find(w => w.id === workId)?.title.value ?? booksForWork(workId)[0]?.title ?? '',
    editions: catalog.editions.filter(e => e.workId === workId).map(e => ({ id: e.id, title: e.title.value, medium: e.medium,
      language: e.language.value, pageCount: pageEvidence.get(e.id)?.value ?? null,
      pageEvidenceRefs: pageEvidence.get(e.id)?.refs ?? [] })).sort((a, b) => a.id.localeCompare(b.id)),
    books: booksForWork(workId).map(b => ({ id: b.id, title: b.title, rating: b.rating, series: b.series ?? [] })).sort((a, b) => a.id.localeCompare(b.id)),
    authors: catalog.people.filter(person => catalog.contributors.some(c => c.personId === person.id && c.role === 'author'
      && (c.target.type === 'work' && c.target.id === workId || c.target.type === 'edition' && editions.get(c.target.id)?.workId === workId)))
      .map(person => ({ id: person.id, name: person.displayName.value })).sort((a, b) => a.id.localeCompare(b.id)),
  }))
  const evidenceIds = new Set([...finishRefs(works), ...activity.refs])
  const captureByEvent = new Map(intervals.map(i => [i.id, i.capture]))
  const evidence = active.filter(e => evidenceIds.has(e.id)).map(e => ({
    id: e.id, editionId: e.editionId, source: e.source, effectiveAt: e.effectiveAt, recordedAt: e.recordedAt,
    timeConfidence: e.timeConfidence, correctionTargets: e.kind === 'correction' ? e.targetEventIds : [],
    capture: captureByEvent.get(e.id) ?? null,
  }))
  const excluded = sorted([...excludedEvidence, ...activity.rejected])
  return { metrics, genre, supportingBooks, evidence, excludedEvidence: excluded, activity,
    // Coverage certificates cannot rehabilitate explicitly rejected evidence.
    uncertainMetrics: excluded.length ? REVIEW_BADGES.map(b => b.id) : ['08', '25'],
  }
}

export function normalizeLanguage(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const language = new Intl.Locale(value).language
    return ['und', 'mul', 'zxx', 'mis'].includes(language) ? undefined : language
  } catch { return undefined }
}

type Reflection = { id: string; workId: string; kind: string; createdAt: string; anchor: string; hasNote?: boolean }
function reflectionObjects(input: ReviewEvidence, editions: ReadonlyMap<string, Catalog['editions'][number]>, knownAt: string) {
  const objects: Reflection[] = []
  const add = (object: Omit<Reflection, 'workId'> & { editionId: string }) => {
    const edition = editions.get(object.editionId)
    if (!edition || !Number.isFinite(Date.parse(object.createdAt)) || Date.parse(object.createdAt) > Date.parse(knownAt)) return
    objects.push({ ...object, workId: edition.workId })
  }
  for (const candidate of input.readerAnnotations ?? []) {
    const state = readerAnnotationStateSchema.safeParse(candidate)
    if (!state.success) continue
    for (const a of state.data.annotations) {
      if (a.deletedAt || !a.quote.trim()) continue
      add({ id: a.id, editionId: a.editionId, kind: 'passage', createdAt: a.createdAt, hasNote: !!a.note.trim(),
        anchor: JSON.stringify([a.locator.href, a.locator.locations, a.quote, a.prefix, a.suffix]) })
    }
  }
  for (const candidate of input.readerNavigation ?? []) {
    const state = readerNavigationStateSchema.safeParse(candidate)
    if (!state.success) continue
    for (const a of state.data.bookmarks) add({ id: a.id, editionId: state.data.editionId, kind: 'reader-bookmark', createdAt: a.createdAt,
      anchor: JSON.stringify([a.locator.href, a.locator.locations]) })
  }
  for (const candidate of input.audioAnnotations ?? []) {
    const parsed = audiobookAnnotationSchema.safeParse(candidate)
    if (!parsed.success) continue
    const a = parsed.data
    if (a.kind === 'text-note' && !a.note.trim()) continue
    if (a.kind === 'voice-note' && !input.survivingVoiceNoteIds?.includes(a.id)) continue
    add({ id: a.id, editionId: a.editionId, kind: a.kind === 'bookmark' ? 'audio-bookmark' : a.kind === 'text-note' ? 'audio-note' : 'voice-note',
      createdAt: a.createdAt, anchor: a.kind === 'bookmark' ? String(a.absolutePositionMs) : a.id })
  }
  const seen = new Set<string>(), ids = new Set<string>()
  return objects.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).filter(o => {
    const key = `${o.workId}:${o.kind}:${o.anchor}`
    if (seen.has(key) || ids.has(o.id)) return false
    seen.add(key); ids.add(o.id); return true
  })
}
