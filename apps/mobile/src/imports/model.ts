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

export const goodreadsSourceBookSchema = z.object({
  bookId: z.string().min(1),
  authorSort: z.string().min(1).optional(),
  additionalAuthors: z.array(z.string().min(1)),
  isbn10: z.string().min(1).optional(),
  isbn13: z.string().min(1).optional(),
  averageRating: z.number().min(0).max(5).optional(),
  publisher: z.string().min(1).optional(),
  binding: z.string().min(1).optional(),
  yearPublished: z.number().int().positive().optional(),
  originalPublicationYear: z.number().int().optional(),
  dateRead: z.string().min(1).optional(),
  dateAdded: z.string().min(1).optional(),
  bookshelves: z.array(z.string().min(1)),
  bookshelvesWithPositions: z.string().min(1).optional(),
  exclusiveShelf: z.string().min(1),
  review: z.string().min(1).optional(),
  privateNotes: z.string().min(1).optional(),
  spoiler: z.boolean().optional(),
  readCount: z.number().int().nonnegative().optional(),
  ownedCopies: z.number().int().nonnegative().optional(),
})

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
  identifiers: libraryBookSchema.shape.identifiers,
  listNames: libraryBookSchema.shape.listNames,
  sourceNames: libraryBookSchema.shape.sourceNames,
  editionTitle: libraryBookSchema.shape.editionTitle,
  format: libraryBookSchema.shape.format,
  publisher: z.string().min(1).optional(),
  publicationDate: z.string().min(4).optional(),
  addedAt: libraryBookSchema.shape.addedAt.optional(),
  startedAt: libraryBookSchema.shape.startedAt,
  finishedAt: libraryBookSchema.shape.finishedAt,
  goodreads: goodreadsSourceBookSchema.optional(),
})

export const importEntityProposalSchema = z.object({
  entityType: z.enum([
    'work',
    'edition',
    'source-record',
    'identifier',
    'person',
    'contributor',
    'list',
    'list-entry',
    'integration-checkpoint',
    'reading-event',
    'progress-snapshot',
  ]),
  entityId: z.string().min(1),
  action: z.enum(['add', 'update', 'unchanged']),
  label: z.string().min(1),
  sourceKey: z.string().min(1),
  confidence: importMatchConfidenceSchema,
  rationale: z.string().min(1),
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
  entities: z.array(importEntityProposalSchema).default([]),
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
export type GoodreadsSourceBook = z.infer<typeof goodreadsSourceBookSchema>
export type ImportEntityProposal = z.infer<typeof importEntityProposalSchema>
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
