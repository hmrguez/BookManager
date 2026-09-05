import type { BookSearchResult } from '../library-model'
import {
  canonicalEditionIsbn,
  metadataQueryKey,
  metadataSearchCacheEntrySchema,
  metadataSearchQuerySchema,
  type MetadataProviderId,
  type MetadataSearchCacheEntry,
  type MetadataSearchQuery,
  type MetadataSearchResponse,
  type ProviderBookVariant,
  type ProviderSearchState,
} from './model'
import type { MetadataProvider } from './provider'
import { isAbortError, MetadataProviderError } from './provider'
import { combineProviderResults } from './results'

export type MetadataSearchCache = {
  get(provider: MetadataProviderId, queryKey: string): Promise<MetadataSearchCacheEntry | undefined>
  put(entry: MetadataSearchCacheEntry): Promise<void>
}

export type MetadataSearchOptions = {
  readonly refresh?: boolean
  readonly signal?: AbortSignal
}

export type MetadataIsbnSearchResponse = {
  readonly results: ReadonlyMap<string, readonly BookSearchResult[]>
  readonly provider: ProviderSearchState
  readonly complete: boolean
}

type ProviderOutcome = {
  readonly variants: readonly ProviderBookVariant[]
  readonly status: ProviderSearchState
  readonly freshness?: 'live' | 'saved'
}

const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000
const ISBN_BATCH_SIZE = 40
const ISBN_CACHE_LIMIT = 8
const ISBN_COVER_LOOKUP_VERSION = 'covers-v2'

export class MetadataSearchService {
  readonly #provider: MetadataProvider
  readonly #cache: MetadataSearchCache
  readonly #now: () => Date
  readonly #cacheTtlMs: number

  constructor(options: {
    readonly provider: MetadataProvider
    readonly cache: MetadataSearchCache
    readonly now?: () => Date
    readonly cacheTtlMs?: number
  }) {
    this.#provider = options.provider
    this.#cache = options.cache
    this.#now = options.now ?? (() => new Date())
    this.#cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  }

  async search(
    input: MetadataSearchQuery,
    options: MetadataSearchOptions = {},
  ): Promise<MetadataSearchResponse<BookSearchResult>> {
    const query = metadataSearchQuerySchema.parse(input)
    const queryKey = metadataQueryKey(query.query, query.locale, query.limit)
    const outcome = await this.#searchProvider(this.#provider, query, queryKey, options)

    return {
      results: combineProviderResults(outcome.variants, query.query, outcome.freshness ?? 'live'),
      providers: [outcome.status],
    }
  }

  async searchIsbns(
    inputIsbns: readonly string[],
    locale: string,
    options: MetadataSearchOptions = {},
  ): Promise<MetadataIsbnSearchResponse> {
    const isbns = [...new Set(inputIsbns.flatMap((value) => canonicalEditionIsbn(value) ?? []))]
    const results = new Map<string, readonly BookSearchResult[]>()
    if (!isbns.length) {
      return {
        results,
        provider: { provider: this.#provider.id, state: 'empty' },
        complete: true,
      }
    }
    if (!this.#provider.configured) {
      return {
        results,
        provider: notSearchedState(this.#provider).status,
        complete: false,
      }
    }

    const stale = new Map<string, MetadataSearchCacheEntry>()
    const uncached: string[] = []
    let usedSaved = false
    for (const isbn of isbns) {
      const queryKey = isbnCacheKey(isbn, locale)
      const cached = await this.#cache.get(this.#provider.id, queryKey)
      if (cached) stale.set(isbn, cached)
      if (!options.refresh && cached && Date.parse(cached.expiresAt) >= this.#now().getTime()) {
        results.set(isbn, combineProviderResults(cached.variants, isbn, 'saved'))
        usedSaved = true
      } else {
        uncached.push(isbn)
      }
    }

    let liveBatches = 0
    let failure: unknown
    for (let offset = 0; offset < uncached.length; offset += ISBN_BATCH_SIZE) {
      const batch = uncached.slice(offset, offset + ISBN_BATCH_SIZE)
      try {
        const variants = this.#provider.searchIsbns
          ? await this.#provider.searchIsbns(batch, locale, options.signal)
          : (await Promise.all(batch.map((isbn) => this.#provider.search({
              query: isbn,
              locale,
              limit: ISBN_CACHE_LIMIT,
            }, options.signal)))).flat()
        const observedAt = this.#now()
        for (const isbn of batch) {
          const matching = variants.flatMap((variant) => {
            const identifiers = variant.identifiers.filter(({ normalizedValue }) =>
              canonicalEditionIsbn(normalizedValue) === isbn,
            )
            return identifiers.length ? [{ ...variant, identifiers }] : []
          })
          await this.#cache.put(metadataSearchCacheEntrySchema.parse({
            provider: this.#provider.id,
            queryKey: isbnCacheKey(isbn, locale),
            locale,
            observedAt: observedAt.toISOString(),
            expiresAt: new Date(observedAt.getTime() + this.#cacheTtlMs).toISOString(),
            variants: matching,
          }))
          results.set(isbn, combineProviderResults(matching, isbn, 'live'))
        }
        liveBatches += 1
      } catch (error) {
        if (isAbortError(error)) throw error
        failure = error
        for (const isbn of uncached.slice(offset)) {
          const cached = stale.get(isbn)
          if (cached) {
            results.set(isbn, combineProviderResults(cached.variants, isbn, 'saved'))
            usedSaved = true
          }
        }
        break
      }
    }

