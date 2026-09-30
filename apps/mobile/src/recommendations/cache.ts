import { getLanguage } from '../localization'
import { z } from 'zod'
import type { LibraryBook } from '../library-model'
import { buildUpNextSuggestions, upNextCriterionSchema, type UpNextState, type UpNextSuggestionSet } from '../up-next-model'

const CACHE_KEY = 'wovenleaf.tbr-recommendations.v1'
const DAY = 86_400_000
type CacheStorage = Pick<Storage, 'getItem' | 'setItem'>
const cacheSchema = z.object({
  version: z.literal(1), fingerprint: z.string(), createdAt: z.number(), expiresAt: z.number(),
  eligibleCount: z.number().int().nonnegative(), guidance: z.string(), certainty: z.enum(['none', 'limited', 'useful']),
  suggestions: z.array(z.object({
    bookId: z.string(), score: z.number().nonnegative(),
    reasons: z.array(z.object({
      criterion: upNextCriterionSchema, label: z.string(), detail: z.string(),
      contribution: z.number().nonnegative(), pinned: z.boolean(),
    })),
  })),
})
type CacheEntry = z.infer<typeof cacheSchema>

export function nextRecommendationRefresh(books: readonly LibraryBook[], now: number): number {
  let next = (Math.floor(now / DAY) + 1) * DAY
  for (const book of books) {
    if (book.shelf !== 'tbr' || !book.loan || book.loan.returnedAt) continue
    const due = Date.parse(book.loan.dueAt)
    if (due <= now) continue
    // Loan labels/urgency change at the due-time's daily boundary, including expiry.
    const boundary = due - (Math.ceil((due - now) / DAY) - 1) * DAY
    next = Math.min(next, boundary)
  }
  return next
}

export class RecommendationCache {
  #entry?: CacheEntry
  #storage?: CacheStorage

  constructor(storage?: CacheStorage) {
    this.#storage = storage
    try {
      this.#entry = cacheSchema.parse(JSON.parse(storage?.getItem(CACHE_KEY) ?? 'null'))
    } catch { /* Missing, old, or corrupt caches are always safe to recompute. */ }
  }

  get expiresAt() { return this.#entry?.expiresAt ?? 0 }

  get(books: readonly LibraryBook[], state: UpNextState, now = new Date(), languageRevision: string = getLanguage()): UpNextSuggestionSet {
    const fingerprint = JSON.stringify([
      languageRevision,
      state.mode, state.preferences, state.pinnedCriteria, state.dismissedCriteria, state.dismissedSuggestions,
      books.map(({ id, title, authors, shelf, tags, series, seriesPosition, format, pageCount, addedAt, loan, rating }) =>
        [id, title, authors, shelf, tags, series, seriesPosition, format, pageCount, addedAt, loan, rating]),
    ])
    const entry = this.#entry
    if (entry?.fingerprint === fingerprint && now.getTime() >= entry.createdAt && now.getTime() < entry.expiresAt) {
      const byId = new Map(books.map((book) => [book.id, book]))
      return {
        eligibleCount: entry.eligibleCount, guidance: entry.guidance, certainty: entry.certainty,
        suggestions: entry.suggestions.flatMap(({ bookId, ...suggestion }) => {
          const book = byId.get(bookId)
          return book ? [{ ...suggestion, book }] : []
        }),
      }
    }
    const result = buildUpNextSuggestions(books, state, now)
    this.#entry = {
      version: 1, fingerprint, createdAt: now.getTime(), expiresAt: nextRecommendationRefresh(books, now.getTime()),
      ...result, suggestions: result.suggestions.map(({ book, ...suggestion }) => ({ ...suggestion, reasons: [...suggestion.reasons], bookId: book.id })),
    }
    return result
  }

  /** Called after render. Cache failures never prevent library use or recommendations. */
  persist() {
    try { if (this.#entry) this.#storage?.setItem(CACHE_KEY, JSON.stringify(this.#entry)) } catch { /* Storage may be full or unavailable. */ }
  }
}
