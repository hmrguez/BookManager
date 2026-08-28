import { z } from 'zod'
import { isoDateTimeSchema, jsonValueSchema, type JsonValue } from './shared'

export const conflictDomainSchema = z.enum([
  'work-identity',
  'metadata',
  'list-placement',
  'progress',
  'finish-state',
  'deletion',
])

export const evidenceClassSchema = z.enum([
  'authoritative',
  'observed',
  'inferred',
  'user-corrected',
])

/**
 * Sources planned for the first adapter wave plus Wovenleaf's local capture and readers.
 * Adding an adapter requires at least one explicit precedence rule and an ADR example.
 */
export const sourceAdapterSchema = z.enum([
  'local-manual',
  'legacy-migration',
  'isbn-scan',
  'embedded-file',
  'wovenleaf-epub-reader',
  'wovenleaf-audio-player',
  'google-books',
  'open-library',
  'libby-timeline',
  'libby-tags',
  'libby-web-capture',
  'overdrive-api',
  'audiobookshelf',
  'opds',
  'calibre-catalog',
  'readwise',
  'goodreads-csv',
  'storygraph-csv',
  'koreader',
  'calibre-statistics',
  'hardcover',
  'bookwyrm',
])

export const conflictSubjectSchema = z.object({
  type: z.enum(['work', 'edition', 'list-entry', 'reading-state', 'catalog-record']),
  id: z.string().min(1),
})

export const conflictCandidateSchema = z.object({
  id: z.string().regex(/^conflict-candidate:[^\s]+$/),
  subject: conflictSubjectSchema,
  field: z.string().min(1),
  value: jsonValueSchema,
  source: sourceAdapterSchema,
  evidence: evidenceClassSchema,
  observedAt: isoDateTimeSchema,
  effectiveAt: isoDateTimeSchema.optional(),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1),
})

export const durableChoiceSchema = z.object({
  id: z.string().regex(/^durable-choice:[^\s]+$/),
  subject: conflictSubjectSchema,
  field: z.string().min(1),
  value: jsonValueSchema,
  chosenCandidateId: conflictCandidateSchema.shape.id.optional(),
  decidedAt: isoDateTimeSchema,
  note: z.string().min(1).optional(),
})

export const precedenceRuleSchema = z.object({
  domain: conflictDomainSchema,
  field: z.string().min(1),
  source: sourceAdapterSchema,
  evidence: evidenceClassSchema,
  priority: z.number().int().min(0).max(100),
  automatic: z.boolean(),
  rationale: z.string().min(1),
})

export const conflictItemSchema = z
  .object({
    id: z.string().regex(/^conflict:[^\s]+$/),
    domain: conflictDomainSchema,
    subject: conflictSubjectSchema,
    field: z.string().min(1),
    candidates: z.array(conflictCandidateSchema).min(2),
    reason: z.string().min(1),
  })
  .superRefine((item, context) => {
    const candidateIds = new Set<string>()
    item.candidates.forEach((candidate, index) => {
      if (candidateIds.has(candidate.id)) {
        context.addIssue({
          code: 'custom',
          path: ['candidates', index, 'id'],
          message: `Duplicate conflict candidate ID ${candidate.id}`,
        })
      }
      candidateIds.add(candidate.id)
      if (!sameSubject(candidate.subject, item.subject) || candidate.field !== item.field) {
        context.addIssue({
          code: 'custom',
          path: ['candidates', index],
          message: 'Every candidate must target the conflict subject and exact field',
        })
      }
    })
  })

export type ConflictDomain = z.infer<typeof conflictDomainSchema>
export type EvidenceClass = z.infer<typeof evidenceClassSchema>
export type SourceAdapter = z.infer<typeof sourceAdapterSchema>
export type ConflictSubject = z.infer<typeof conflictSubjectSchema>
export type ConflictCandidate = z.infer<typeof conflictCandidateSchema>
export type ConflictItem = z.infer<typeof conflictItemSchema>
export type DurableChoice = z.infer<typeof durableChoiceSchema>
export type PrecedenceRule = z.infer<typeof precedenceRuleSchema>