    return {
      results,
      provider: failure
        ? usedSaved || liveBatches > 0
          ? {
              provider: this.#provider.id,
              state: usedSaved ? 'saved' : 'live',
              message: 'Some ISBN covers will resume when the catalog is available again.',
            }
          : providerErrorState(this.#provider.id, failure)
        : {
            provider: this.#provider.id,
            state: liveBatches > 0 ? 'live' : 'saved',
          },
      complete: !failure,
    }
  }

  async #searchProvider(
    provider: MetadataProvider,
    query: MetadataSearchQuery,
    queryKey: string,
    options: MetadataSearchOptions,
  ): Promise<ProviderOutcome> {
    if (!provider.configured) return notSearchedState(provider)

    const cached = await this.#cache.get(provider.id, queryKey)
    if (!options.refresh && cached && Date.parse(cached.expiresAt) >= this.#now().getTime()) {
      return {
        variants: cached.variants,
        status: { provider: provider.id, state: 'saved' },
        freshness: 'saved',
      }
    }

    try {
      const variants = await provider.search(query, options.signal)
      const observedAt = this.#now()
      await this.#cache.put(metadataSearchCacheEntrySchema.parse({
        provider: provider.id,
        queryKey,
        locale: query.locale,
        observedAt: observedAt.toISOString(),
        expiresAt: new Date(observedAt.getTime() + this.#cacheTtlMs).toISOString(),
        variants,
      }))
      return {
        variants,
        status: { provider: provider.id, state: variants.length ? 'live' : 'empty' },
        freshness: 'live',
      }
    } catch (error) {
      if (isAbortError(error)) throw error
      if (cached) {
        return {
          variants: cached.variants,
          status: {
            provider: provider.id,
            state: 'saved',
            message: 'Live catalog unavailable; showing saved results.',
          },
          freshness: 'saved',
        }
      }
      return {
        variants: [],
        status: providerErrorState(provider.id, error),
      }
    }
  }
}

function isbnCacheKey(isbn: string, locale: string): string {
  return metadataQueryKey(`${ISBN_COVER_LOOKUP_VERSION} ${isbn}`, locale, ISBN_CACHE_LIMIT)
}

function notSearchedState(provider: MetadataProvider): ProviderOutcome {
  return {
    variants: [],
    status: {
      provider: provider.id,
      state: provider.configured ? 'empty' : 'not-configured',
      message: provider.configured ? undefined : `${provider.name} is not configured.`,
    },
  }
}

function providerErrorState(provider: MetadataProviderId, error: unknown): ProviderSearchState {
  if (error instanceof MetadataProviderError && error.code === 'not-configured') {
    return { provider, state: 'not-configured', message: error.message }
  }
  return {
    provider,
    state: 'unavailable',
    message: error instanceof Error ? error.message : 'The catalog is temporarily unavailable.',
  }
}
