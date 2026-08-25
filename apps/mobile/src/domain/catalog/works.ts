import { z } from 'zod'
import { contributorIdSchema, personIdSchema, workIdSchema, workPartIdSchema } from './ids'
import { resolvedFieldSchema } from './metadata'
import {
  editionRefSchema,
  isoDateTimeSchema,
  languageTagSchema,
  workRefSchema,
} from './shared'

export const workKindSchema = z.enum(['single', 'anthology', 'collection'])

export const workSchema = z.object({
  id: workIdSchema,
  kind: workKindSchema,
  title: resolvedFieldSchema(z.string().min(1)),
  subtitle: resolvedFieldSchema(z.string().min(1).nullable()).optional(),
  description: resolvedFieldSchema(z.string().min(1).nullable()).optional(),
  originalLanguage: resolvedFieldSchema(languageTagSchema.nullable()).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export const personSchema = z.object({
  id: personIdSchema,
  displayName: resolvedFieldSchema(z.string().min(1)),
  sortName: resolvedFieldSchema(z.string().min(1).nullable()).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export const contributorRoleSchema = z.enum([
  'author',
  'editor',
  'translator',
  'narrator',
  'illustrator',
  'compiler',
  'foreword',
  'other',
])

export const contributionTargetSchema = z.discriminatedUnion('type', [
  workRefSchema,
  editionRefSchema,
])

export const contributorSchema = z.object({
  id: contributorIdSchema,
  personId: personIdSchema,
  target: contributionTargetSchema,
  role: contributorRoleSchema,
  creditedAs: z.string().min(1),
  position: z.number().int().nonnegative(),
})

export const workPartSchema = z
  .object({
    id: workPartIdSchema,
    containerWorkId: workIdSchema,
    workId: workIdSchema,
    position: z.number().int().nonnegative(),
    titleAsPublished: z.string().min(1).optional(),
  })
  .refine((part) => part.containerWorkId !== part.workId, {
    path: ['workId'],
    message: 'A Work cannot contain itself',
  })

export type WorkKind = z.infer<typeof workKindSchema>
export type Work = z.infer<typeof workSchema>
export type Person = z.infer<typeof personSchema>
export type ContributorRole = z.infer<typeof contributorRoleSchema>
export type Contributor = z.infer<typeof contributorSchema>
export type WorkPart = z.infer<typeof workPartSchema>
