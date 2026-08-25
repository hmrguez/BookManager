import { z } from 'zod'
import {
  assetIdSchema,
  editionIdSchema,
  progressSnapshotIdSchema,
  sourceRecordIdSchema,
} from './ids'
import { isoDateTimeSchema } from './shared'

export const progressLocatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), page: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('epub'), locator: z.string().min(1) }),
  z.object({ kind: z.literal('audio-time'), positionMs: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('percent'), fraction: z.number().min(0).max(1) }),
])

/**
 * QUI-16 owns the authoritative event/session ledger. This is its
 * edition-scoped read-model boundary, included here to prove format isolation.
 */
export const progressSnapshotSchema = z.object({
  id: progressSnapshotIdSchema,
  editionId: editionIdSchema,
  assetId: assetIdSchema.optional(),
  locator: progressLocatorSchema,
  normalizedProgress: z.number().min(0).max(1),
  recordedAt: isoDateTimeSchema,
  sourceRecordId: sourceRecordIdSchema.optional(),
})

export type ProgressLocator = z.infer<typeof progressLocatorSchema>
export type ProgressSnapshot = z.infer<typeof progressSnapshotSchema>
