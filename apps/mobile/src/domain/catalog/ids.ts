import { z } from 'zod'

function entityIdSchema<const Prefix extends string, const Brand extends string>(
  prefix: Prefix,
  _brand: Brand,
) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}:[^:]+(?:[:][^:]+)*$`), `Expected a ${prefix}-prefixed entity ID`)
    .brand<Brand>()
}

export const workIdSchema = entityIdSchema('work', 'WorkId')
export const editionIdSchema = entityIdSchema('edition', 'EditionId')
export const assetIdSchema = entityIdSchema('asset', 'AssetId')
export const identifierIdSchema = entityIdSchema('identifier', 'IdentifierId')
export const sourceRecordIdSchema = entityIdSchema('source-record', 'SourceRecordId')
export const sourceClaimIdSchema = entityIdSchema('source-claim', 'SourceClaimId')
export const ownershipIdSchema = entityIdSchema('ownership', 'OwnershipId')
export const accessGrantIdSchema = entityIdSchema('access', 'AccessGrantId')
export const loanIdSchema = entityIdSchema('loan', 'LoanId')
export const personIdSchema = entityIdSchema('person', 'PersonId')
export const contributorIdSchema = entityIdSchema('contributor', 'ContributorId')
export const workPartIdSchema = entityIdSchema('work-part', 'WorkPartId')
export const listIdSchema = entityIdSchema('list', 'ListId')
export const listEntryIdSchema = entityIdSchema('list-entry', 'ListEntryId')
export const metadataOverrideIdSchema = entityIdSchema('metadata-override', 'MetadataOverrideId')
export const progressSnapshotIdSchema = entityIdSchema('progress', 'ProgressSnapshotId')
export const readingEventIdSchema = entityIdSchema('reading-event', 'ReadingEventId')
export const readingSessionIdSchema = entityIdSchema('reading-session', 'ReadingSessionId')
export const readingDeviceIdSchema = entityIdSchema('reading-device', 'ReadingDeviceId')
export const integrationCheckpointIdSchema = entityIdSchema(
  'integration-checkpoint',
  'IntegrationCheckpointId',
)

export type WorkId = z.infer<typeof workIdSchema>
export type EditionId = z.infer<typeof editionIdSchema>
export type AssetId = z.infer<typeof assetIdSchema>
export type IdentifierId = z.infer<typeof identifierIdSchema>
export type SourceRecordId = z.infer<typeof sourceRecordIdSchema>
export type SourceClaimId = z.infer<typeof sourceClaimIdSchema>
export type OwnershipId = z.infer<typeof ownershipIdSchema>
export type AccessGrantId = z.infer<typeof accessGrantIdSchema>
export type LoanId = z.infer<typeof loanIdSchema>
export type PersonId = z.infer<typeof personIdSchema>
export type ContributorId = z.infer<typeof contributorIdSchema>
export type WorkPartId = z.infer<typeof workPartIdSchema>
export type ListId = z.infer<typeof listIdSchema>
export type ListEntryId = z.infer<typeof listEntryIdSchema>
export type MetadataOverrideId = z.infer<typeof metadataOverrideIdSchema>
export type ProgressSnapshotId = z.infer<typeof progressSnapshotIdSchema>
export type ReadingEventId = z.infer<typeof readingEventIdSchema>
export type ReadingSessionId = z.infer<typeof readingSessionIdSchema>
export type ReadingDeviceId = z.infer<typeof readingDeviceIdSchema>
export type IntegrationCheckpointId = z.infer<typeof integrationCheckpointIdSchema>