export type ConflictResolution =
  | {
      readonly status: 'resolved'
      readonly basis: 'durable-choice' | 'agreement' | 'precedence-rule'
      readonly value: JsonValue
      readonly selectedCandidateId?: string
      readonly explanation: string
    }
  | {
      readonly status: 'review'
      readonly basis: 'ambiguous' | 'manual-review-required'
      readonly recommendedCandidateId?: string
      readonly explanation: string
    }

/**
 * Priorities compare trust for one domain and field only. They are not global source rankings.
 * observedAt/effectiveAt are intentionally absent: recency orders events within a source ledger,
 * but it never promotes one source above another.
 */
export const DEFAULT_PRECEDENCE_RULES: readonly PrecedenceRule[] = precedenceRuleSchema.array().parse([
  {
    domain: 'metadata', field: '*', source: 'local-manual', evidence: 'user-corrected', priority: 100, automatic: true,
    rationale: 'An explicit local correction is authoritative for the exact field the reader changed.',
  },
  {
    domain: 'list-placement', field: '*', source: 'local-manual', evidence: 'user-corrected', priority: 100, automatic: true,
    rationale: 'A local list action expresses current intent and does not grant ownership of other fields.',
  },
  {
    domain: 'finish-state', field: '*', source: 'local-manual', evidence: 'user-corrected', priority: 100, automatic: true,
    rationale: 'Explicit finish, DNF, and correction actions are durable reading-history decisions.',
  },
  {
    domain: 'progress', field: 'reading-state.*', source: 'local-manual', evidence: 'user-corrected', priority: 100, automatic: true,
    rationale: 'An explicit reader-entered position is a durable correction for that Edition.',
  },
  {
    domain: 'deletion', field: '*', source: 'local-manual', evidence: 'user-corrected', priority: 100, automatic: true,
    rationale: 'Only an explicit local delete is automatically destructive; remote absence is not deletion.',
  },
  {
    domain: 'metadata', field: '*', source: 'legacy-migration', evidence: 'observed', priority: 45, automatic: true,
    rationale: 'Legacy values remain useful seeds but yield to direct evidence or a correction.',
  },
  {
    domain: 'work-identity', field: 'edition.workId', source: 'isbn-scan', evidence: 'observed', priority: 85, automatic: false,
    rationale: 'A scanned ISBN is strong Edition evidence, but cannot by itself prove Work equivalence.',
  },
  {
    domain: 'metadata', field: 'edition.*', source: 'embedded-file', evidence: 'authoritative', priority: 82, automatic: true,
    rationale: 'Embedded publication metadata is preferred for the imported Edition, not the conceptual Work.',
  },
  {
    domain: 'progress', field: 'reading-state.*', source: 'wovenleaf-epub-reader', evidence: 'authoritative', priority: 95, automatic: true,
    rationale: 'The first-party EPUB reader owns locations it directly emitted for its Edition and Asset.',
  },
  {
    domain: 'finish-state', field: 'reading-state.status', source: 'wovenleaf-epub-reader', evidence: 'authoritative', priority: 95, automatic: false,
    rationale: 'Reaching an EPUB boundary proposes completion; explicit finish semantics remain reviewable.',
  },
  {
    domain: 'progress', field: 'reading-state.*', source: 'wovenleaf-audio-player', evidence: 'authoritative', priority: 95, automatic: true,
    rationale: 'The first-party player owns playback locations it directly emitted for its audio Asset.',
  },
  {
    domain: 'finish-state', field: 'reading-state.status', source: 'wovenleaf-audio-player', evidence: 'authoritative', priority: 95, automatic: false,
    rationale: 'Playback completion is strong evidence, but ending credits and manual seeking can mislead.',
  },
  {
    domain: 'metadata', field: '*', source: 'google-books', evidence: 'observed', priority: 60, automatic: false,
    rationale: 'Google Books is a useful provider observation, never a canonical last writer.',
  },
  {
    domain: 'metadata', field: '*', source: 'open-library', evidence: 'observed', priority: 60, automatic: false,
    rationale: 'Open Library is peer provider evidence; disagreement with another provider waits for review.',
  },
  {
    domain: 'finish-state', field: 'reading-state.status', source: 'libby-timeline', evidence: 'inferred', priority: 25, automatic: false,
    rationale: 'Borrow and return history never proves that a reader finished a title.',
  },
  {
    domain: 'list-placement', field: 'list-entry.*', source: 'libby-tags', evidence: 'observed', priority: 65, automatic: false,
    rationale: 'A tag export manages only mapped membership; later absence cannot delete local placement silently.',
  },
  {
    domain: 'progress', field: 'reading-state.*', source: 'libby-web-capture', evidence: 'observed', priority: 50, automatic: false,
    rationale: 'Visible Libby Web progress is lower-confidence coverage and reconciles instead of overwriting.',
  },
  {
    domain: 'work-identity', field: 'edition.workId', source: 'overdrive-api', evidence: 'observed', priority: 72, automatic: false,
    rationale: 'Approved API identifiers are strong source-local evidence but do not become canonical Work IDs.',
  },
  {
    domain: 'progress', field: 'reading-state.*', source: 'audiobookshelf', evidence: 'observed', priority: 80, automatic: false,
    rationale: 'Server progress is high-value evidence, but offline first-party playback may be ahead.',
  },
  {
    domain: 'metadata', field: 'edition.*', source: 'opds', evidence: 'observed', priority: 65, automatic: false,
    rationale: 'OPDS describes a catalog acquisition; imported bytes still pass normal Edition matching.',
  },
  {
    domain: 'metadata', field: 'edition.*', source: 'calibre-catalog', evidence: 'observed', priority: 68, automatic: false,
    rationale: 'Calibre metadata is useful Edition evidence but can contain user-maintained custom values.',
  },
  {
    domain: 'deletion', field: 'catalog-record.deleted', source: 'readwise', evidence: 'observed', priority: 70, automatic: false,
    rationale: 'A Readwise tombstone proposes removal only inside source-managed annotation scope.',
  },
  {
    domain: 'finish-state', field: 'reading-state.status', source: 'goodreads-csv', evidence: 'observed', priority: 65, automatic: false,
    rationale: 'A migration row preserves historical status but does not erase later local reading events.',
  },
  {
    domain: 'finish-state', field: 'reading-state.status', source: 'storygraph-csv', evidence: 'observed', priority: 65, automatic: false,
    rationale: 'A migration row preserves source status and rereads without taking over future state.',
  },
  {
    domain: 'progress', field: 'reading-state.*', source: 'koreader', evidence: 'observed', priority: 75, automatic: false,
    rationale: 'KOReader sidecars are direct observations with version and Edition matching uncertainty.',
  },
  {
    domain: 'progress', field: 'reading-state.*', source: 'calibre-statistics', evidence: 'inferred', priority: 45, automatic: false,
    rationale: 'Calibre statistics are imported read-only and remain inferred unless their schema proves otherwise.',
  },
  {
    domain: 'metadata', field: '*', source: 'hardcover', evidence: 'observed', priority: 55, automatic: false,
    rationale: 'Optional community APIs remain removable metadata observations.',
  },
  {
    domain: 'metadata', field: '*', source: 'bookwyrm', evidence: 'observed', priority: 55, automatic: false,
    rationale: 'Instance data is source-local evidence and cannot silently replace canonical metadata.',
  },
])

