import { z } from 'zod'
import {
  canonicalEditionIsbn,
  metadataSelectionSchema,
  type MetadataSelection,
} from './metadata/model'
import { bookCaptureSchema, type BookCapture } from './capture/model'

export const shelfIdSchema = z.enum(['tbr', 'next', 'reading', 'finished'])

export const libraryLoanSchema = z.object({
  provider: z.string().trim().min(1),
  borrowedAt: z.iso.datetime({ offset: true }).optional(),
  dueAt: z.iso.datetime({ offset: true }),
  returnedAt: z.iso.datetime({ offset: true }).optional(),
})

export const libraryBookSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  authors: z.array(z.string().min(1)),
  alternateTitles: z.array(z.string().min(1)).optional(),
  series: z.array(z.string().min(1)).optional(),
  identifiers: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  listNames: z.array(z.string().min(1)).optional(),
  sourceNames: z.array(z.string().min(1)).optional(),
  capture: bookCaptureSchema.optional(),
  metadataSelection: metadataSelectionSchema.optional(),
  editionTitle: z.string().min(1).optional(),
  format: z.string().min(1).optional(),
  loan: libraryLoanSchema.optional(),
  thumbnail: z.url().optional(),
  pageCount: z.number().int().nonnegative(),
  shelf: shelfIdSchema,
  progress: z.number().min(0).max(100),
  currentPage: z.number().int().nonnegative(),
  rating: z.number().int().min(0).max(5),
  notes: z.string(),
  addedAt: z.iso.datetime({ offset: true }),
  startedAt: z.iso.datetime({ offset: true }).optional(),
  finishedAt: z.iso.datetime({ offset: true }).optional(),
  lastUpdatedAt: z.iso.datetime({ offset: true }),
})

export type ShelfId = z.infer<typeof shelfIdSchema>
export type LibraryBook = z.infer<typeof libraryBookSchema>

export type BookSearchResult = Pick<
  LibraryBook,
  | 'id'
  | 'title'
  | 'authors'
  | 'identifiers'
  | 'sourceNames'
  | 'capture'
  | 'thumbnail'
  | 'pageCount'
> & {
  readonly editionTitle?: string
  readonly metadataSelection?: MetadataSelection
  readonly capture?: BookCapture
}

export function findLibraryBookForSearchResult(
  books: readonly LibraryBook[],
  result: BookSearchResult,
): LibraryBook | undefined {
  const providerKeys = new Set(
    result.metadataSelection?.variants.map(({ provider, externalKey }) => `${provider}:${externalKey}`),
  )
  const editionIsbns = new Set(
    result.metadataSelection?.variants.flatMap(({ identifiers }) =>
      identifiers.flatMap(({ normalizedValue }) => canonicalEditionIsbn(normalizedValue) ?? []),
    ) ?? [],
  )
  for (const identifier of result.identifiers ?? []) {
    const canonical = canonicalEditionIsbn(identifier)
    if (canonical) editionIsbns.add(canonical)
  }

  return books.find((book) => {
    if (book.identifiers?.some((identifier) => {
      const canonical = canonicalEditionIsbn(identifier)
      return canonical ? editionIsbns.has(canonical) : false
    })) return true
    if (!result.metadataSelection) return book.id === result.id
    const matchesLegacyProviderId = result.metadataSelection.variants.some(
      ({ externalKey, providerName }) =>
        book.id === externalKey && book.sourceNames?.includes(providerName),
    )
    if (matchesLegacyProviderId) return true
    const matchingProviderRecord = book.metadataSelection?.variants.some(({ provider, externalKey }) =>
      providerKeys.has(`${provider}:${externalKey}`),
    )
    if (matchingProviderRecord) return true
    return book.metadataSelection?.variants.some(({ identifiers }) =>
      identifiers.some(({ normalizedValue }) => {
        const canonical = canonicalEditionIsbn(normalizedValue)
        return canonical ? editionIsbns.has(canonical) : false
      }),
    )
  })
}

export const STARTER_LIBRARY_BOOK_IDS = [
  'starter-will-of-the-many',
  'starter-mistborn',
  'starter-assassins-apprentice',
  'starter-vita-nostra',
  'starter-tainted-cup',
  'starter-blade-itself',
  'starter-jonathan-strange',
  'starter-piranesi',
] as const

