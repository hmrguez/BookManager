import { z } from 'zod'
import { listEntryIdSchema, listIdSchema, workIdSchema } from './ids'
import { isoDateTimeSchema } from './shared'

export const listKindSchema = z.enum(['system', 'custom'])

export const listSchema = z.object({
  id: listIdSchema,
  kind: listKindSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export const listEntrySchema = z.object({
  id: listEntryIdSchema,
  listId: listIdSchema,
  workId: workIdSchema,
  position: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export type ListKind = z.infer<typeof listKindSchema>
export type List = z.infer<typeof listSchema>
export type ListEntry = z.infer<typeof listEntrySchema>
