import { z } from 'zod'
import { validateCatalogInvariants } from './invariants'
import { catalogRecordsSchema } from './records'

export const catalogSchema = catalogRecordsSchema.superRefine((catalog, context) => {
  validateCatalogInvariants(catalog, (path, message) => {
    context.addIssue({ code: 'custom', path: [...path], message })
  })
})

export type Catalog = z.infer<typeof catalogSchema>