export function evaluateConflict(
  input: ConflictItem,
  durableChoice?: DurableChoice,
  rules: readonly PrecedenceRule[] = DEFAULT_PRECEDENCE_RULES,
): ConflictResolution {
  const item = conflictItemSchema.parse(input)

  if (durableChoice && choiceAppliesTo(durableChoice, item.subject, item.field)) {
    return {
      status: 'resolved',
      basis: 'durable-choice',
      value: durableChoice.value,
      selectedCandidateId: durableChoice.chosenCandidateId,
      explanation: 'The reader’s durable choice wins for this exact subject and field.',
    }
  }

  const valueGroups = groupCandidatesByValue(item.candidates)
  if (valueGroups.length === 1) {
    const selected = rankedCandidates(item, valueGroups[0]!, rules)[0]
    return {
      status: 'resolved',
      basis: 'agreement',
      value: valueGroups[0]![0]!.value,
      selectedCandidateId: selected?.candidate.id,
      explanation: 'Independent candidates agree on the same value; all evidence remains attached.',
    }
  }

  const rankedGroups = valueGroups
    .map((candidates) => ({ candidates, ranked: rankedCandidates(item, candidates, rules) }))
    .sort((left, right) => {
      const priorityDifference = (right.ranked[0]?.priority ?? -1) - (left.ranked[0]?.priority ?? -1)
      if (priorityDifference !== 0) return priorityDifference
      return left.ranked[0]!.candidate.id.localeCompare(right.ranked[0]!.candidate.id)
    })

  const best = rankedGroups[0]?.ranked[0]
  const next = rankedGroups[1]?.ranked[0]
  if (best?.rule?.automatic && best.priority > (next?.priority ?? -1)) {
    return {
      status: 'resolved',
      basis: 'precedence-rule',
      value: best.candidate.value,
      selectedCandidateId: best.candidate.id,
      explanation: best.rule.rationale,
    }
  }

  const tied = best && next && best.priority === next.priority
  return {
    status: 'review',
    basis: tied ? 'ambiguous' : 'manual-review-required',
    recommendedCandidateId: best?.candidate.id,
    explanation: tied
      ? 'The strongest conflicting values have equal field-level trust.'
      : best?.rule?.rationale ?? 'No automatic rule is allowed to choose between these values.',
  }
}

