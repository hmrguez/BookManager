import type { BookSearchResult } from '../library-model'
import {
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
  readonly includeSecondary?: boolean
  readonly refresh?: boolean
  readonly signal?: AbortSignal
}

type ProviderOutcome = {
  readonly variants: readonly ProviderBookVariant[]
  readonly status: ProviderSearchState
  readonly freshness?: 'live' | 'saved'
}

const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000

export class MetadataSearchService {
  readonly #primary: MetadataProvider
  readonly #secondary: MetadataProvider
  readonly #cache: MetadataSearchCache
  readonly #now: () => Date
  readonly #cacheTtlMs: number

  constructor(options: {
    readonly primary: MetadataProvider
    readonly secondary: MetadataProvider
    readonly cache: MetadataSearchCache
    readonly now?: () => Date
    readonly cacheTtlMs?: number
  }) {
    this.#primary = options.primary
    this.#secondary = options.secondary
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
    const primary = await this.#searchProvider(this.#primary, query, queryKey, options)
    const shouldSearchSecondary = this.#secondary.configured &&
      (Boolean(options.includeSecondary) || primary.variants.length === 0)
    const secondary = shouldSearchSecondary
      ? await this.#searchProvider(this.#secondary, query, queryKey, options)
      : notSearchedState(this.#secondary)
    const outcomes = shouldSearchSecondary ? [primary, secondary] : [primary]
    const variants = outcomes.flatMap(({ variants: providerVariants }) => providerVariants)
    const freshness = outcomes.every(({ freshness: value }) => !value || value === 'live')
      ? 'live'
      : outcomes.every(({ freshness: value }) => !value || value === 'saved')
        ? 'saved'
        : 'mixed'

    return {
      results: combineProviderResults(variants, query.query, freshness),
      providers: [primary.status, secondary.status],
      canBroaden: this.#secondary.configured && !shouldSearchSecondary,
      usedFallback: shouldSearchSecondary && !options.includeSecondary && primary.variants.length === 0,
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
