import { z } from 'zod'
import type { LibraryBook } from './library-model'
import { buildSeriesContext, type SeriesContext } from './recommendations/series'

export const UP_NEXT_CRITERIA = [
  'format',
  'length',
  'mood',
  'series',
  'loan-expiry',
  'recency',
] as const

export const upNextCriterionSchema = z.enum(UP_NEXT_CRITERIA)
export const upNextModeSchema = z.enum(['manual', 'assisted'])
export const upNextWeightSchema = z.number().int().min(0).max(3)

export const upNextPreferencesSchema = z.object({
  preset: z.enum(['balanced', 'short', 'series', 'custom']).default('custom'),
  seriesOrder: z.enum(['in-order', 'first', 'any']).default('any'),
  useReadingTaste: z.boolean().default(false),
  weights: z.object({
    format: upNextWeightSchema,
    length: upNextWeightSchema,
    mood: upNextWeightSchema,
    series: upNextWeightSchema,
    'loan-expiry': upNextWeightSchema,
    recency: upNextWeightSchema,
  }),
  formats: z.array(z.string().trim().min(1)).max(12),
  maximumPages: z.number().int().positive().max(20_000).nullable(),
  moodTags: z.array(z.string().trim().min(1)).max(20),
  series: z.array(z.string().trim().min(1)).max(20),
  requiredCriteria: z.array(upNextCriterionSchema).max(UP_NEXT_CRITERIA.length),
  recencyDirection: z.enum(['long-waiting', 'recently-added']),
})

export const upNextDismissalSchema = z.object({
  bookId: z.string().min(1),
  dismissedAt: z.iso.datetime({ offset: true }),
})

const storedUpNextStateSchema = z.object({
  version: z.literal(1),
  mode: upNextModeSchema,
  queueBookIds: z.array(z.string().min(1)),
  pinnedBookId: z.string().min(1).nullable(),
  pinnedCriteria: z.array(upNextCriterionSchema),
  dismissedCriteria: z.array(upNextCriterionSchema),
  dismissedSuggestions: z.array(upNextDismissalSchema),
  preferences: upNextPreferencesSchema,
  updatedAt: z.iso.datetime({ offset: true }),
}).superRefine((state, context) => {
  uniqueValues(state.queueBookIds, ['queueBookIds'], context)
  uniqueValues(state.pinnedCriteria, ['pinnedCriteria'], context)
  uniqueValues(state.dismissedCriteria, ['dismissedCriteria'], context)
  uniqueValues(state.preferences.requiredCriteria, ['preferences', 'requiredCriteria'], context)
  uniqueValues(state.dismissedSuggestions.map(({ bookId }) => bookId), ['dismissedSuggestions'], context)

  const dismissed = new Set(state.dismissedCriteria)
  if (state.pinnedCriteria.some((criterion) => dismissed.has(criterion))) {
    context.addIssue({
      code: 'custom',
      path: ['pinnedCriteria'],
      message: 'A reason cannot be pinned and dismissed at the same time',
    })
  }
})

// Before recommendations shipped, ordinary queue edits persisted the manual
// defaults too. Upgrade only that untouched configuration, keeping queue choices,
// customized legacy settings, and every explicit opt-out made by the new UI.
export const upNextStateSchema = z.preprocess((input) => {
  if (!input || typeof input !== 'object') return input
  const state = input as Record<string, unknown>
  const raw = state.preferences
  if (state.mode !== 'manual' || !raw || typeof raw !== 'object' || 'preset' in raw) return input
  const parsed = upNextPreferencesSchema.safeParse(raw)
  if (!parsed.success) return input
  const preferences = parsed.data
  const untouched = UP_NEXT_CRITERIA.every((criterion) => preferences.weights[criterion]
    === (criterion === 'loan-expiry' ? 2 : criterion === 'recency' ? 1 : 0))
    && !preferences.formats.length && preferences.maximumPages === null
    && !preferences.moodTags.length && !preferences.series.length
    && !preferences.requiredCriteria.length && preferences.recencyDirection === 'long-waiting'
    && ['pinnedCriteria', 'dismissedCriteria', 'dismissedSuggestions'].every((field) =>
      Array.isArray(state[field]) && state[field].length === 0)
  return untouched ? { ...state, mode: 'assisted', preferences: recommendationPreset('balanced') } : input
}, storedUpNextStateSchema)

