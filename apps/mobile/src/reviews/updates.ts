import type { SavedReviewFacts } from './keepsake-model'

/** Stable comparison independent of object key order and calculation time. */
export function reviewFingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'knownAt').sort(([a], [b]) => a.localeCompare(b))) : item)
}

/** Evidence bookkeeping alone must not interrupt the reader with an update notice. */
export function reviewContent(facts: SavedReviewFacts): string {
  return JSON.stringify(facts, (key, value) => ['knownAt', 'refs', 'evidence', 'excludedEvidence', 'evidenceRefs', 'pageEvidenceRefs', 'classifications'].includes(key)
    ? undefined : value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
}
export type ReviewUpdatePreview = { token: string; before: SavedReviewFacts; after: SavedReviewFacts }
