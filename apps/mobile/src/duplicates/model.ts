import { z } from 'zod'
import { editionIdSchema, workIdSchema } from '../domain/catalog/ids'
import { identityOperationSchema } from '../domain/catalog/reconciliation'
import { isoDateTimeSchema } from '../domain/catalog/shared'

export const duplicateEvidenceKindSchema = z.enum([
  'identifier',
  'source-link',
  'title',
  'contributors',
  'publication',
  'language',
  'work-kind',
  'format-caution',
])

export const duplicateEvidenceSchema = z.object({
  kind: duplicateEvidenceKindSchema,
  tone: z.enum(['supporting', 'caution']),
  weight: z.number().min(-1).max(1),
  label: z.string().min(1),
  explanation: z.string().min(1),
})

export const duplicateCandidateSchema = z.object({
  id: z.string().regex(/^duplicate-candidate:[^\s]+$/),
  pairKey: z.string().regex(/^duplicate-pair:[^\s]+$/),
  leftWorkId: workIdSchema,
  rightWorkId: workIdSchema,
  confidence: z.enum(['high', 'medium', 'low']),
  score: z.number().min(0).max(1),
  reviewPriority: z.enum(['review', 'background']),
  requiresReview: z.literal(true),
  evidence: z.array(duplicateEvidenceSchema).min(1),
}).superRefine((candidate, context) => {
  if (candidate.leftWorkId === candidate.rightWorkId) {
    context.addIssue({
      code: 'custom',
      path: ['rightWorkId'],
      message: 'A duplicate candidate must compare two different Works',
    })
  }
  if (candidate.reviewPriority === 'background' && candidate.confidence !== 'low') {
    context.addIssue({
      code: 'custom',
      path: ['reviewPriority'],
      message: 'Only low-confidence candidates stay in the background queue',
    })
  }
})

export const duplicateDecisionActionSchema = z.enum([
  'merge',
  'keep-separate',
  'relate',
  'never-suggest',
])

export const duplicatePairDecisionSchema = z.object({
  id: z.string().regex(/^duplicate-decision:[^\s]+$/),
  pairKey: z.string().regex(/^duplicate-pair:[^\s]+$/),
  leftWorkId: workIdSchema,
  rightWorkId: workIdSchema,
  action: duplicateDecisionActionSchema,
  survivorWorkId: workIdSchema.optional(),
  operationId: identityOperationSchema.shape.id.optional(),
  decidedAt: isoDateTimeSchema,
  undoneAt: isoDateTimeSchema.optional(),
  rationale: z.string().min(1).optional(),
}).superRefine((decision, context) => {
  if (decision.leftWorkId === decision.rightWorkId) {
    context.addIssue({
      code: 'custom',
      path: ['rightWorkId'],
      message: 'A duplicate decision must compare two different Works',
    })
  }
  const pair = duplicatePairKey(decision.leftWorkId, decision.rightWorkId)
  if (decision.pairKey !== pair) {
    context.addIssue({
      code: 'custom',
      path: ['pairKey'],
      message: `Expected canonical pair key ${pair}`,
    })
  }
  if (decision.action === 'merge') {
    if (!decision.survivorWorkId || !decision.operationId) {
      context.addIssue({
        code: 'custom',
        path: ['operationId'],
        message: 'A merge decision requires its surviving Work and journal operation',
      })
    } else if (
      decision.survivorWorkId !== decision.leftWorkId
      && decision.survivorWorkId !== decision.rightWorkId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['survivorWorkId'],
        message: 'The surviving Work must belong to the reviewed pair',
      })
    }
  } else if (decision.survivorWorkId || decision.operationId) {
    context.addIssue({
      code: 'custom',
      path: ['operationId'],
      message: 'Only a merge decision can reference an identity operation',
    })
  }
})

