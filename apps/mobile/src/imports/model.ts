import { z } from 'zod'
import { libraryBookSchema } from '../library-model'

export const IMPORT_STAGES = [
  'parse',
  'normalize',
  'match',
  'propose',
  'review',
  'commit',
  'checkpoint',
] as const

export const importStageSchema = z.enum(IMPORT_STAGES)
export const importProposalKindSchema = z.enum(['add', 'update', 'conflict', 'skip', 'error'])
export const importMatchConfidenceSchema = z.enum(['exact', 'high', 'low', 'none'])

export const normalizedLibraryBookSchema = z.object({
  externalKey: z.string().min(1),
  title: z.string().min(1),
  authors: z.array(z.string().min(1)).min(1),
  pageCount: libraryBookSchema.shape.pageCount.optional(),
  shelf: libraryBookSchema.shape.shelf.optional(),
  progress: libraryBookSchema.shape.progress.optional(),
  currentPage: libraryBookSchema.shape.currentPage.optional(),
  rating: libraryBookSchema.shape.rating.optional(),
  notes: libraryBookSchema.shape.notes.optional(),
  addedAt: libraryBookSchema.shape.addedAt.optional(),
  startedAt: libraryBookSchema.shape.startedAt,
  finishedAt: libraryBookSchema.shape.finishedAt,
})

export const importStoredValueSchema = z.object({
  present: z.boolean(),
  value: z.json().optional(),
}).superRefine((stored, context) => {
  if (stored.present && stored.value === undefined) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'A present import value is required' })
  }
  if (!stored.present && stored.value !== undefined) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'An absent import value cannot carry data' })
  }
})

export const importFieldChangeSchema = z.object({
  field: z.string().min(1),
  before: importStoredValueSchema,
  after: importStoredValueSchema,
  reason: z.string().min(1),
})

export const importMatchCandidateSchema = z.object({
  targetId: z.string().min(1),
  title: z.string().min(1),
  authors: z.array(z.string()),
  score: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1)).min(1),
})

export const importMatchSchema = z.object({
  confidence: importMatchConfidenceSchema,
  targetId: z.string().min(1).optional(),
  candidates: z.array(importMatchCandidateSchema),
  reasons: z.array(z.string().min(1)).min(1),
})

export const importProposalSchema = z.object({
  id: z.string().min(1),
  rowNumber: z.number().int().positive(),
  raw: z.record(z.string(), z.string()),
  externalKey: z.string().min(1).optional(),
  rowHash: z.string().min(1),
  kind: importProposalKindSchema,
  record: normalizedLibraryBookSchema.optional(),
  targetId: z.string().min(1).optional(),
  match: importMatchSchema,
  changes: z.array(importFieldChangeSchema),
  reason: z.string().min(1),
  validationErrors: z.array(z.string().min(1)),
  defaultIncluded: z.boolean(),
  duplicateOfBatchId: z.string().min(1).optional(),
})

export const importPermissionSchema = z.object({
  scope: z.enum(['local-file:read', 'library:write', 'network:none']),
  access: z.enum(['read', 'write', 'none']),
  required: z.boolean(),
  label: z.string().min(1),
  explanation: z.string().min(1),
})

export const importSourceSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  permissions: z.array(importPermissionSchema).min(1),
})

export const importPreviewSchema = z.object({
  id: z.string().min(1),
  source: importSourceSchema,
  parser: z.object({ id: z.string().min(1), version: z.string().min(1) }),
  fileName: z.string().min(1),
  contentHash: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  status: z.literal('review'),
  completedStages: z.array(importStageSchema),
  proposals: z.array(importProposalSchema),
})

export const importReviewDecisionSchema = z.object({
  rowId: z.string().min(1),
  included: z.boolean(),
  targetId: z.string().min(1).optional(),
  targetUpdatedAt: libraryBookSchema.shape.lastUpdatedAt.optional(),
})

export type NormalizedLibraryBook = z.infer<typeof normalizedLibraryBookSchema>
export type ImportStoredValue = z.infer<typeof importStoredValueSchema>
export type ImportFieldChange = z.infer<typeof importFieldChangeSchema>
export type ImportProposalKind = z.infer<typeof importProposalKindSchema>
export type ImportMatchConfidence = z.infer<typeof importMatchConfidenceSchema>
export type ImportMatchCandidate = z.infer<typeof importMatchCandidateSchema>
export type ImportMatch = z.infer<typeof importMatchSchema>
export type ImportProposal = z.infer<typeof importProposalSchema>
export type ImportPermission = z.infer<typeof importPermissionSchema>
export type ImportSource = z.infer<typeof importSourceSchema>
export type ImportPreview = z.infer<typeof importPreviewSchema>
export type ImportReviewDecision = z.infer<typeof importReviewDecisionSchema>

export type ImportReceipt = {
  readonly sourceKey: string
  readonly externalKey: string
  readonly rowHash: string
  readonly batchId: string
  readonly targetId: string
}

export type ImportCommitResult = {
  readonly batchId: string
  readonly checkpointId: string
  readonly appliedRows: number
  readonly appliedChanges: number
  readonly excludedRows: number
  readonly skippedRows: number
  readonly duplicateRows: number
}

export type ImportUndoResult = {
  readonly batchId: string
  readonly restoredChanges: number
  readonly preservedChanges: number
  readonly deletedEntities: number
}

export type ImportBatchStatus = 'review' | 'committed' | 'undone'

export type ImportBatchSummary = {
  readonly id: string
  readonly sourceName: string
  readonly fileName: string
  readonly status: ImportBatchStatus
  readonly createdAt: string
  readonly committedAt?: string
  readonly undoneAt?: string
  readonly totalRows: number
  readonly appliedRows: number
  readonly changeCount: number
}
