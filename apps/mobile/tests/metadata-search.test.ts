import { describe, expect, test } from 'bun:test'
import { findLibraryBookForSearchResult, libraryBookSchema } from '../src/library-model'
import { GoogleBooksProvider } from '../src/metadata/google-books'
import {
  metadataQueryKey,
  metadataSearchCacheEntrySchema,
  providerBookVariantSchema,
  type MetadataProviderId,
  type MetadataSearchCacheEntry,
  type ProviderBookVariant,
} from '../src/metadata/model'
import { OpenLibraryProvider } from '../src/metadata/open-library'
import type { MetadataProvider } from '../src/metadata/provider'
import { MetadataProviderError } from '../src/metadata/provider'
import { combineProviderResults, selectMetadataVariant } from '../src/metadata/results'
import { MetadataSearchService, type MetadataSearchCache } from '../src/metadata/service'
import { ProviderTransport } from '../src/metadata/transport'
import { MetadataSearchCacheRepository } from '../src/storage/metadata-search-cache'
import { migrateStorage } from '../src/storage/migrations'
import { BunSqliteDatabase } from './storage-test-database'

const NOW = '2026-08-26T10:00:00.000Z'

describe('book metadata provider layer', () => {
  test('Open Library performs a locale-aware, keyless search and preserves edition evidence', async () => {
    let requestedUrl: URL | undefined
    const transport = new ProviderTransport({
      maxRetries: 0,
      fetch: mockFetch((url) => {
        requestedUrl = url
        return {
          docs: [{
            key: '/works/OL45804W',
            title: 'Invisible Cities',
            author_name: ['Italo Calvino'],
            first_publish_year: 1972,
            editions: {
              docs: [{
                key: '/books/OL7353617M',
                title: 'Las ciudades invisibles',
                isbn: ['9788437604947'],
                language: ['spa'],
                publisher: ['Siruela'],
                publish_date: ['1998'],
                number_of_pages: 176,
                cover_i: 8231856,
              }],
            },
          }],
        }
      }),
    })
    const provider = new OpenLibraryProvider({ transport, now: () => new Date(NOW) })

    const [variant] = await provider.search({ query: 'Invisible Cities', locale: 'es-ES', limit: 12 })

    expect(requestedUrl?.origin).toBe('https://openlibrary.org')
    expect(requestedUrl?.searchParams.get('lang')).toBe('es')
    expect(requestedUrl?.searchParams.get('limit')).toBe('12')
    expect(requestedUrl?.searchParams.has('key')).toBe(false)
    expect(variant).toMatchObject({
      provider: 'open-library',
      externalKey: 'OL7353617M',
      workKey: 'OL45804W',
      editionKey: 'OL7353617M',
      title: 'Las ciudades invisibles',
      workTitle: 'Invisible Cities',
      language: 'spa',
      publisher: 'Siruela',
      pageCount: 176,
    })
    expect(variant?.identifiers).toEqual([{
      owner: 'edition',
      scheme: 'isbn-13',
      value: '9788437604947',
      normalizedValue: '9788437604947',
    }])
  })

  test('uses the ISBN query path and tolerates sparse Open Library records', async () => {
    let requestedUrl: URL | undefined
    const provider = new OpenLibraryProvider({
      now: () => new Date(NOW),
      transport: new ProviderTransport({
        maxRetries: 0,
        fetch: mockFetch((url) => {
          requestedUrl = url
          return { docs: [{ key: '/works/OL-SPARSE', title: 'Sparse Record' }] }
        }),
      }),
    })

    const [variant] = await provider.search({ query: '978-0-15-645380-6', locale: 'en', limit: 1 })

    expect(requestedUrl?.searchParams.get('isbn')).toBe('978-0-15-645380-6')
    expect(requestedUrl?.searchParams.has('q')).toBe(false)
    expect(variant).toMatchObject({
      authors: ['Unknown author'],
      identifiers: [],
    })
    expect(variant?.thumbnail).toBeUndefined()
    expect(variant?.pageCount).toBeUndefined()
  })

  test('Google Books is disabled without a key and normalized when explicitly configured', async () => {
    const disabled = new GoogleBooksProvider()
    await expect(disabled.search({ query: 'Piranesi', locale: 'en-GB', limit: 10 }))
      .rejects.toMatchObject({ code: 'not-configured' })

    let requestedUrl: URL | undefined
    const enabled = new GoogleBooksProvider({
      apiKey: 'restricted-key',
      now: () => new Date(NOW),
      transport: new ProviderTransport({
        maxRetries: 0,
        fetch: mockFetch((url) => {
          requestedUrl = url
          return {
            items: [{
              id: 'google-volume-1',
              volumeInfo: {
                title: 'Piranesi',
                authors: ['Susanna Clarke'],
                language: 'en',
                pageCount: 272,
                industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781635575637' }],
                imageLinks: { thumbnail: 'http://books.google.test/cover.jpg' },
              },
            }],
          }
        }),
      }),
    })

    const [variant] = await enabled.search({ query: 'Piranesi', locale: 'en-GB', limit: 10 })
    expect(requestedUrl?.searchParams.get('key')).toBe('restricted-key')
    expect(requestedUrl?.searchParams.get('langRestrict')).toBe('en')
    expect(variant).toMatchObject({
      provider: 'google-books',
      externalKey: 'google-volume-1',
      thumbnail: 'https://books.google.test/cover.jpg',
    })
  })

  test('merges exact editions deterministically while retaining conflicts and source choice', () => {
    const openLibrary = variant({
      provider: 'open-library',
      externalKey: 'OL1M',
      title: 'The Dispossessed',
      pageCount: 341,
      providerRank: 1,
    })
    const google = variant({
      provider: 'google-books',
      externalKey: 'google-1',
      title: 'The Dispossessed: A Novel',
      pageCount: 387,
      providerRank: 0,
    })

    const [result] = combineProviderResults([google, openLibrary], 'The Dispossessed', 'live')

    expect(result?.title).toBe('The Dispossessed')
    expect(result?.metadataSelection?.selectedProvider).toBe('open-library')
    expect(result?.metadataSelection?.variants).toHaveLength(2)
    expect(result?.metadataSelection?.conflicts.map(({ field }) => field)).toEqual(['title', 'pageCount'])
    const selectedGoogle = selectMetadataVariant(result!, 'google-books')
    expect(selectedGoogle.title).toBe('The Dispossessed: A Novel')
    expect(selectedGoogle.pageCount).toBe(387)
  })

  test('does not collapse provider records into one Edition without a shared ISBN', () => {
    const openLibrary = {
      ...variant({ provider: 'open-library', externalKey: 'OL-NO-ISBN' }),
      identifiers: [],
    }
    const google = {
      ...variant({ provider: 'google-books', externalKey: 'google-no-isbn' }),
      identifiers: [],
    }

    expect(combineProviderResults([openLibrary, google], 'The Dispossessed', 'live')).toHaveLength(2)
  })

  test('recognizes equivalent ISBN-10 and ISBN-13 values as the same Edition', () => {
    const isbn10 = {
      ...variant({ provider: 'open-library', externalKey: 'OL-ISBN-10' }),
      identifiers: [{
        owner: 'edition' as const,
        scheme: 'isbn-10' as const,
        value: '0061054887',
        normalizedValue: '0061054887',
      }],
    }
    const isbn13 = variant({ provider: 'google-books', externalKey: 'google-isbn-13' })

    expect(combineProviderResults([isbn10, isbn13], 'The Dispossessed', 'live')[0]
      ?.metadataSelection?.variants).toHaveLength(2)
  })

  test('uses Open Library first, falls back on empty results, and reuses the saved response', async () => {
    const cache = new MemoryMetadataCache()
    const primary = new StubProvider('open-library', [])
    const secondaryResult = variant({ provider: 'google-books', externalKey: 'fallback' })
    const secondary = new StubProvider('google-books', [secondaryResult])
    const service = new MetadataSearchService({
      primary,
      secondary,
      cache,
      now: () => new Date(NOW),
    })

    const first = await service.search({ query: 'The Dispossessed', locale: 'en', limit: 8 })
    expect(first.usedFallback).toBe(true)
    expect(first.results).toHaveLength(1)
    expect(primary.calls).toBe(1)
    expect(secondary.calls).toBe(1)

    const saved = await service.search({ query: 'The Dispossessed', locale: 'en', limit: 8 })
    expect(saved.results[0]?.metadataSelection?.freshness).toBe('saved')
    expect(saved.providers.map(({ state }) => state)).toEqual(['saved', 'saved'])
    expect(primary.calls).toBe(1)
    expect(secondary.calls).toBe(1)
  })

  test('offers Google Books as an explicit broadening source when Open Library has matches', async () => {
    const primary = new StubProvider('open-library', [
      variant({ provider: 'open-library', externalKey: 'OL2M' }),
    ])
    const secondary = new StubProvider('google-books', [
      variant({ provider: 'google-books', externalKey: 'google-2' }),
    ])
    const service = new MetadataSearchService({
      primary,
      secondary,
      cache: new MemoryMetadataCache(),
      now: () => new Date(NOW),
    })

    const primaryOnly = await service.search({ query: 'The Dispossessed', locale: 'en', limit: 8 })
    expect(primaryOnly.canBroaden).toBe(true)
    expect(secondary.calls).toBe(0)

    const broadened = await service.search(
      { query: 'The Dispossessed', locale: 'en', limit: 8 },
      { includeSecondary: true },
    )
    expect(broadened.results[0]?.metadataSelection?.variants).toHaveLength(2)
    expect(secondary.calls).toBe(1)
  })

  test('returns stale saved metadata when the live provider is unavailable', async () => {
    const cache = new MemoryMetadataCache()
    const queryKey = metadataQueryKey('Piranesi', 'en', 8)
    await cache.put(cacheEntry('open-library', queryKey, [
      variant({ provider: 'open-library', externalKey: 'saved' }),
    ], '2026-08-25T09:00:00.000Z'))
    const service = new MetadataSearchService({
      primary: new StubProvider(
        'open-library',
        new MetadataProviderError('open-library', 'unavailable', 'offline'),
      ),
      secondary: new StubProvider('google-books', [], false),
      cache,
      now: () => new Date(NOW),
    })

    const response = await service.search(
      { query: 'Piranesi', locale: 'en', limit: 8 },
      { refresh: true },
    )

    expect(response.results).toHaveLength(1)
    expect(response.providers[0]).toMatchObject({ state: 'saved' })
    expect(response.results[0]?.metadataSelection?.freshness).toBe('saved')
  })

  test('keeps a usable provider result when the other configured provider fails', async () => {
    const secondaryResult = variant({ provider: 'google-books', externalKey: 'secondary-live' })
    const primaryUnavailable = new MetadataSearchService({
      primary: new StubProvider(
        'open-library',
        new MetadataProviderError('open-library', 'unavailable', 'offline'),
      ),
      secondary: new StubProvider('google-books', [secondaryResult]),
      cache: new MemoryMetadataCache(),
      now: () => new Date(NOW),
    })

    const fallback = await primaryUnavailable.search({ query: 'Piranesi', locale: 'en', limit: 8 })
    expect(fallback.usedFallback).toBe(true)
    expect(fallback.results[0]?.metadataSelection?.selectedProvider).toBe('google-books')

    const primaryResult = variant({ provider: 'open-library', externalKey: 'primary-live' })
    const secondaryUnavailable = new MetadataSearchService({
      primary: new StubProvider('open-library', [primaryResult]),
      secondary: new StubProvider(
        'google-books',
        new MetadataProviderError('google-books', 'unavailable', 'offline'),
      ),
      cache: new MemoryMetadataCache(),
      now: () => new Date(NOW),
    })
    const broadened = await secondaryUnavailable.search(
      { query: 'Piranesi', locale: 'en', limit: 8 },
      { includeSecondary: true },
    )
    expect(broadened.results).toHaveLength(1)
    expect(broadened.providers[1]?.state).toBe('unavailable')
  })

  test('enforces provider spacing and retries a rate limit with backoff', async () => {
    let clock = 0
    const requestTimes: number[] = []
    const sleeps: number[] = []
    let attempt = 0
    const transport = new ProviderTransport({
      now: () => clock,
      maxRetries: 1,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        clock += milliseconds
      },
      fetch: mockFetch(() => {
        requestTimes.push(clock)
        attempt += 1
        if (attempt === 1) return new Response('{}', { status: 429 })
        return { ok: true }
      }),
    })

    await transport.json('open-library', new URL('https://openlibrary.org/search.json'), {
      minimumIntervalMs: 1_000,
    })
    await transport.json('open-library', new URL('https://openlibrary.org/search.json'), {
      minimumIntervalMs: 1_000,
    })

    expect(requestTimes).toEqual([0, 1_000, 2_000])
    expect(sleeps.reduce((sum, milliseconds) => sum + milliseconds, 0)).toBe(2_000)
  })

  test('persists and prunes validated metadata cache entries in SQLite', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const repository = new MetadataSearchCacheRepository(database)
    const queryKey = metadataQueryKey('Piranesi', 'en', 8)
    const entry = cacheEntry('open-library', queryKey, [
      variant({ provider: 'open-library', externalKey: 'OL3M' }),
    ], '2026-08-27T10:00:00.000Z')

    await repository.put(entry)
    expect(await repository.get('open-library', queryKey)).toEqual(entry)
    expect(await repository.pruneExpired('2026-08-28T10:00:00.000Z')).toBe(1)
    expect(await repository.get('open-library', queryKey)).toBeUndefined()
    await database.close()
  })

  test('matches a stored book by edition ISBN without reusing a provider ID as local identity', () => {
    const [result] = combineProviderResults([
      variant({ provider: 'open-library', externalKey: 'OL4M' }),
    ], 'The Dispossessed', 'live')
    const stored = libraryBookSchema.parse({
      ...result,
      id: 'book:local-identity',
      shelf: 'tbr',
      progress: 0,
      currentPage: 0,
      rating: 0,
      notes: '',
      addedAt: NOW,
      lastUpdatedAt: NOW,
    })

    expect(result?.id).not.toBe('OL4M')
    expect(findLibraryBookForSearchResult([stored], result!)).toEqual(stored)
  })
})