export type UpNextCriterion = z.infer<typeof upNextCriterionSchema>
export type UpNextMode = z.infer<typeof upNextModeSchema>
export type UpNextPreferences = z.infer<typeof upNextPreferencesSchema>
export type UpNextState = z.infer<typeof upNextStateSchema>

export type UpNextReason = {
  readonly criterion: UpNextCriterion
  readonly label: string
  readonly detail: string
  readonly contribution: number
  readonly pinned: boolean
}

export type UpNextSuggestion = {
  readonly book: LibraryBook
  readonly reasons: readonly UpNextReason[]
  readonly score: number
}

export type UpNextSuggestionSet = {
  readonly suggestions: readonly UpNextSuggestion[]
  readonly eligibleCount: number
  readonly guidance: string
  readonly certainty: 'none' | 'limited' | 'useful'
}

export const UP_NEXT_CRITERION_COPY: Record<
  UpNextCriterion,
  { readonly label: string; readonly description: string }
> = {
  format: { label: 'Format', description: 'Prefer selected reading formats.' },
  length: { label: 'Length', description: 'Prefer books within a page limit.' },
  mood: { label: 'Mood & tags', description: 'Use your own tags as mood signals.' },
  series: { label: 'Series', description: 'Prefer a safe start or the next unread installment.' },
  'loan-expiry': { label: 'Loan expiry', description: 'Surface a recorded loan before it expires.' },
  recency: { label: 'Time waiting', description: 'Prefer older or recently added books.' },
}

export function createDefaultUpNextState(
  timestamp = new Date().toISOString(),
): UpNextState {
  return upNextStateSchema.parse({
    version: 1,
    mode: 'assisted',
    queueBookIds: [],
    pinnedBookId: null,
    pinnedCriteria: [],
    dismissedCriteria: [],
    dismissedSuggestions: [],
    preferences: recommendationPreset('balanced'),
    updatedAt: timestamp,
  })
}

export function recommendationPreset(preset: 'balanced' | 'short' | 'series'): UpNextPreferences {
  return {
    preset,
    seriesOrder: 'in-order',
    useReadingTaste: true,
    weights: {
      format: 0,
      length: preset === 'short' ? 3 : preset === 'balanced' ? 1 : 0,
      mood: preset === 'series' ? 1 : 2,
      series: preset === 'short' ? 1 : 3,
      'loan-expiry': 2,
      recency: 1,
    },
    formats: [], maximumPages: preset === 'short' ? 250 : 400,
    moodTags: [], series: [], requiredCriteria: [], recencyDirection: 'long-waiting',
  }
}

export function orderedUpNextBooks(
  books: readonly LibraryBook[],
  state: UpNextState,
): LibraryBook[] {
  const nextBooks = books.filter(({ shelf }) => shelf === 'next')
  const byId = new Map(nextBooks.map((book) => [book.id, book]))
  const ordered = state.queueBookIds
    .map((id) => byId.get(id))
    .filter((book): book is LibraryBook => Boolean(book))
  const known = new Set(ordered.map(({ id }) => id))
  ordered.push(...nextBooks.filter(({ id }) => !known.has(id)))

  return ordered
}

