import { t } from '../localization'
import { z } from 'zod'
import { shelfIdSchema } from '../library-model'

export const SMART_LIST_RULE_SCHEMA_VERSION = 1
export const SMART_LIST_POSITION_STEP = 1_024

export const smartListRuleFieldSchema = z.enum([
  'status',
  'format',
  'source',
  'tag',
  'author',
  'series',
  'dateAdded',
  'dateStarted',
  'dateFinished',
  'dateUpdated',
  'progress',
  'rating',
  'ownership',
  'loanDueAt',
  'availability',
  'durationMinutes',
])

export const smartListRuleOperatorSchema = z.enum([
  'is',
  'is-not',
  'contains',
  'not-contains',
  'at-least',
  'at-most',
  'greater-than',
  'less-than',
  'between',
  'before',
  'after',
  'within-next-days',
  'within-last-days',
  'older-than-days',
  'is-missing',
])

export const smartListSortFieldSchema = z.enum([
  'title',
  'author',
  'date-added',
  'date-updated',
  'progress',
  'rating',
  'loan-due',
  'duration',
])

export const smartListGroupFieldSchema = z.enum([
  'none',
  'status',
  'format',
  'author',
  'series',
  'source',
  'ownership',
  'availability',
])

export const smartListOwnershipSchema = z.enum([
  'owned',
  'borrowed',
  'subscription',
  'public-domain',
  'none',
])

export const smartListAvailabilitySchema = z.enum([
  'available',
  'expiring-soon',
  'expired',
  'unavailable',
])

export type SmartListRuleField = z.infer<typeof smartListRuleFieldSchema>
export type SmartListRuleOperator = z.infer<typeof smartListRuleOperatorSchema>
export type SmartListSortField = z.infer<typeof smartListSortFieldSchema>
export type SmartListGroupField = z.infer<typeof smartListGroupFieldSchema>
export type SmartListOwnership = z.infer<typeof smartListOwnershipSchema>
export type SmartListAvailability = z.infer<typeof smartListAvailabilitySchema>

export type SmartListCondition = {
  readonly id: string
  readonly kind: 'condition'
  readonly field: SmartListRuleField
  readonly operator: SmartListRuleOperator
  readonly value?: unknown
  readonly negate: boolean
}

export type SmartListRuleGroup = {
  readonly id: string
  readonly kind: 'group'
  readonly combinator: 'all' | 'any'
  readonly rules: readonly SmartListRule[]
  readonly negate: boolean
}

export type SmartListRule = SmartListCondition | SmartListRuleGroup

const smartListConditionSchema: z.ZodType<SmartListCondition> = z.object({
  id: z.string().min(1),
  kind: z.literal('condition'),
  field: smartListRuleFieldSchema,
  operator: smartListRuleOperatorSchema,
  value: z.unknown().optional(),
  negate: z.boolean().default(false),
})

export const smartListRuleSchema: z.ZodType<SmartListRule> = z.lazy(() =>
  z.union([smartListConditionSchema, smartListRuleGroupSchema]),
)

export const smartListRuleGroupSchema: z.ZodType<SmartListRuleGroup> = z.object({
  id: z.string().min(1),
  kind: z.literal('group'),
  combinator: z.enum(['all', 'any']),
  rules: z.array(smartListRuleSchema).min(1).max(50),
  negate: z.boolean().default(false),
})

const smartListSortSchema = z.object({
  field: smartListSortFieldSchema,
  direction: z.enum(['ascending', 'descending']),
})

export const smartListDefinitionSchema = z.object({
  schemaVersion: z.literal(SMART_LIST_RULE_SCHEMA_VERSION),
  root: smartListRuleGroupSchema,
  sort: smartListSortSchema,
  groupBy: smartListGroupFieldSchema,
}).superRefine((definition, context) => {
  const seenIds = new Set<string>()
  validateRule(definition.root, ['root'], context, seenIds, 0)
})

