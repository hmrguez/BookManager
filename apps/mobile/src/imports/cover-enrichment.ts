import type { BookSearchResult, LibraryBook } from '../library-model'
import { canonicalEditionIsbn, normalizeSearchText } from '../metadata/model'
import type { MetadataSearchService } from '../metadata/service'

const GOODREADS_SOURCE = 'Goodreads'
const FALLBACK_LIVE_SEARCH_LIMIT = 20

export type GoodreadsCoverEnrichmentResult = {
  readonly candidateBooks: number
  readonly matchedByIsbn: number
  readonly matchedBySearch: number
  readonly unresolvedBooks: number
  readonly complete: boolean
}

export class GoodreadsCoverEnrichmentService {
  readonly #metadata: Pick<MetadataSearchService, 'search' | 'searchIsbns'>

  constructor(metadata: Pick<MetadataSearchService, 'search' | 'searchIsbns'>) {
    this.#metadata = metadata
  }

  async enrich(
    books: readonly LibraryBook[],
    options: {
      readonly locale: string
      readonly signal?: AbortSignal
      readonly onCover: (bookId: string, thumbnail: string) => void | Promise<void>
    },
  ): Promise<GoodreadsCoverEnrichmentResult> {
    const candidates = books.filter((book) =>
      !book.thumbnail && book.sourceNames?.includes(GOODREADS_SOURCE),
    )
    const isbnBatch = await this.#metadata.searchIsbns(
      unique(candidates.flatMap(({ identifiers }) => identifiers ?? [])),
      options.locale,
      { signal: options.signal },
    )
    const resolved = new Set<string>()
    let matchedByIsbn = 0
    let matchedBySearch = 0

    for (const book of candidates) {
      const thumbnail = isbnThumbnail(book, isbnBatch.results)
      if (!thumbnail) continue
      await options.onCover(book.id, thumbnail)
      resolved.add(book.id)
      matchedByIsbn += 1
    }

    let complete = isbnBatch.complete
    let liveFallbackSearches = 0
    if (isbnBatch.complete) {
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
  const expectedTitle = normalizeSearchText(book.title)
  const expectedAuthors = new Set(book.authors.map(normalizeSearchText))
  const variants = result.metadataSelection?.variants ?? []
  const titles = [result.title, ...variants.flatMap(({ title, workTitle }) => [title, workTitle])]
  const authors = [result.authors, ...variants.map(({ authors: variantAuthors }) => variantAuthors)].flat()
  return titles.some((title) => normalizeSearchText(title) === expectedTitle)
    && authors.some((author) => expectedAuthors.has(normalizeSearchText(author)))
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