export function buildUpNextSuggestions(
  books: readonly LibraryBook[],
  state: UpNextState,
  now = new Date(),
  limit = 3,
): UpNextSuggestionSet {
  if (state.mode === 'manual') {
    return {
      suggestions: [],
      eligibleCount: 0,
      certainty: 'none',
      guidance: 'Manual mode is on. Nothing is ranked.',
    }
  }

  const context = buildSeriesContext(books)
  const preferences = resolvedPreferences(books, state.preferences)
  const dismissedBookIds = new Set(state.dismissedSuggestions.map(({ bookId }) => bookId))
  const dismissedCriteria = new Set(state.dismissedCriteria)
  const candidates = books.filter(
    (book) => book.shelf === 'tbr'
      && !dismissedBookIds.has(book.id)
      && (preferences.seriesOrder === 'any' || context.canReadNext(book))
      && (preferences.seriesOrder !== 'first' || (context.membership(book)?.position ?? Infinity) <= 1)
      && matchesRequiredCriteria(book, preferences, context, now),
  )
  const scored = candidates.map((book) => scoreBook(book, { ...state, preferences }, dismissedCriteria, context, now))
    .filter(({ score }) => score > 0)
  scored.sort((left, right) =>
    right.score - left.score
      || left.book.title.localeCompare(right.book.title)
      || left.book.id.localeCompare(right.book.id),
  )

  const certainty = scored.length >= 3
    ? 'useful'
    : scored.length ? 'limited' : 'none'
  const guidance = certainty === 'useful'
    ? `Compared ${candidates.length} eligible books using local reading preferences.`
    : scored.length === 1
      ? 'Only one book matches, so this is an option, not a confident best pick.'
      : scored.length === 2
        ? 'Only two books match. Their order is gentle guidance, not a verdict.'
        : candidates.length
          ? 'No strong matches yet. Your TBR stays in its original order.'
          : 'No books match these preferences and series rules yet.'

  return {
    suggestions: scored.slice(0, limit),
    eligibleCount: candidates.length,
    certainty,
    guidance,
  }
}

function scoreBook(
  book: LibraryBook,
  state: UpNextState,
  dismissedCriteria: ReadonlySet<UpNextCriterion>,
  context: SeriesContext,
  now: Date,
): UpNextSuggestion {
  const reasons = UP_NEXT_CRITERIA
    .filter((criterion) => !dismissedCriteria.has(criterion))
    .map((criterion) => reasonFor(criterion, book, state.preferences, context, now))
    .filter((reason): reason is Omit<UpNextReason, 'pinned'> => Boolean(reason))
    .map((reason) => ({ ...reason, pinned: state.pinnedCriteria.includes(reason.criterion) }))
    .sort((left, right) => Number(right.pinned) - Number(left.pinned)
      || right.contribution - left.contribution
      || left.label.localeCompare(right.label))
  return {
    book,
    reasons,
    score: reasons.reduce((total, reason) => total + reason.contribution, 0),
  }
}

