import { z } from 'zod'
import {
  accessGrantIdSchema,
  editionIdSchema,
  loanIdSchema,
  ownershipIdSchema,
  sourceRecordIdSchema,
} from './ids'
import { isoDateTimeSchema } from './shared'

export const ownershipSchema = z
  .object({
    id: ownershipIdSchema,
    editionId: editionIdSchema,
    copyKind: z.enum(['physical', 'licensed-digital', 'drm-free-digital']),
    acquisition: z.enum(['purchase', 'gift', 'manual', 'import']),
    acquiredAt: isoDateTimeSchema,
    disposedAt: isoDateTimeSchema.optional(),
    sourceRecordId: sourceRecordIdSchema.optional(),
  })
  .refine(
    (ownership) =>
      !ownership.disposedAt || Date.parse(ownership.disposedAt) >= Date.parse(ownership.acquiredAt),
    { path: ['disposedAt'], message: 'An ownership cannot end before it begins' },
  )

export const loanSchema = z
  .object({
    id: loanIdSchema,
    editionId: editionIdSchema,
    lenderName: z.string().min(1),
    borrowedAt: isoDateTimeSchema,
    /** Exclusive upper bound: the loan is expired at this instant. */
    dueAt: isoDateTimeSchema,
    returnedAt: isoDateTimeSchema.optional(),
    renewalCount: z.number().int().nonnegative(),
    sourceRecordId: sourceRecordIdSchema.optional(),
  })
  .superRefine((loan, context) => {
    if (Date.parse(loan.dueAt) <= Date.parse(loan.borrowedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['dueAt'],
        message: 'A loan must be due after it is borrowed',
      })
    }
    if (loan.returnedAt && Date.parse(loan.returnedAt) < Date.parse(loan.borrowedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['returnedAt'],
        message: 'A loan cannot be returned before it is borrowed',
      })
    }
  })

const accessGrantBaseShape = {
  id: accessGrantIdSchema,
  editionId: editionIdSchema,
  createdAt: isoDateTimeSchema,
}

export const accessGrantSchema = z.discriminatedUnion('basis', [
  z.object({
    ...accessGrantBaseShape,
    basis: z.literal('ownership'),
    ownershipId: ownershipIdSchema,
  }),
  z.object({
    ...accessGrantBaseShape,
    basis: z.literal('loan'),
    loanId: loanIdSchema,
  }),
  z
    .object({
      ...accessGrantBaseShape,
      basis: z.literal('subscription'),
      sourceRecordId: sourceRecordIdSchema,
      startsAt: isoDateTimeSchema,
      endsAt: isoDateTimeSchema.optional(),
    })
    .refine(
      (grant) => !grant.endsAt || Date.parse(grant.endsAt) > Date.parse(grant.startsAt),
      { path: ['endsAt'], message: 'Subscription access must end after it begins' },
    ),
  z.object({
    ...accessGrantBaseShape,
    basis: z.literal('public-domain'),
  }),
])

export type Ownership = z.infer<typeof ownershipSchema>
export type Loan = z.infer<typeof loanSchema>
export type AccessGrant = z.infer<typeof accessGrantSchema>
