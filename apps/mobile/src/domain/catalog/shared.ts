import { z } from 'zod'
import { editionIdSchema, personIdSchema, workIdSchema } from './ids'

export const isoDateTimeSchema = z.iso.datetime({ offset: true })
export const languageTagSchema = z
  .string()
  .min(2)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/, 'Expected a BCP 47 language tag')
export const jsonValueSchema = z.json()

export const workRefSchema = z.object({ type: z.literal('work'), id: workIdSchema })
export const editionRefSchema = z.object({ type: z.literal('edition'), id: editionIdSchema })
export const personRefSchema = z.object({ type: z.literal('person'), id: personIdSchema })
export const metadataTargetSchema = z.discriminatedUnion('type', [
  workRefSchema,
  editionRefSchema,
  personRefSchema,
])

export type IsoDateTime = z.infer<typeof isoDateTimeSchema>
export type LanguageTag = z.infer<typeof languageTagSchema>
export type JsonValue = z.infer<typeof jsonValueSchema>
export type WorkRef = z.infer<typeof workRefSchema>
export type EditionRef = z.infer<typeof editionRefSchema>
export type PersonRef = z.infer<typeof personRefSchema>
export type MetadataTarget = z.infer<typeof metadataTargetSchema>

export function sameTarget(left: MetadataTarget, right: MetadataTarget): boolean {
  return left.type === right.type && left.id === right.id
}