export function createDurableChoice(
  item: ConflictItem,
  candidateId: string,
  details: Pick<DurableChoice, 'id' | 'decidedAt' | 'note'>,
): DurableChoice {
  const parsedItem = conflictItemSchema.parse(item)
  const candidate = parsedItem.candidates.find(({ id }) => id === candidateId)
  if (!candidate) throw new Error(`Missing candidate ${candidateId} in conflict ${item.id}`)

  return durableChoiceSchema.parse({
    ...details,
    subject: parsedItem.subject,
    field: parsedItem.field,
    value: candidate.value,
    chosenCandidateId: candidate.id,
  })
}

export function choiceAppliesTo(
  choice: DurableChoice,
  subject: ConflictSubject,
  field: string,
): boolean {
  return sameSubject(choice.subject, subject) && choice.field === field
}

function rankedCandidates(
  item: ConflictItem,
  candidates: readonly ConflictCandidate[],
  rules: readonly PrecedenceRule[],
) {
  return candidates
    .map((candidate) => {
      const matchingRules = rules.filter((rule) =>
        rule.domain === item.domain &&
        rule.source === candidate.source &&
        rule.evidence === candidate.evidence &&
        fieldPatternMatches(rule.field, item.field),
      )
      const rule = matchingRules.sort((left, right) => {
        const specificityDifference = fieldSpecificity(right.field) - fieldSpecificity(left.field)
        return specificityDifference || right.priority - left.priority
      })[0]
      return { candidate, rule, priority: rule?.priority ?? -1 }
    })
    .sort((left, right) =>
      right.priority - left.priority || left.candidate.id.localeCompare(right.candidate.id),
    )
}

function fieldPatternMatches(pattern: string, field: string): boolean {
  if (pattern === '*') return true
  if (pattern.endsWith('.*')) return field.startsWith(pattern.slice(0, -1))
  return pattern === field
}

function fieldSpecificity(pattern: string): number {
  if (pattern === '*') return 0
  return pattern.endsWith('.*') ? 1 : 2
}

function groupCandidatesByValue(candidates: readonly ConflictCandidate[]) {
  const groups = new Map<string, ConflictCandidate[]>()
  candidates.forEach((candidate) => {
    const key = stableJson(candidate.value)
    const group = groups.get(key) ?? []
    group.push(candidate)
    groups.set(key, group)
  })
  return [...groups.values()]
}

function stableJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sameSubject(left: ConflictSubject, right: ConflictSubject): boolean {
  return left.type === right.type && left.id === right.id
}
