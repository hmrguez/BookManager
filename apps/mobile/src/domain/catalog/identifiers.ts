import { z } from 'zod'
import { identifierIdSchema, sourceRecordIdSchema } from './ids'
import { editionRefSchema, isoDateTimeSchema, workRefSchema } from './shared'

export const identifierSchemeSchema = z.enum([
  'isbn-10',
  'isbn-13',
  'asin',
  'doi',
  'lccn',
  'oclc',
  'custom',
])

export const identifierOwnerSchema = z.discriminatedUnion('type', [workRefSchema, editionRefSchema])

export const observedIdentifierSchema = z
  .object({
    target: identifierOwnerSchema.optional(),
    scheme: identifierSchemeSchema,
    value: z.string().min(1),
    normalizedValue: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .superRefine(validateNormalizedIdentifier)

export const identifierSchema = z
  .object({
    id: identifierIdSchema,
    owner: identifierOwnerSchema,
    scheme: identifierSchemeSchema,
    value: z.string().min(1),
    normalizedValue: z.string().min(1),
    sourceRecordIds: z.array(sourceRecordIdSchema),
    createdAt: isoDateTimeSchema,
  })
  .superRefine((identifier, context) => {
    validateNormalizedIdentifier(identifier, context)
    if (identifier.scheme.startsWith('isbn-') && identifier.owner.type !== 'edition') {
      context.addIssue({
        code: 'custom',
        path: ['owner'],
        message: 'An ISBN identifies an Edition, never a Work',
      })
    }
  })

export type IdentifierScheme = z.infer<typeof identifierSchemeSchema>
export type IdentifierOwner = z.infer<typeof identifierOwnerSchema>
export type ObservedIdentifier = z.infer<typeof observedIdentifierSchema>
export type Identifier = z.infer<typeof identifierSchema>

function validateNormalizedIdentifier(
  identifier: { readonly scheme: IdentifierScheme; readonly normalizedValue: string },
  context: z.RefinementCtx,
) {
  const isValidIsbn10 = /^\d{9}[\dX]$/.test(identifier.normalizedValue)
  const isValidIsbn13 = /^\d{13}$/.test(identifier.normalizedValue)
  if (identifier.scheme === 'isbn-10' && !isValidIsbn10) {
    context.addIssue({
      code: 'custom',
      path: ['normalizedValue'],
      message: 'A normalized ISBN-10 must contain nine digits followed by a digit or X',
    })
  }
  if (identifier.scheme === 'isbn-13' && !isValidIsbn13) {
    context.addIssue({
      code: 'custom',
      path: ['normalizedValue'],
      message: 'A normalized ISBN-13 must contain thirteen digits',
    })
  }
}
