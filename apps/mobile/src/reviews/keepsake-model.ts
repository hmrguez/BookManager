import { z } from 'zod'
import { activeReadingCaptureSchema } from '../domain/catalog/active-capture'
import { readingEventSourceSchema } from '../domain/catalog/progress'
import { REVIEW_GENRES } from './genres'
import type { calculateQuarterlyReview } from './evidence'

const text = z.string().min(1)
const refs = z.array(text)
const instant = z.iso.datetime({ offset: true })
const count = z.number().nonnegative()
export const reviewPeriodSchema = z.object({ year: z.number().int().min(1900).max(9998), quarter: z.number().int().min(1).max(4) }).strict()
export type ReviewPeriod = z.infer<typeof reviewPeriodSchema>
export const reviewTimezoneSchema = text.refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}, 'Invalid review timezone')
// Stored boundaries are authoritative. Never reinterpret them through a newer timezone database.
export const savedQuarterSchema = reviewPeriodSchema.extend({ timezone: reviewTimezoneSchema, start: instant, end: instant })
  .refine(q => Date.parse(q.start) < Date.parse(q.end), 'Invalid saved quarter boundaries')
const metricSchema = z.object({ value: count.optional(), workIds: refs, refs, detail: z.string().optional(), unavailable: text.optional() }).strict()
const coverageSchema = z.object({ quarter: savedQuarterSchema, metricId: text, ruleVersion: text, captureVersion: text,
  complete: z.boolean(), evidenceRefs: refs }).strict()
const comparisonSchema = z.object({ quarter: savedQuarterSchema, value: count, coverage: coverageSchema, refs, workIds: refs }).strict()
const badgeSchema = metricSchema.extend({ id: text, name: text, family: z.enum(['completion', 'discovery', 'time', 'rhythm', 'reflection', 'progress']),
  unit: text, thresholds: z.array(z.number().positive()).min(1), fact: text, value: count,
  tier: z.number().int().positive(), development: count, personalBest: z.boolean(), comparisons: z.array(comparisonSchema), coverage: coverageSchema.optional() })
const genreSchema = z.enum(REVIEW_GENRES)
const claimSchema = z.object({ provider: text, sourceKey: text, scope: z.enum(['work', 'edition']), observedAt: instant, values: z.array(text) }).strict()
const classificationSchema = z.object({ workId: text, status: z.enum(['resolved', 'unknown', 'unresolved']), families: z.array(genreSchema),
  evidence: z.object({ override: z.array(text).nullable().optional(), claims: z.array(claimSchema) }).strict() }).strict()

/** Private structured facts only: deliberately no passage, note, locator or file payload. */
export const savedReviewFactsSchema = z.object({
  quarter: savedQuarterSchema, knownAt: instant, ruleVersion: text, selectionVersion: text,
  metrics: z.record(text, metricSchema), earned: z.array(badgeSchema), featuredIds: refs, revealIds: refs,
  genre: z.object({ total: count, classified: count, unknown: count, counts: z.object({
    fantasy: count, mystery: count, romance: count, 'science-fiction': count, history: count, 'literary-fiction': count, nonfiction: count, horror: count,
  }).strict(), suggested: genreSchema.nullable(), wording: z.enum(['inspired-by-your-reading', 'choose-your-pathway']), choices: z.array(genreSchema),
  classifications: z.array(classificationSchema) }).strict(),
  supportingBooks: z.array(z.object({ workId: text, title: z.string(), editions: z.array(z.object({ id: text, title: text,
    medium: z.enum(['print', 'ebook', 'audiobook']), language: text, pageCount: count.nullable(), pageEvidenceRefs: refs }).strict()),
  books: z.array(z.object({ id: text, title: text, rating: z.number().min(0).max(5), series: z.array(text) }).strict()),
  authors: z.array(z.object({ id: text, name: text }).strict()) }).strict()),
  evidence: z.array(z.object({ id: text, editionId: text, source: readingEventSourceSchema, effectiveAt: instant, recordedAt: instant,
    timeConfidence: z.number().min(0).max(1), correctionTargets: refs, capture: activeReadingCaptureSchema.nullable() }).strict()),
  excludedEvidence: refs,
}).strict().superRefine((facts, context) => {
  const unique = (ids: string[]) => new Set(ids).size === ids.length
  const earned = facts.earned.map(b => b.id)
  if (!unique(earned) || !unique(facts.featuredIds) || !unique(facts.revealIds)
    || facts.featuredIds.length > 5 || facts.featuredIds.some(id => !earned.includes(id))
    || facts.revealIds.length !== facts.featuredIds.length || facts.revealIds.some(id => !facts.featuredIds.includes(id))) {
    context.addIssue({ code: 'custom', message: 'Invalid saved badge selection' })
  }
  if (Date.parse(facts.knownAt) < Date.parse(facts.quarter.end)) context.addIssue({ code: 'custom', message: 'Quarter is not complete' })
})
export type SavedReviewFacts = z.infer<typeof savedReviewFactsSchema>
// Keep compile-time coverage of the engine boundary without casting unvalidated JSON.
export function saveableReviewFacts(result: ReturnType<typeof calculateQuarterlyReview>): SavedReviewFacts {
  return savedReviewFactsSchema.parse(result)
}