export const duplicatePreviewCountsSchema = z.object({
  editions: z.number().int().nonnegative(),
  assets: z.number().int().nonnegative(),
  progress: z.number().int().nonnegative(),
  annotations: z.number().int().nonnegative(),
  listMemberships: z.number().int().nonnegative(),
  loans: z.number().int().nonnegative(),
  ownerships: z.number().int().nonnegative(),
  sources: z.number().int().nonnegative(),
})

export const duplicateEditionDestinationSchema = z.object({
  editionId: editionIdSchema,
  fromWorkId: workIdSchema,
  toWorkId: workIdSchema,
  title: z.string().min(1),
  medium: z.enum(['print', 'ebook', 'audiobook']),
  assets: z.number().int().nonnegative(),
  progress: z.number().int().nonnegative(),
  annotations: z.number().int().nonnegative(),
  loans: z.number().int().nonnegative(),
})

export const duplicateListChangeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move'),
    entryId: z.string().min(1),
    listId: z.string().min(1),
    listName: z.string().min(1),
    fromWorkId: workIdSchema,
    toWorkId: workIdSchema,
  }),
  z.object({
    kind: z.literal('consolidate'),
    entryId: z.string().min(1),
    destinationEntryId: z.string().min(1),
    listId: z.string().min(1),
    listName: z.string().min(1),
    fromWorkId: workIdSchema,
    toWorkId: workIdSchema,
  }),
])

export const duplicateMergePreviewSchema = z.object({
  absorbedWorkId: workIdSchema,
  absorbedTitle: z.string().min(1),
  survivingWorkId: workIdSchema,
  survivingTitle: z.string().min(1),
  moving: duplicatePreviewCountsSchema,
  destinationBefore: duplicatePreviewCountsSchema,
  destinationAfter: duplicatePreviewCountsSchema,
  editions: z.array(duplicateEditionDestinationSchema).min(1),
  listChanges: z.array(duplicateListChangeSchema),
  assurances: z.array(z.string().min(1)).min(1),
})

export const identityListMutationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move'),
    entryId: z.string().min(1),
    beforePayload: z.string().min(1),
    afterPayload: z.string().min(1),
  }),
  z.object({
    kind: z.literal('consolidate'),
    entryId: z.string().min(1),
    destinationEntryId: z.string().min(1),
    beforePayload: z.string().min(1),
  }),
])

export const identityOperationJournalSchema = z.object({
  operation: identityOperationSchema,
  status: z.enum(['applied', 'undone']),
  undoneAt: isoDateTimeSchema.optional(),
  preview: duplicateMergePreviewSchema.optional(),
  listMutations: z.array(identityListMutationSchema),
})

export type DuplicateEvidenceKind = z.infer<typeof duplicateEvidenceKindSchema>
export type DuplicateEvidence = z.infer<typeof duplicateEvidenceSchema>
export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>
export type DuplicateDecisionAction = z.infer<typeof duplicateDecisionActionSchema>
export type DuplicatePairDecision = z.infer<typeof duplicatePairDecisionSchema>
export type DuplicatePreviewCounts = z.infer<typeof duplicatePreviewCountsSchema>
export type DuplicateEditionDestination = z.infer<typeof duplicateEditionDestinationSchema>
export type DuplicateListChange = z.infer<typeof duplicateListChangeSchema>
export type DuplicateMergePreview = z.infer<typeof duplicateMergePreviewSchema>
export type IdentityListMutation = z.infer<typeof identityListMutationSchema>
export type IdentityOperationJournal = z.infer<typeof identityOperationJournalSchema>

export function duplicatePairKey(leftWorkId: string, rightWorkId: string): string {
  const [left, right] = [leftWorkId, rightWorkId].sort()
  return `duplicate-pair:${encodeURIComponent(left!)}:${encodeURIComponent(right!)}`
}

export function duplicateCandidateId(leftWorkId: string, rightWorkId: string): string {
  return duplicatePairKey(leftWorkId, rightWorkId).replace('duplicate-pair:', 'duplicate-candidate:')
}
