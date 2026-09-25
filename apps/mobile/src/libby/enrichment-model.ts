import { z } from 'zod'
import type { LibraryBook } from '../library-model'
import { canonicalEditionIsbn, normalizeSearchText, providerBookVariantSchema, type ProviderBookVariant } from '../metadata/model'

export const enrichmentJobSchema = z.object({
  id: z.uuid(), bookId: z.string(), fingerprint: z.string(),
  status: z.enum(['pending', 'retry', 'review', 'no-match', 'applied', 'dismissed']),
  attempts: z.number().int().nonnegative(), nextAttemptAt: z.iso.datetime(),
  candidates: z.array(providerBookVariantSchema).max(16),
})
export type EnrichmentJob = z.infer<typeof enrichmentJobSchema>

export function enrichmentFingerprint(book: LibraryBook): string {
  return JSON.stringify([book.title, book.authors, book.identifiers ?? [], book.format ?? ''])
}

export function bookMedium(book: LibraryBook): ProviderBookVariant['medium'] {
  const format = book.format?.toLowerCase()
  if (['audiobook', 'audio'].includes(format ?? '')) return 'audiobook'
  if (['ebook', 'epub', 'pdf', 'e-book'].includes(format ?? '')) return 'ebook'
  if (['print', 'paperback', 'hardcover'].includes(format ?? '')) return 'print'
  return undefined
}

export function exactEditionMatch(book: LibraryBook, variant: ProviderBookVariant): boolean {
  const identifiers = new Set(book.identifiers?.flatMap(value => canonicalEditionIsbn(value) ?? []))
  return !!variant.editionKey && !!bookMedium(book) && variant.medium === bookMedium(book)
    && !!variant.verifiedEditionIdentifiers?.some(({ normalizedValue }) => identifiers.has(canonicalEditionIsbn(normalizedValue)!))
}

export function matchingCandidates(book: LibraryBook, variants: readonly ProviderBookVariant[]): ProviderBookVariant[] {
  return [...new Map(variants.filter(variant => {
    if (exactEditionMatch(book, variant)) return true
    if (!variant.workKey) return false
    return normalizeSearchText(variant.workTitle) === normalizeSearchText(book.title)
      && variant.authors.some(author => book.authors.some(expected => normalizeSearchText(author) === normalizeSearchText(expected)))
  }).map(variant => [variant.id, variant])).values()].slice(0, 16)
}

/** Reviewed work identity does not establish the displayed search edition's identity. */
export function attachMissingMetadata(book: LibraryBook, candidate: ProviderBookVariant): LibraryBook {
  const exact = exactEditionMatch(book, candidate)
  const variant: ProviderBookVariant = exact ? { ...candidate, identifiers: candidate.verifiedEditionIdentifiers ?? [],
    pageCount: candidate.editionPageCount, thumbnail: candidate.editionThumbnail } : {
    id: `${candidate.provider}:${candidate.workKey}`, provider: candidate.provider, providerName: candidate.providerName,
    externalKey: candidate.workKey!, workKey: candidate.workKey, title: candidate.workTitle, workTitle: candidate.workTitle,
    authors: candidate.authors, identifiers: [], confidence: candidate.confidence, providerRank: candidate.providerRank,
    observedAt: candidate.observedAt, subjects: candidate.subjects?.filter(claim => claim.scope === 'work'),
  }
  const variants = [...(book.metadataSelection?.variants ?? [])]
  if (!variants.some(existing => existing.id === variant.id && existing.observedAt === variant.observedAt)) variants.push(variant)
  const locked = new Set(book.metadataLocks)
  return {
    ...book,
    metadataSelection: { selectedProvider: book.metadataSelection?.selectedProvider ?? candidate.provider,
      variants, conflicts: book.metadataSelection?.conflicts ?? [], freshness: 'saved' },
    sourceNames: [...new Set([...(book.sourceNames ?? []), candidate.providerName])],
    // Existing values (including reader-selected artwork) always win. No audio-to-page conversion.
    pageCount: !locked.has('pageCount') && exact && bookMedium(book) !== 'audiobook' && book.pageCount === 0
      ? candidate.editionPageCount ?? 0 : book.pageCount,
    thumbnail: !locked.has('thumbnail') && exact ? book.thumbnail ?? candidate.editionThumbnail : book.thumbnail,
  }
}

