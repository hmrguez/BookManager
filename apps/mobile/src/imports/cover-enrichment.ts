import type { BookSearchResult, LibraryBook } from '../library-model'
import { canonicalEditionIsbn, normalizeSearchText } from '../metadata/model'
import type { MetadataSearchService } from '../metadata/service'
import { coverSearchTitle, OPEN_LIBRARY_TITLE_BATCH_SIZE } from '../metadata/open-library'

const GOODREADS_SOURCE = 'Goodreads'
const FALLBACK_LIVE_SEARCH_LIMIT = 20
const ISBN_BATCH_SIZE = 40

export type GoodreadsCoverEnrichmentResult = {
  readonly candidateBooks: number
  readonly matchedByIsbn: number
  readonly matchedBySearch: number
  readonly unresolvedBooks: number
  readonly complete: boolean
}

export type GoodreadsCoverEnrichmentProgress = {
  readonly candidateBooks: number
  readonly resolvedBooks: number
}

export class GoodreadsCoverEnrichmentService {
  readonly #metadata: Pick<MetadataSearchService, 'search' | 'searchIsbns'> & Partial<Pick<MetadataSearchService, 'searchTitles'>>

  constructor(metadata: Pick<MetadataSearchService, 'search' | 'searchIsbns'> & Partial<Pick<MetadataSearchService, 'searchTitles'>>) {
    this.#metadata = metadata
  }

  async enrich(
    books: readonly LibraryBook[],
    options: {
      readonly locale: string
      readonly signal?: AbortSignal
      readonly onCover: (bookId: string, thumbnail: string) => void | Promise<void>
      readonly onProgress?: (progress: GoodreadsCoverEnrichmentProgress) => void
    },
  ): Promise<GoodreadsCoverEnrichmentResult> {
    const candidates = goodreadsBooksMissingCovers(books)
    options.onProgress?.({ candidateBooks: candidates.length, resolvedBooks: 0 })
    const resolved = new Set<string>()
    let matchedByIsbn = 0
    let matchedBySearch = 0
    let complete = true
    const isbns = unique(candidates.flatMap(({ identifiers }) =>
      (identifiers ?? []).flatMap((identifier) => canonicalEditionIsbn(identifier) ?? []),
    ))

    for (let offset = 0; offset < isbns.length; offset += ISBN_BATCH_SIZE) {
      const isbnBatch = await this.#metadata.searchIsbns(isbns.slice(offset, offset + ISBN_BATCH_SIZE), options.locale, { signal: options.signal })
      for (const book of candidates) {
        if (resolved.has(book.id)) continue
        const thumbnail = isbnThumbnail(book, isbnBatch.results)
        if (!thumbnail) continue
        await options.onCover(book.id, thumbnail)
        resolved.add(book.id)
        matchedByIsbn += 1
        options.onProgress?.({ candidateBooks: candidates.length, resolvedBooks: resolved.size })
      }
      if (!isbnBatch.complete) { complete = false; break }
    }

    let liveFallbackSearches = 0
    if (complete && this.#metadata.searchTitles) {
      const remaining = candidates.filter((book) => !resolved.has(book.id))
      for (let offset = 0; offset < remaining.length; offset += OPEN_LIBRARY_TITLE_BATCH_SIZE) {
        const batch = remaining.slice(offset, offset + OPEN_LIBRARY_TITLE_BATCH_SIZE)
        const response = await this.#metadata.searchTitles(batch, options.locale, { signal: options.signal })
        const state = response.providers[0]?.state
        for (const book of batch) {
          const thumbnail = response.results.find((result) => result.thumbnail && isExactTitleAndAuthor(result, book))?.thumbnail
          if (!thumbnail) continue
          await options.onCover(book.id, thumbnail)
          resolved.add(book.id)
          matchedBySearch += 1
          options.onProgress?.({ candidateBooks: candidates.length, resolvedBooks: resolved.size })
        }
        if (state === 'unavailable' || state === 'not-configured') { complete = false; break }
      }
    } else if (complete) {
      for (const book of candidates) {
        if (resolved.has(book.id)) continue
        if (liveFallbackSearches >= FALLBACK_LIVE_SEARCH_LIMIT) {
          complete = false
          break
        }
        const response = await this.#metadata.search({
          query: [book.title, book.authors[0]].filter(Boolean).join(' '),
          locale: options.locale,
          limit: 8,
        }, { signal: options.signal })
        const providerState = response.providers[0]?.state
        if (providerState === 'live' || providerState === 'empty') liveFallbackSearches += 1
        if (providerState === 'unavailable' || providerState === 'not-configured') {
          complete = false
          break
        }
        const thumbnail = response.results.find((result) =>
          result.thumbnail && isExactTitleAndAuthor(result, book),
        )?.thumbnail
        if (!thumbnail) continue
        await options.onCover(book.id, thumbnail)
        resolved.add(book.id)
        matchedBySearch += 1
        options.onProgress?.({ candidateBooks: candidates.length, resolvedBooks: resolved.size })
      }
    }

    return {
      candidateBooks: candidates.length,
      matchedByIsbn,
      matchedBySearch,
      unresolvedBooks: candidates.length - resolved.size,
      complete,
    }
  }
}

export function countGoodreadsBooksMissingCovers(books: readonly LibraryBook[]): number {
  return goodreadsBooksMissingCovers(books).length
}

function goodreadsBooksMissingCovers(books: readonly LibraryBook[]): LibraryBook[] {
  return books.filter((book) =>
    !book.thumbnail && book.sourceNames?.includes(GOODREADS_SOURCE),
  )
}

function isbnThumbnail(
  book: LibraryBook,
  results: ReadonlyMap<string, readonly BookSearchResult[]>,
): string | undefined {
  for (const identifier of book.identifiers ?? []) {
    const isbn = canonicalEditionIsbn(identifier)
    if (!isbn) continue
    const thumbnail = results.get(isbn)?.find(({ thumbnail }) => thumbnail)?.thumbnail
    if (thumbnail) return thumbnail
  }
  return undefined
}

function isExactTitleAndAuthor(result: BookSearchResult, book: LibraryBook): boolean {
  const expectedTitle = normalizeSearchText(coverSearchTitle(book.title))
  const expectedAuthors = new Set(book.authors.map(normalizeSearchText))
  const variants = result.metadataSelection?.variants ?? []
  const titles = [result.title, ...variants.flatMap(({ title, workTitle }) => [title, workTitle])]
  const authors = [result.authors, ...variants.map(({ authors: variantAuthors }) => variantAuthors)].flat()
  return titles.some((title) => normalizeSearchText(coverSearchTitle(title)) === expectedTitle)
    && authors.some((author) => expectedAuthors.has(normalizeSearchText(author)))
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