export const savedSmartListSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(1_000),
  pinned: z.boolean(),
  archived: z.boolean(),
  position: z.number().int().nonnegative(),
  definition: z.unknown(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export type SmartListDefinition = z.infer<typeof smartListDefinitionSchema>
export type SavedSmartList = z.infer<typeof savedSmartListSchema>

export type SmartListValidationIssue = {
  readonly path: string
  readonly message: string
}

export type SmartListTemplate = {
  readonly id: 'expiring-soon' | 'stalled' | 'short-audiobook' | 'unread-owned-epub' | 'libby-returns'
  readonly name: string
  readonly description: string
  readonly definition: SmartListDefinition
}

export const SMART_LIST_TEMPLATES: readonly SmartListTemplate[] = [
  {
    id: 'expiring-soon',
    get name() { return t("Expiring soon") },
    get description() { return t("Available loans due in the next seven days.") },
    definition: definition('expiring-soon', 'all', [
      condition('expiring-soon', 'availability', 'is', 'available'),
      condition('expiring-soon-due', 'loanDueAt', 'within-next-days', 7),
    ], 'loan-due', 'ascending', 'none'),
  },
  {
    id: 'stalled',
    get name() { return t("Stalled") },
    get description() { return t("In-progress books untouched for at least thirty days.") },
    definition: definition('stalled', 'all', [
      condition('stalled-status', 'status', 'is', 'reading'),
      condition('stalled-progress-start', 'progress', 'greater-than', 0),
      condition('stalled-progress-end', 'progress', 'less-than', 100),
      condition('stalled-date', 'dateUpdated', 'older-than-days', 30),
    ], 'date-updated', 'ascending', 'none'),
  },
  {
    id: 'short-audiobook',
    get name() { return t("Short audiobook") },
    get description() { return t("Audiobooks eight hours or shorter.") },
    definition: definition('short-audiobook', 'all', [
      condition('short-audiobook-format', 'format', 'is', 'audiobook'),
      condition('short-audiobook-duration', 'durationMinutes', 'at-most', 480),
    ], 'duration', 'ascending', 'none'),
  },
  {
    id: 'unread-owned-epub',
    get name() { return t("Unread owned EPUB") },
    get description() { return t("Owned EPUBs with no reading progress yet.") },
    definition: definition('unread-owned-epub', 'all', [
      condition('unread-owned-epub-format', 'format', 'is', 'epub'),
      condition('unread-owned-epub-ownership', 'ownership', 'is', 'owned'),
      condition('unread-owned-epub-progress', 'progress', 'is', 0),
    ], 'date-added', 'descending', 'none'),
  },
  {
    id: 'libby-returns',
    get name() { return t("Libby returns") },
    get description() { return t("Libby loans due in the next fourteen days.") },
    definition: definition('libby-returns', 'all', [
      condition('libby-returns-source', 'source', 'contains', 'Libby'),
      condition('libby-returns-due', 'loanDueAt', 'within-next-days', 14),
    ], 'loan-due', 'ascending', 'none'),
  },
]

export function createBlankSmartListDefinition(): SmartListDefinition {
  return definition('blank', 'all', [
    condition('blank-status', 'status', 'is', 'tbr'),
  ], 'title', 'ascending', 'none')
}

export function cloneSmartListDefinition(input: SmartListDefinition): SmartListDefinition {
  const cloneRule = (rule: SmartListRule): SmartListRule => rule.kind === 'condition'
    ? { ...rule, id: smartListId('rule') }
    : {
        ...rule,
        id: smartListId('group'),
        rules: rule.rules.map(cloneRule),
      }
  return smartListDefinitionSchema.parse({
    ...input,
    root: cloneRule(input.root),
  })
}

export function parseSmartListDefinition(input: unknown): {
  readonly definition?: SmartListDefinition
  readonly issues: readonly SmartListValidationIssue[]
} {
  const parsed = smartListDefinitionSchema.safeParse(input)
  if (parsed.success) return { definition: parsed.data, issues: [] }
  return {
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.length ? issue.path.join('.') : 'definition',
      message: issue.message,
    })),
  }
}

