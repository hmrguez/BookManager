import { z } from 'zod'
import { assetIdSchema, editionIdSchema, sourceRecordIdSchema, workIdSchema } from './ids'
import { resolvedFieldSchema } from './metadata'
import { isoDateTimeSchema, languageTagSchema } from './shared'

const editionBaseShape = {
  id: editionIdSchema,
  workId: workIdSchema,
  title: resolvedFieldSchema(z.string().min(1)),
  subtitle: resolvedFieldSchema(z.string().min(1).nullable()).optional(),
  language: resolvedFieldSchema(languageTagSchema),
  publisher: resolvedFieldSchema(z.string().min(1).nullable()).optional(),
  publicationDate: resolvedFieldSchema(z.string().min(4).nullable()).optional(),
  /** Covers belong to editions. Work-level covers are derived preferences. */
  coverAssetId: assetIdSchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}

export const printEditionSchema = z.object({
  ...editionBaseShape,
  medium: z.literal('print'),
  binding: z.enum(['hardcover', 'paperback', 'other']),
  pageCount: resolvedFieldSchema(z.number().int().positive()).optional(),
})

export const ebookEditionSchema = z.object({
  ...editionBaseShape,
  medium: z.literal('ebook'),
  pageCount: resolvedFieldSchema(z.number().int().positive()).optional(),
})

export const audiobookEditionSchema = z.object({
  ...editionBaseShape,
  medium: z.literal('audiobook'),
  durationMs: resolvedFieldSchema(z.number().int().positive()).optional(),
})

export const editionSchema = z.discriminatedUnion('medium', [
  printEditionSchema,
  ebookEditionSchema,
  audiobookEditionSchema,
])

export const assetRoleSchema = z.enum(['content', 'cover', 'supplement'])
export const assetFormatSchema = z.enum(['epub', 'pdf', 'm4b', 'mp3', 'image', 'other'])

const managedRelativePathSchema = z
  .string()
  .min(1)
  .refine((path) => !path.startsWith('/') && !path.split('/').includes('..'), {
    message: 'Managed file paths must be relative and cannot traverse parent directories',
  })

export const assetLocationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('managed-file'),
    relativePath: managedRelativePathSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteSize: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('managed-bundle'),
    relativePath: managedRelativePathSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    byteSize: z.number().int().nonnegative(),
    entryCount: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('linked-file'),
    bookmarkId: z.string().min(1),
    fingerprint: z.string().min(1),
    lastKnownName: z.string().min(1),
  }),
  z.object({
    kind: z.literal('remote'),
    uri: z.url(),
    sourceRecordId: sourceRecordIdSchema,
    expiresAt: isoDateTimeSchema.optional(),
  }),
  z.object({
    kind: z.literal('missing'),
    fingerprint: z.string().min(1).optional(),
    lastKnownName: z.string().min(1),
  }),
])

export const assetSchema = z.object({
  id: assetIdSchema,
  editionId: editionIdSchema,
  role: assetRoleSchema,
  format: assetFormatSchema,
  mediaType: z.string().min(1),
  location: assetLocationSchema,
  createdAt: isoDateTimeSchema,
})

export type PrintEdition = z.infer<typeof printEditionSchema>
export type EbookEdition = z.infer<typeof ebookEditionSchema>
export type AudiobookEdition = z.infer<typeof audiobookEditionSchema>
export type Edition = z.infer<typeof editionSchema>
export type AssetRole = z.infer<typeof assetRoleSchema>
export type AssetFormat = z.infer<typeof assetFormatSchema>
export type AssetLocation = z.infer<typeof assetLocationSchema>
export type Asset = z.infer<typeof assetSchema>