const starterLibraryBookIds = new Set<string>(STARTER_LIBRARY_BOOK_IDS)

export function isStarterLibraryBookId(id: string): boolean {
  return starterLibraryBookIds.has(id)
}

export function isUntouchedStarterLibraryBook(book: LibraryBook): boolean {
  if (!isStarterLibraryBookId(book.id)) return false
  const original = createStarterLibrary(book.addedAt).find(({ id }) => id === book.id)
  return original !== undefined && JSON.stringify(original) === JSON.stringify(book)
}

export function createStarterLibrary(timestamp = new Date().toISOString()): LibraryBook[] {
  const loanDueAt = new Date(new Date(timestamp).getTime() + 6 * 86_400_000).toISOString()
  return libraryBookSchema.array().parse([
    {
      id: 'starter-will-of-the-many',
      title: 'The Will of the Many',
      authors: ['James Islington'],
      series: ['Hierarchy'],
      tags: ['Epic', 'Political'],
      format: 'eBook',
      loan: { provider: 'Libby', borrowedAt: timestamp, dueAt: loanDueAt },
      pageCount: 639,
      shelf: 'tbr',
      progress: 0,
      currentPage: 0,
      rating: 0,
      notes: '',
      addedAt: timestamp,
      lastUpdatedAt: timestamp,
    },
    {
      id: 'starter-mistborn',
      title: 'Mistborn',
      authors: ['Brandon Sanderson'],
      series: ['Mistborn'],
      tags: ['Epic', 'Heist'],
      format: 'Paperback',
      pageCount: 541,
      shelf: 'tbr',
      progress: 0,
      currentPage: 0,
      rating: 0,
      notes: '',
      addedAt: timestamp,
      lastUpdatedAt: timestamp,
    },
    {
      id: 'starter-assassins-apprentice',
      title: "Assassin's Apprentice",
      authors: ['Robin Hobb'],
      series: ['The Farseer Trilogy'],
      tags: ['Character-driven', 'Melancholy'],
      format: 'Paperback',
      pageCount: 448,
      shelf: 'next',
      progress: 0,
      currentPage: 0,
      rating: 0,
      notes: '',
      addedAt: timestamp,
      lastUpdatedAt: timestamp,
    },
    {
      id: 'starter-vita-nostra',
      title: 'Vita Nostra',
      authors: ['Marina & Sergey Dyachenko'],
      tags: ['Surreal', 'Challenging'],
      format: 'eBook',
      pageCount: 416,
      shelf: 'next',
      progress: 0,
      currentPage: 0,
      rating: 0,
      notes: '',
      addedAt: timestamp,
      lastUpdatedAt: timestamp,
    },
    {
      id: 'starter-tainted-cup',
      title: 'The Tainted Cup',
      authors: ['Robert Jackson Bennett'],
      pageCount: 400,
      shelf: 'reading',
      progress: 67,
      currentPage: 268,
      rating: 0,
      notes: 'Loving the atmosphere and the layered world-building.',
      addedAt: timestamp,
      startedAt: timestamp,
      lastUpdatedAt: timestamp,
    },
    {
      id: 'starter-blade-itself',
      title: 'The Blade Itself',
      authors: ['Joe Abercrombie'],
      pageCount: 515,
      shelf: 'reading',
      progress: 31,
      currentPage: 160,
      rating: 0,
      notes: '',
      addedAt: timestamp,
      startedAt: timestamp,
      lastUpdatedAt: timestamp,
    },
    {
      id: 'starter-jonathan-strange',
      title: 'Jonathan Strange & Mr Norrell',
      authors: ['Susanna Clarke'],
      pageCount: 1006,
      shelf: 'finished',
      progress: 100,
      currentPage: 1006,
      rating: 5,
      notes: '',
      addedAt: timestamp,
      finishedAt: timestamp,
      lastUpdatedAt: timestamp,
    },
    {
      id: 'starter-piranesi',
      title: 'Piranesi',
      authors: ['Susanna Clarke'],
      pageCount: 272,
      shelf: 'finished',
      progress: 100,
      currentPage: 272,
      rating: 4,
      notes: '',
      addedAt: timestamp,
      finishedAt: timestamp,
      lastUpdatedAt: timestamp,
    },
  ])
}