class MemoryMetadataCache implements MetadataSearchCache {
  readonly entries = new Map<string, MetadataSearchCacheEntry>()

  async get(provider: MetadataProviderId, queryKey: string) {
    return this.entries.get(`${provider}:${queryKey}`)
  }

  async put(entry: MetadataSearchCacheEntry) {
    this.entries.set(`${entry.provider}:${entry.queryKey}`, entry)
  }
}

class StubProvider implements MetadataProvider {
  readonly name: string
  calls = 0

  constructor(
    readonly id: MetadataProviderId,
    readonly response: readonly ProviderBookVariant[] | Error,
    readonly configured = true,
  ) {
    this.name = id === 'open-library' ? 'Open Library' : 'Google Books'
  }

  async search(): Promise<ProviderBookVariant[]> {
    this.calls += 1
    if (this.response instanceof Error) throw this.response
    return [...this.response]
  }
}

function variant(overrides: {
  provider: MetadataProviderId
  externalKey: string
  title?: string
  pageCount?: number
  providerRank?: number
}): ProviderBookVariant {
  const providerName = overrides.provider === 'open-library' ? 'Open Library' : 'Google Books'
  return providerBookVariantSchema.parse({
    id: `${overrides.provider}:${overrides.externalKey}`,
    provider: overrides.provider,
    providerName,
    externalKey: overrides.externalKey,
    workKey: overrides.provider === 'open-library' ? 'OL-WORK' : undefined,
    editionKey: overrides.externalKey,
    title: overrides.title ?? 'The Dispossessed',
    workTitle: 'The Dispossessed',
    authors: ['Ursula K. Le Guin'],
    identifiers: [{
      owner: 'edition',
      scheme: 'isbn-13',
      value: '9780061054884',
      normalizedValue: '9780061054884',
    }],
    language: 'en',
    publicationDate: '1974',
    pageCount: overrides.pageCount ?? 341,
    confidence: overrides.provider === 'open-library' ? 0.92 : 0.9,
    providerRank: overrides.providerRank ?? 0,
    observedAt: NOW,
  })
}

function cacheEntry(
  provider: MetadataProviderId,
  queryKey: string,
  variants: readonly ProviderBookVariant[],
  expiresAt: string,
): MetadataSearchCacheEntry {
  return metadataSearchCacheEntrySchema.parse({
    provider,
    queryKey,
    locale: 'en',
    observedAt: NOW,
    expiresAt,
    variants,
  })
}

function mockFetch(
  response: (url: URL) => unknown | Response,
): typeof globalThis.fetch {
  return (async (input) => {
    const value = response(new URL(String(input)))
    return value instanceof Response ? value : Response.json(value)
  }) as typeof globalThis.fetch
}