export const reviewIdentitySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unselected') }).strict(),
  z.object({ status: z.literal('chosen'), genre: genreSchema }).strict(),
  z.object({ status: z.literal('skipped') }).strict(),
  z.object({ status: z.literal('removed') }).strict(),
])
export type ReviewIdentity = z.infer<typeof reviewIdentitySchema>
export const reviewStepSchema = z.discriminatedUnion('kind', [
  z.object({ id: text, kind: z.literal('badge'), badgeId: text }).strict(),
  z.object({ id: text, kind: z.enum(['reflection', 'pathway', 'collection']) }).strict(),
])
export const reviewArtworkSchema = z.object({ version: text, finishedStill: text, animation: text.nullable() }).strict()
export type ReviewArtwork = z.infer<typeof reviewArtworkSchema>
export const keepsakeSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().startsWith('review:'), createdAt: instant,
  facts: savedReviewFactsSchema,
  artwork: z.object({ achievementVersion: text, pathways: z.record(genreSchema, reviewArtworkSchema) }).strict(),
  steps: z.array(reviewStepSchema).min(2),
  identity: reviewIdentitySchema, completedAt: instant.nullable(),
  progress: z.object({ stepId: text, updatedAt: instant }).strict(),
}).strict().superRefine((saved, context) => {
  const period = saved.facts.quarter
  const expected = reviewSteps(saved.id, saved.facts.revealIds)
  if (saved.id !== reviewId(period) || JSON.stringify(saved.steps) !== JSON.stringify(expected)
    || !saved.steps.some(step => step.id === saved.progress.stepId)) {
    context.addIssue({ code: 'custom', message: 'Invalid saved review or step identity' })
  }
  if (saved.completedAt && saved.identity.status === 'unselected') context.addIssue({ code: 'custom', message: 'Complete identity choice or skip first' })
})
export type ReviewKeepsake = z.infer<typeof keepsakeSchema>
export type ReviewArtworkManifest = ReviewKeepsake['artwork']
export function reviewId(period: ReviewPeriod) { return `review:${period.year}-Q${period.quarter}` }
export function reviewOrdinal(period: ReviewPeriod) { return period.year * 4 + period.quarter - 1 }
export function periodAt(ordinal: number): ReviewPeriod { return reviewPeriodSchema.parse({ year: Math.floor(ordinal / 4), quarter: ordinal % 4 + 1 }) }
export function reviewSteps(id: string, revealIds: readonly string[]) {
  return [...(revealIds.length ? revealIds.map(badgeId => ({ id: `${id}:badge:${badgeId}`, kind: 'badge' as const, badgeId }))
    : [{ id: `${id}:reflection`, kind: 'reflection' as const }]),
  { id: `${id}:pathway`, kind: 'pathway' as const }, { id: `${id}:collection`, kind: 'collection' as const }]
}

export const reviewSettingsSchema = z.object({ schemaVersion: z.literal(1), initialTimezone: reviewTimezoneSchema,
  changes: z.array(z.object({ from: reviewPeriodSchema, timezone: reviewTimezoneSchema }).strict()),
}).strict().refine(s => s.changes.every((change, i) => i === 0 || reviewOrdinal(s.changes[i - 1]!.from) < reviewOrdinal(change.from)), 'Timezone changes must be ordered and unique')
export type ReviewSettings = z.infer<typeof reviewSettingsSchema>

/** Presentation chooses a still when the referenced animation is unavailable; facts stay intact. */
export function pathwayPresentation(saved: ReviewKeepsake, available: (asset: string) => boolean) {
  if (saved.identity.status !== 'chosen') return null
  const artwork = saved.artwork.pathways[saved.identity.genre]
  return { ...artwork, animation: artwork.animation && available(artwork.animation) ? artwork.animation : null,
    stillAvailable: available(artwork.finishedStill) }
}
