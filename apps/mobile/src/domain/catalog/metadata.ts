import { z } from 'zod'
import { metadataOverrideIdSchema, sourceClaimIdSchema, sourceRecordIdSchema } from './ids'
import { observedIdentifierSchema } from './identifiers'
import {
  isoDateTimeSchema,
  jsonValueSchema,
  metadataTargetSchema,
  sameTarget,
  type JsonValue,
} from './shared'

export const metadataFieldSchema = z.enum([
  'work.title',
  'work.subtitle',
  'work.description',
  'work.originalLanguage',
  'edition.title',
  'edition.subtitle',
  'edition.language',
  'edition.publisher',
  'edition.publicationDate',
  'edition.pageCount',
  'edition.durationMs',
  'person.displayName',
  'person.sortName',
])

export function sourceFieldCandidateSchema<ValueSchema extends z.ZodType>(valueSchema: ValueSchema) {
  return z.object({
    kind: z.literal('source'),
    target: metadataTargetSchema,
    field: metadataFieldSchema,
    value: valueSchema,
    sourceRecordId: sourceRecordIdSchema,
    claimId: sourceClaimIdSchema,
    observedAt: isoDateTimeSchema,
    confidence: z.number().min(0).max(1),
  })
}

export function localFieldCandidateSchema<ValueSchema extends z.ZodType>(valueSchema: ValueSchema) {
  return z.object({
    kind: z.literal('local'),
    target: metadataTargetSchema,
    field: metadataFieldSchema,
    value: valueSchema,
    recordedAt: isoDateTimeSchema,
    method: z.enum(['manual-entry', 'legacy-migration']),
  })
}

export function metadataCandidateSchema<ValueSchema extends z.ZodType>(valueSchema: ValueSchema) {
  return z.discriminatedUnion('kind', [
    sourceFieldCandidateSchema(valueSchema),
    localFieldCandidateSchema(valueSchema),
  ])
}

export function userMetadataOverrideSchema<ValueSchema extends z.ZodType>(valueSchema: ValueSchema) {
  return z.object({
    id: metadataOverrideIdSchema,
    target: metadataTargetSchema,
    field: metadataFieldSchema,
    /** Null is an explicit deletion when the field's value schema permits it. */
    value: valueSchema,
    correctedAt: isoDateTimeSchema,
    note: z.string().min(1).optional(),
  })
}

export function resolvedFieldSchema<ValueSchema extends z.ZodType>(valueSchema: ValueSchema) {
  return z.object({
    value: valueSchema,
    winner: z.enum(['candidate', 'user-override']),
    candidate: metadataCandidateSchema(valueSchema),
    userOverride: userMetadataOverrideSchema(valueSchema).optional(),
    resolvedAt: isoDateTimeSchema,
  })
}

export const metadataCandidateValueSchema = metadataCandidateSchema(jsonValueSchema)
export const userMetadataOverrideValueSchema = userMetadataOverrideSchema(jsonValueSchema)
export const resolvedMetadataValueSchema = resolvedFieldSchema(jsonValueSchema).superRefine(
  (resolved, context) => {
    const expectedWinner = resolved.userOverride ? 'user-override' : 'candidate'
    const expectedValue = resolved.userOverride?.value ?? resolved.candidate.value

    if (
      resolved.userOverride &&
      (resolved.userOverride.field !== resolved.candidate.field ||
        !sameTarget(resolved.userOverride.target, resolved.candidate.target))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['userOverride'],
        message: 'An override must target the same entity and field as its candidate',
      })
    }
    if (resolved.winner !== expectedWinner || !sameJson(resolved.value, expectedValue)) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'A user override must win when present; otherwise the candidate must win',
      })
    }
  },
)

export const sourceClaimSchema = z.object({
  id: sourceClaimIdSchema,
  target: metadataTargetSchema,
  field: metadataFieldSchema,
  value: jsonValueSchema,
  observedAt: isoDateTimeSchema,
  confidence: z.number().min(0).max(1),
})

export const sourceRecordSchema = z.object({
  id: sourceRecordIdSchema,
  source: z.object({
    kind: z.enum(['metadata-provider', 'file-import', 'reader', 'migration', 'manual-capture']),
    name: z.string().min(1),
  }),
  /** Source-local identity is deliberately separate from canonical identifiers. */
  externalKey: z.string().min(1),
  observedAt: isoDateTimeSchema,
  importedAt: isoDateTimeSchema,
  claims: z.array(sourceClaimSchema),
  observedIdentifiers: z.array(observedIdentifierSchema),
  rawPayload: jsonValueSchema.optional(),
})

export type MetadataField = z.infer<typeof metadataFieldSchema>
export type MetadataCandidate = z.infer<typeof metadataCandidateValueSchema>
export type UserMetadataOverride = z.infer<typeof userMetadataOverrideValueSchema>
export type ResolvedMetadataValue = z.infer<typeof resolvedMetadataValueSchema>
export type SourceClaim = z.infer<typeof sourceClaimSchema>
export type SourceRecord = z.infer<typeof sourceRecordSchema>

export function resolveMetadataField(
  candidate: MetadataCandidate,
  userOverride?: UserMetadataOverride,
): ResolvedMetadataValue {
  return resolvedMetadataValueSchema.parse({
    value: userOverride?.value ?? candidate.value,
    winner: userOverride ? 'user-override' : 'candidate',
    candidate,
    userOverride,
    resolvedAt:
      userOverride?.correctedAt ??
      (candidate.kind === 'source' ? candidate.observedAt : candidate.recordedAt),
  })
}

function sameJson(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