export function smartListId(kind: 'smart-list' | 'rule' | 'group'): string {
  return `${kind}:${crypto.randomUUID()}`
}

function definition(
  id: string,
  combinator: 'all' | 'any',
  rules: readonly SmartListRule[],
  sortField: SmartListSortField,
  direction: 'ascending' | 'descending',
  groupBy: SmartListGroupField,
): SmartListDefinition {
  return smartListDefinitionSchema.parse({
    schemaVersion: SMART_LIST_RULE_SCHEMA_VERSION,
    root: { id: `template:${id}:root`, kind: 'group', combinator, rules, negate: false },
    sort: { field: sortField, direction },
    groupBy,
  })
}

function condition(
  id: string,
  field: SmartListRuleField,
  operator: SmartListRuleOperator,
  value?: unknown,
): SmartListCondition {
  return { id: `template:${id}`, kind: 'condition', field, operator, value, negate: false }
}

function validateRule(
  rule: SmartListRule,
  path: readonly PropertyKey[],
  context: z.RefinementCtx,
  seenIds: Set<string>,
  depth: number,
): void {
  if (seenIds.has(rule.id)) {
    context.addIssue({ code: 'custom', path: [...path, 'id'], message: t("Duplicate rule ID {{v0}}", { v0: rule.id }) })
  }
  seenIds.add(rule.id)
  if (depth > 5) {
    context.addIssue({ code: 'custom', path: [...path], message: t("Rule groups can be nested at most five levels") })
    return
  }
  if (rule.kind === 'group') {
    rule.rules.forEach((child, index) => validateRule(
      child,
      [...path, 'rules', index],
      context,
      seenIds,
      depth + 1,
    ))
    return
  }

  const allowedOperators = operatorsForField(rule.field)
  if (!allowedOperators.includes(rule.operator)) {
    context.addIssue({
      code: 'custom',
      path: [...path, 'operator'],
      message: t("{{v0}} is not supported for {{v1}}", { v0: rule.operator, v1: rule.field }),
    })
    return
  }
  const valueSchema = valueSchemaFor(rule.field, rule.operator)
  const parsed = valueSchema.safeParse(rule.value)
  if (!parsed.success) {
    context.addIssue({
      code: 'custom',
      path: [...path, 'value'],
      message: parsed.error.issues[0]?.message ?? 'Invalid rule value',
    })
  }
}

export function operatorsForField(field: SmartListRuleField): readonly SmartListRuleOperator[] {
  if (['format', 'source', 'tag', 'author', 'series'].includes(field)) {
    return ['is', 'is-not', 'contains', 'not-contains']
  }
  if (['status', 'ownership', 'availability'].includes(field)) return ['is', 'is-not']
  if (['progress', 'rating', 'durationMinutes'].includes(field)) {
    return ['is', 'is-not', 'at-least', 'at-most', 'greater-than', 'less-than', 'between']
  }
  return [
    'before',
    'after',
    'within-next-days',
    'within-last-days',
    'older-than-days',
    'is-missing',
  ]
}

function valueSchemaFor(field: SmartListRuleField, operator: SmartListRuleOperator): z.ZodType {
  if (operator === 'is-missing') return z.undefined().or(z.null())
  if (operator === 'between') return z.tuple([z.number().finite(), z.number().finite()])
  if (['at-least', 'at-most', 'greater-than', 'less-than'].includes(operator)) {
    return z.number().finite()
  }
  if (['within-next-days', 'within-last-days', 'older-than-days'].includes(operator)) {
    return z.number().int().nonnegative().max(36_500)
  }
  if (['before', 'after'].includes(operator)) return z.iso.datetime({ offset: true })
  if (field === 'status') return shelfIdSchema
  if (field === 'ownership') return smartListOwnershipSchema
  if (field === 'availability') return smartListAvailabilitySchema
  if (['progress', 'rating', 'durationMinutes'].includes(field)) return z.number().finite()
  return z.string().trim().min(1).max(200)
}