function reasonFor(
  criterion: UpNextCriterion,
  book: LibraryBook,
  preferences: UpNextPreferences,
  context: SeriesContext,
  now: Date,
): Omit<UpNextReason, 'pinned'> | undefined {
  const weight = preferences.weights[criterion]
  if (!weight) return undefined

  if (criterion === 'format') {
    const match = book.format && preferences.formats.some(
      (format) => normalized(format) === normalized(book.format ?? ''),
    )
    return match ? {
      criterion,
      label: book.format!,
      detail: 'Matches a preferred format',
      contribution: weight * 10,
    } : undefined
  }

  if (criterion === 'length') {
    if (!preferences.maximumPages || !book.pageCount || book.pageCount > preferences.maximumPages) {
      return undefined
    }
    return {
      criterion,
      label: `${book.pageCount} pages`,
      detail: `Within your ${preferences.maximumPages}-page limit`,
      contribution: weight * 10,
    }
  }

  if (criterion === 'mood') {
    const preferred = new Set(preferences.moodTags.map(normalized))
    const match = book.tags?.find((tag) => preferred.has(normalized(tag)))
    return match ? {
      criterion,
      label: match,
      detail: 'Shares a preferred tag',
      contribution: weight * 10,
    } : undefined
  }

  if (criterion === 'series') {
    const membership = context.membership(book)
    if (!membership) return undefined
    const preferred = new Set(preferences.series.map(normalized))
    if (preferred.size && !preferred.has(normalized(membership.name))) return undefined
    const knownOrder = membership.position !== undefined && context.canReadNext(book)
    if (!preferred.size && !knownOrder) return undefined
    const continuing = knownOrder && membership.position! > 1
    return {
      criterion,
      label: continuing ? `Continue ${membership.name}` : knownOrder ? `Start ${membership.name}` : membership.name,
      detail: continuing ? `Book ${membership.position}; earlier installments are finished`
        : knownOrder ? `Book ${membership.position}; a recorded starting point`
          : 'Matches your series preference; reading order is unknown',
      contribution: weight * (continuing ? 20 : 10),
    }
  }

  if (criterion === 'loan-expiry') {
    if (!book.loan || book.loan.returnedAt || Date.parse(book.loan.dueAt) <= now.getTime()) return undefined
    const days = daysUntil(book.loan.dueAt, now)
    if (days > 21) return undefined
    const urgency = days <= 3 ? 3 : days <= 7 ? 2 : 1
    return {
      criterion,
      label: loanLabel(book.loan.provider, days),
      detail: 'Recorded loan availability is time-limited',
      contribution: weight * urgency * 10,
    }
  }

  const ageDays = Math.max(0, Math.round((Date.parse(now.toISOString().slice(0, 10)) - Date.parse(book.addedAt.slice(0, 10))) / 86_400_000))
  const recent = preferences.recencyDirection === 'recently-added'
  const label = recent
    ? ageDays === 0 ? 'Added today' : `Added ${ageDays} day${ageDays === 1 ? '' : 's'} ago`
    : ageDays < 30 ? 'Recently added' : `Waiting ${Math.floor(ageDays / 30)} month${ageDays < 60 ? '' : 's'}`
  const strength = recent ? Math.max(1, 31 - Math.min(ageDays, 30)) / 30 : Math.min(3, 1 + ageDays / 180)
  return {
    criterion,
    label,
    detail: recent ? 'You asked to see newer additions' : 'You asked to revisit books that have waited',
    contribution: Math.round(weight * strength * 10),
  }
}

function matchesRequiredCriteria(
  book: LibraryBook,
  preferences: UpNextPreferences,
  context: SeriesContext,
  now: Date,
): boolean {
  return preferences.requiredCriteria.every((criterion) =>
    Boolean(reasonFor(criterion, book, { ...preferences, weights: { ...preferences.weights, [criterion]: 1 } }, context, now)),
  )
}

function resolvedPreferences(books: readonly LibraryBook[], preferences: UpNextPreferences): UpNextPreferences {
  if (!preferences.useReadingTaste || preferences.moodTags.length) return preferences
  const tags = new Map<string, { name: string; count: number }>()
  for (const book of books) {
    if (book.shelf !== 'finished' || book.rating < 4) continue
    for (const tag of new Set(book.tags?.map(normalized))) {
      const entry = tags.get(tag) ?? { name: tag, count: 0 }
      entry.count++
      tags.set(tag, entry)
    }
  }
  return { ...preferences, moodTags: [...tags.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5).map(({ name }) => name) }
}

function loanLabel(provider: string, days: number): string {
  if (days < 0) return `${provider} loan overdue`
  if (days === 0) return `${provider} loan due today`
  if (days === 1) return `${provider} loan due within 24 hours`
  return `${provider} loan due in ${days} days`
}

function daysUntil(value: string, now: Date): number {
  return Math.ceil((new Date(value).getTime() - now.getTime()) / 86_400_000)
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function uniqueValues(
  values: readonly string[],
  path: Array<string | number>,
  context: z.RefinementCtx,
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', path, message: 'Values must be unique' })
  }
}
