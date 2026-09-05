import { describe, expect, test } from 'bun:test'
import {
  countGoodreadsBooksMissingCovers,
  GoodreadsCoverEnrichmentService,
} from '../src/imports/cover-enrichment'
import { libraryBookSchema, type BookSearchResult, type LibraryBook } from '../src/library-model'
import { canonicalEditionIsbn } from '../src/metadata/model'

const NOW = '2026-09-05T10:00:00.000Z'
const ISBN = '9780061054884'
const ISBN_COVER = 'https://covers.openlibrary.org/b/id/101-M.jpg?default=false'
const SEARCH_COVER = 'https://covers.openlibrary.org/b/id/202-M.jpg?default=false'

describe('Goodreads cover enrichment', () => {
  test('fills ISBN matches first and uses exact title-author search only for the remainder', async () => {
    const isbnBook = book({ id: 'isbn-book', identifiers: [ISBN] })
    const titleBook = book({ id: 'title-book', title: 'Search Me', authors: ['Exact Author'] })
    const alreadyCovered = book({ id: 'covered', thumbnail: ISBN_COVER })
    const localBook = book({ id: 'local', sourceNames: ['Manual'] })
    const searches: string[] = []
    const metadata = {
      async searchIsbns() {
        return {
          results: new Map([[canonicalEditionIsbn(ISBN)!, [result({ thumbnail: ISBN_COVER })]]]),
          provider: { provider: 'open-library' as const, state: 'live' as const },
          complete: true,
        }
      },
      async search(input: { readonly query: string }) {
        searches.push(input.query)
        return {
          results: [result({
            title: 'Search Me',
            authors: ['Exact Author'],
            identifiers: [],
            thumbnail: SEARCH_COVER,
          })],
          providers: [{ provider: 'open-library' as const, state: 'live' as const }],
        }
      },
    }
    const covers = new Map<string, string>()
    const progress: Array<{ candidateBooks: number; resolvedBooks: number }> = []

    const enriched = await new GoodreadsCoverEnrichmentService(metadata).enrich(
      [isbnBook, titleBook, alreadyCovered, localBook],
      {
        locale: 'en',
        onCover: (bookId, thumbnail) => { covers.set(bookId, thumbnail) },
        onProgress: (value) => { progress.push(value) },
      },
    )

    expect(enriched).toEqual({
      candidateBooks: 2,
      matchedByIsbn: 1,
      matchedBySearch: 1,
      unresolvedBooks: 0,
      complete: true,
    })
    expect(searches).toEqual(['Search Me Exact Author'])
    expect(Object.fromEntries(covers)).toEqual({
      'isbn-book': ISBN_COVER,
      'title-book': SEARCH_COVER,
    })
    expect(progress).toEqual([
      { candidateBooks: 2, resolvedBooks: 0 },
      { candidateBooks: 2, resolvedBooks: 1 },
      { candidateBooks: 2, resolvedBooks: 2 },
    ])
  })

  test('counts only uncovered Goodreads books as candidates', () => {
    expect(countGoodreadsBooksMissingCovers([
      book({ id: 'missing' }),
      book({ id: 'covered', thumbnail: ISBN_COVER }),
      book({ id: 'manual', sourceNames: ['Manual'] }),
    ])).toBe(1)
  })

  test('does not attach a plausible cover when fallback identity evidence disagrees', async () => {
    let fallbackCalls = 0
    const metadata = {
      async searchIsbns() {
        return {
          results: new Map(),
          provider: { provider: 'open-library' as const, state: 'empty' as const },
          complete: true,
        }
      },
      async search() {
        fallbackCalls += 1
        return {
          results: [result({ title: 'Same Title', authors: ['Different Author'], thumbnail: SEARCH_COVER })],
          providers: [{ provider: 'open-library' as const, state: 'live' as const }],
        }
      },
    }
    const attached: string[] = []

    const enriched = await new GoodreadsCoverEnrichmentService(metadata).enrich(
      [book({ title: 'Same Title', authors: ['Expected Author'] })],
      { locale: 'en', onCover: (bookId) => { attached.push(bookId) } },
    )

    expect(fallbackCalls).toBe(1)
    expect(attached).toEqual([])
    expect(enriched).toMatchObject({ unresolvedBooks: 1, complete: true })
  })

  test('defers title searches when the ISBN batch is interrupted', async () => {
    let fallbackCalls = 0
    const metadata = {
      async searchIsbns() {
        return {
          results: new Map(),
          provider: { provider: 'open-library' as const, state: 'unavailable' as const },
          complete: false,
        }
      },
      async search() {
        fallbackCalls += 1
        return { results: [], providers: [] }
      },
    }

    const enriched = await new GoodreadsCoverEnrichmentService(metadata).enrich(
      [book({ identifiers: [ISBN] })],
      { locale: 'en', onCover: () => undefined },
    )

    expect(fallbackCalls).toBe(0)
    expect(enriched).toMatchObject({ unresolvedBooks: 1, complete: false })
  })
})

function book(overrides: Partial<LibraryBook> = {}): LibraryBook {
  return libraryBookSchema.parse({
    id: 'goodreads-book',
    title: 'The Dispossessed',
    authors: ['Ursula K. Le Guin'],
    sourceNames: ['Goodreads'],
    pageCount: 341,
    shelf: 'tbr',
    progress: 0,
    currentPage: 0,
    rating: 0,
    notes: '',
    addedAt: NOW,
    lastUpdatedAt: NOW,
    ...overrides,
  })
}

function result(overrides: Partial<BookSearchResult> = {}): BookSearchResult {
  return {
    id: 'metadata:result',
    title: 'The Dispossessed',
    authors: ['Ursula K. Le Guin'],
    identifiers: [ISBN],
    sourceNames: ['Open Library'],
    pageCount: 341,
    ...overrides,
  }
}
