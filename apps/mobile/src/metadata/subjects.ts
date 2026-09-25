import type { LibraryBook } from '../library-model'

/** Raw peer claims stay separate; classification and disagreement policy belong to QUI-110. */
export function bookSubjectEvidence(book: LibraryBook) {
  if (book.subjectOverride !== undefined) return { override: book.subjectOverride, claims: [] }
  return { claims: book.metadataSelection?.variants.flatMap(variant => (variant.subjects ?? []).map(claim => ({
    ...claim, provider: variant.provider, observedAt: variant.observedAt, confidence: variant.confidence,
  }))) ?? [] }
}
