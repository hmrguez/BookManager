import { z } from 'zod'
import { accessGrantSchema, loanSchema, ownershipSchema } from './access'
import { assetSchema, editionSchema } from './editions'
import { identifierSchema } from './identifiers'
import { listEntrySchema, listSchema } from './lists'
import { sourceRecordSchema, userMetadataOverrideValueSchema } from './metadata'
import { integrationCheckpointSchema, progressSnapshotSchema, readingEventSchema } from './progress'
import { contributorSchema, personSchema, workPartSchema, workSchema } from './works'

/** Structural catalog shape; cross-record invariants are composed in catalog.ts. */
export const catalogRecordsSchema = z.object({
  works: z.array(workSchema),
  editions: z.array(editionSchema),
  assets: z.array(assetSchema),
  identifiers: z.array(identifierSchema),
  sourceRecords: z.array(sourceRecordSchema),
  metadataOverrides: z.array(userMetadataOverrideValueSchema),
  ownerships: z.array(ownershipSchema),
  loans: z.array(loanSchema),
  accessGrants: z.array(accessGrantSchema),
  people: z.array(personSchema),
  contributors: z.array(contributorSchema),
  workParts: z.array(workPartSchema),
  lists: z.array(listSchema).default([]),
  listEntries: z.array(listEntrySchema).default([]),
  integrationCheckpoints: z.array(integrationCheckpointSchema),
  readingEvents: z.array(readingEventSchema),
  progressSnapshots: z.array(progressSnapshotSchema),
})

export type CatalogRecords = z.infer<typeof catalogRecordsSchema>
