import type { BookSearchResult, LibraryBook } from '../library-model'
import { canonicalEditionIsbn, normalizeSearchText } from '../metadata/model'
import type { CaptureMethod, CapturedField } from './model'
import type { ValidIsbn } from './isbn'

export type ManualBookDraft = {
  readonly title: string
  readonly author?: string
  readonly pageCount?: number
  readonly isbn?: ValidIsbn
  readonly method: CaptureMethod
}

export type DuplicateProposal = {
  readonly kind: 'exact-edition' | 'related-edition'
  readonly book: LibraryBook
}

export function createManualBookResult(
  draft: ManualBookDraft,
  now = new Date().toISOString(),
): BookSearchResult {
  const cleanAuthor = draft.author?.trim()
  const pageCount = Math.max(0, Math.round(draft.pageCount ?? 0))
  const manualOverrides: CapturedField[] = ['title']
  if (cleanAuthor) manualOverrides.push('authors')
  if (pageCount > 0) manualOverrides.push('pageCount')

  return {
    id: `manual-${createLocalId()}`,
    title: draft.title.trim(),
    authors: [cleanAuthor || 'Unknown author'],
    identifiers: draft.isbn ? [draft.isbn.normalized] : undefined,
    pageCount,
    capture: {
      method: draft.method,
      capturedAt: now,
      manualOverrides,
    },
  }
}

export function proposeCaptureDuplicate(
  books: readonly LibraryBook[],
  candidate: BookSearchResult,
): DuplicateProposal | undefined {
  const candidateIsbns = canonicalIsbns(candidate.identifiers)
  const exact = books.find((book) =>
    [...canonicalIsbns(book.identifiers)].some((isbn) => candidateIsbns.has(isbn)),
  )
  if (exact) return { kind: 'exact-edition', book: exact }

  const candidateWorkKeys = new Set(candidate.metadataSelection?.variants.flatMap(
    ({ provider, workKey }) => workKey ? [`${provider}:${workKey}`] : [],
  ))
  const related = books.find((book) => {
    if (candidateWorkKeys.size > 0 && book.metadataSelection?.variants.some(
      ({ provider, workKey }) => workKey && candidateWorkKeys.has(`${provider}:${workKey}`),
    )) return true

    if (normalizeSearchText(book.title) !== normalizeSearchText(candidate.title)) return false
    const existingAuthors = new Set(book.authors.map(normalizeSearchText).filter(isKnownAuthor))
    return candidate.authors.map(normalizeSearchText).filter(isKnownAuthor)
      .some((author) => existingAuthors.has(author))
  })
  return related ? { kind: 'related-edition', book: related } : undefined
}

export function applyManualBookEdits(
  book: LibraryBook,
  edits: { readonly title: string; readonly author: string; readonly pageCount: number; readonly isbn?: ValidIsbn },
  now = new Date().toISOString(),
): Partial<LibraryBook> {
  const cleanAuthor = edits.author.trim()
  const pageCount = Math.max(0, Math.round(edits.pageCount))
  const manualOverrides: CapturedField[] = ['title']
  if (cleanAuthor) manualOverrides.push('authors')
  if (pageCount > 0) manualOverrides.push('pageCount')

  return {
    title: edits.title.trim(),
    authors: [cleanAuthor || 'Unknown author'],
    pageCount,
    identifiers: mergeUnique(
      book.identifiers ?? [],
      edits.isbn ? [edits.isbn.normalized] : [],
    ),
    capture: {
      method: book.capture?.method ?? 'manual-entry',
      capturedAt: book.capture?.capturedAt ?? book.addedAt,
      enrichedAt: book.capture?.enrichedAt,
      manualOverrides,
    },
    lastUpdatedAt: now,
  }
}

/** Provider facts fill gaps while explicit reader-entered fields keep winning. */
export function enrichCapturedBook(
  book: LibraryBook,
  result: BookSearchResult,
  now = new Date().toISOString(),
): Partial<LibraryBook> {
  const overrides = new Set(book.capture?.manualOverrides ?? [])
  return {
    title: overrides.has('title') ? book.title : result.title,
    authors: overrides.has('authors') ? book.authors : result.authors,
    pageCount: overrides.has('pageCount') ? book.pageCount : result.pageCount,
    identifiers: mergeUnique(book.identifiers ?? [], result.identifiers ?? []),
    sourceNames: mergeUnique(book.sourceNames ?? [], result.sourceNames ?? []),
    thumbnail: result.thumbnail ?? book.thumbnail,
    editionTitle: result.editionTitle ?? book.editionTitle,
    metadataSelection: result.metadataSelection ?? book.metadataSelection,
    capture: book.capture ? { ...book.capture, enrichedAt: now } : undefined,
    lastUpdatedAt: now,
  }
}

function canonicalIsbns(values: readonly string[] | undefined): ReadonlySet<string> {
  return new Set(values?.flatMap((value) => canonicalEditionIsbn(value) ?? []) ?? [])
}

function isKnownAuthor(value: string): boolean {
  return Boolean(value && value !== 'unknown author')
}

function mergeUnique(left: readonly string[], right: readonly string[]): string[] | undefined {
  const values = [...new Set([...left, ...right].map((value) => value.trim()).filter(Boolean))]
  return values.length ? values : undefined
}

function createLocalId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
