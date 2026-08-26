import { z } from 'zod'
import type { LibraryBook } from './library-model'

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

export const upNextStateSchema = z.object({
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
  series: { label: 'Series', description: 'Prefer a series you want to continue.' },
  'loan-expiry': { label: 'Loan expiry', description: 'Surface a recorded loan before it expires.' },
  recency: { label: 'Time waiting', description: 'Prefer older or recently added books.' },
}

export function createDefaultUpNextState(
  timestamp = new Date().toISOString(),
): UpNextState {
  return upNextStateSchema.parse({
    version: 1,
    mode: 'manual',
    queueBookIds: [],
    pinnedBookId: null,
    pinnedCriteria: [],
    dismissedCriteria: [],
    dismissedSuggestions: [],
    preferences: {
      weights: {
        format: 0,
        length: 0,
        mood: 0,
        series: 0,
        'loan-expiry': 2,
        recency: 1,
      },
      formats: [],
      maximumPages: null,
      moodTags: [],
      series: [],
      requiredCriteria: [],
      recencyDirection: 'long-waiting',
    },
    updatedAt: timestamp,
  })
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

  if (!state.pinnedBookId) return ordered
  const pinnedIndex = ordered.findIndex(({ id }) => id === state.pinnedBookId)
  if (pinnedIndex <= 0) return ordered
  const [pinned] = ordered.splice(pinnedIndex, 1)
  ordered.unshift(pinned)
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

  const dismissedBookIds = new Set(state.dismissedSuggestions.map(({ bookId }) => bookId))
  const dismissedCriteria = new Set(state.dismissedCriteria)
  const candidates = books.filter(
    (book) => book.shelf === 'tbr'
      && !dismissedBookIds.has(book.id)
      && matchesRequiredCriteria(book, state.preferences, dismissedCriteria, now),
  )
  const scored = candidates.map((book) => scoreBook(book, state, dismissedCriteria, now))
  scored.sort((left, right) =>
    right.score - left.score
      || left.book.title.localeCompare(right.book.title)
      || left.book.id.localeCompare(right.book.id),
  )

  const certainty = candidates.length >= 3 && scored.some(({ score }) => score > 0)
    ? 'useful'
    : candidates.length ? 'limited' : 'none'
  const guidance = certainty === 'useful'
    ? `Compared ${candidates.length} eligible books using only the preferences below.`
    : candidates.length === 1
      ? 'Only one eligible book is available, so this is an option—not a confident best pick.'
      : candidates.length === 2
        ? 'Only two eligible books are available. Their order is gentle guidance, not a verdict.'
        : candidates.length
          ? 'There are not enough matching signals to claim a best pick; ties are alphabetical.'
          : 'No unread books match the current filters. Loosen a filter or add a few books.'

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
  now: Date,
): UpNextSuggestion {
  const reasons = UP_NEXT_CRITERIA
    .filter((criterion) => !dismissedCriteria.has(criterion))
    .map((criterion) => reasonFor(criterion, book, state.preferences, now))
    .filter((reason): reason is Omit<UpNextReason, 'pinned'> => Boolean(reason))
    .map((reason) => ({ ...reason, pinned: state.pinnedCriteria.includes(reason.criterion) }))
    .sort((left, right) => Number(right.pinned) - Number(left.pinned)
      || right.contribution - left.contribution
      || left.label.localeCompare(right.label))
  const visibleReasons = reasons.slice(0, 3)

  return {
    book,
    reasons: visibleReasons,
    score: visibleReasons.reduce((total, reason) => total + reason.contribution, 0),
  }
}

function reasonFor(
  criterion: UpNextCriterion,
  book: LibraryBook,
  preferences: UpNextPreferences,
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
      detail: 'Matches a mood or tag you chose',
      contribution: weight * 10,
    } : undefined
  }

  if (criterion === 'series') {
    const preferred = new Set(preferences.series.map(normalized))
    const match = book.series?.find((series) => preferred.has(normalized(series)))
    return match ? {
      criterion,
      label: match,
      detail: 'Continues a preferred series',
      contribution: weight * 10,
    } : undefined
  }

  if (criterion === 'loan-expiry') {
    if (!book.loan || book.loan.returnedAt) return undefined
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

  const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(book.addedAt).getTime()) / 86_400_000))
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
  dismissedCriteria: ReadonlySet<UpNextCriterion>,
  now: Date,
): boolean {
  return preferences.requiredCriteria.every((criterion) =>
    dismissedCriteria.has(criterion) || Boolean(reasonFor(criterion, book, preferences, now)),
  )
}

function loanLabel(provider: string, days: number): string {
  if (days < 0) return `${provider} loan overdue`
  if (days === 0) return `${provider} loan due today`
  if (days === 1) return `${provider} loan due tomorrow`
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
