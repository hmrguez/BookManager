import { z } from 'zod'
import type { Edition } from './editions'
import { editionIdSchema, workIdSchema, type EditionId, type WorkId } from './ids'
import { isoDateTimeSchema } from './shared'

export const identityOperationSchema = z.object({
  id: z.string().regex(/^identity-operation:[^\s]+$/),
  kind: z.enum(['merge-works', 'split-work', 'reassign-edition']),
  fromWorkId: workIdSchema,
  toWorkId: workIdSchema,
  editionIds: z.array(editionIdSchema).min(1),
  recordedAt: isoDateTimeSchema,
  rationale: z.string().min(1),
}).superRefine((operation, context) => {
  if (operation.fromWorkId === operation.toWorkId) {
    context.addIssue({
      code: 'custom',
      path: ['toWorkId'],
      message: 'An identity operation must move Editions between different Works',
    })
  }
  if (new Set(operation.editionIds).size !== operation.editionIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['editionIds'],
      message: 'An identity operation cannot list an Edition more than once',
    })
  }
  if (operation.kind === 'reassign-edition' && operation.editionIds.length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['editionIds'],
      message: 'Edition reassignment moves exactly one Edition',
    })
  }
})

export type IdentityOperation = z.infer<typeof identityOperationSchema>
export type IdentityOperationDetails = Pick<IdentityOperation, 'id' | 'recordedAt' | 'rationale'>

export function createWorkMergeOperation(
  editions: readonly Edition[],
  absorbedWorkId: WorkId,
  survivingWorkId: WorkId,
  details: IdentityOperationDetails,
): IdentityOperation {
  const editionIds = editions
    .filter(({ workId }) => workId === absorbedWorkId)
    .map(({ id }) => id)
  if (!editionIds.length) throw new Error(`Work ${absorbedWorkId} has no Editions to merge`)

  return identityOperationSchema.parse({
    ...details,
    kind: 'merge-works',
    fromWorkId: absorbedWorkId,
    toWorkId: survivingWorkId,
    editionIds,
  })
}

export function createWorkSplitOperation(
  editionIds: readonly EditionId[],
  sourceWorkId: WorkId,
  newWorkId: WorkId,
  details: IdentityOperationDetails,
): IdentityOperation {
  return identityOperationSchema.parse({
    ...details,
    kind: 'split-work',
    fromWorkId: sourceWorkId,
    toWorkId: newWorkId,
    editionIds,
  })
}

export function createEditionReassignmentOperation(
  editionId: EditionId,
  fromWorkId: WorkId,
  toWorkId: WorkId,
  details: IdentityOperationDetails,
): IdentityOperation {
  return identityOperationSchema.parse({
    ...details,
    kind: 'reassign-edition',
    fromWorkId,
    toWorkId,
    editionIds: [editionId],
  })
}

/**
 * Works are retained as recoverable identity records. Only Edition.workId changes; Edition IDs
 * and every child record stay stable. Persistence applies this operation and its journal row in
 * one transaction.
 */
export function applyIdentityOperation(
  editions: readonly Edition[],
  input: IdentityOperation,
): readonly Edition[] {
  const operation = identityOperationSchema.parse(input)
  const editionIds = new Set(operation.editionIds)
  const availableIds = new Set(editions.map(({ id }) => id))
  operation.editionIds.forEach((editionId) => {
    if (!availableIds.has(editionId)) throw new Error(`Missing Edition ${editionId}`)
  })

  if (operation.kind === 'merge-works') {
    const completeSource = editions
      .filter(({ workId }) => workId === operation.fromWorkId)
      .map(({ id }) => id)
    if (
      completeSource.length !== editionIds.size ||
      completeSource.some((editionId) => !editionIds.has(editionId))
    ) {
      throw new Error('A Work merge must move every Edition from the absorbed Work')
    }
  }

  return editions.map((edition) => {
    if (!editionIds.has(edition.id)) return edition
    if (edition.workId !== operation.fromWorkId) {
      throw new Error(
        `Edition ${edition.id} moved after this operation was prepared; review is required`,
      )
    }
    return { ...edition, workId: operation.toWorkId }
  })
}

/** Undo is compare-and-swap: it refuses to overwrite a later reassignment of an affected Edition. */
export function undoIdentityOperation(
  editions: readonly Edition[],
  input: IdentityOperation,
): readonly Edition[] {
  const operation = identityOperationSchema.parse(input)
  const editionIds = new Set(operation.editionIds)
  const availableIds = new Set(editions.map(({ id }) => id))
  operation.editionIds.forEach((editionId) => {
    if (!availableIds.has(editionId)) {
      throw new Error(`Edition ${editionId} is missing; undo cannot restore exact identity state`)
    }
  })

  return editions.map((edition) => {
    if (!editionIds.has(edition.id)) return edition
    if (edition.workId !== operation.toWorkId) {
      throw new Error(
        `Edition ${edition.id} changed after ${operation.id}; undo would overwrite later work`,
      )
    }
    return { ...edition, workId: operation.fromWorkId }
  })
}
