import { translateAt, translateCopy, getLocale } from '../localization'
import { accessStateAt, type Catalog } from '../domain/catalog'
import type { LibraryBook, ShelfId } from '../library-model'
import type { LibraryOrganization } from '../organization-model'
import {
  parseSmartListDefinition,
  type SmartListAvailability,
  type SmartListCondition,
  type SmartListDefinition,
  type SmartListGroupField,
  type SmartListOwnership,
  type SmartListRule,
  type SmartListRuleField,
  type SmartListValidationIssue,
} from './model'

export type SmartListDocument = {
  readonly id: string
  readonly title: string
  readonly authors: readonly string[]
  readonly series: readonly string[]
  readonly formats: readonly string[]
  readonly sources: readonly string[]
  readonly tags: readonly string[]
  readonly status: ShelfId
  readonly dateAdded: string
  readonly dateStarted?: string
  readonly dateFinished?: string
  readonly dateUpdated: string
  readonly progress: number
  readonly rating: number
  readonly ownerships: readonly SmartListOwnership[]
  readonly loanDueAt?: string
  readonly availability: SmartListAvailability
  readonly durationMinutes?: number
}

export type SmartListResultItem = {
  readonly document: SmartListDocument
  readonly reasons: readonly string[]
}

export type SmartListResultGroup = {
  readonly key: string
  readonly label: string
  readonly items: readonly SmartListResultItem[]
}

export type SmartListQuerySuccess = {
  readonly ok: true
  readonly definition: SmartListDefinition
  readonly explanation: string
  readonly items: readonly SmartListResultItem[]
  readonly groups: readonly SmartListResultGroup[]
  readonly durationMs: number
}

export type SmartListQueryFailure = {
  readonly ok: false
  readonly issues: readonly SmartListValidationIssue[]
  readonly rawDefinition: unknown
  readonly durationMs: number
}

export type SmartListQueryResult = SmartListQuerySuccess | SmartListQueryFailure

export function createSmartListDocuments(
  books: readonly LibraryBook[],
  organization: LibraryOrganization,
  catalog?: Catalog,
  now = new Date().toISOString(),
): SmartListDocument[] {
  const tagById = new Map(organization.tags.map((tag) => [tag.id, tag.name]))
  const tagsByBookId = new Map<string, string[]>()
  for (const bookTag of organization.bookTags) {
    const name = tagById.get(bookTag.tagId)
    if (name) tagsByBookId.set(bookTag.bookId, [...(tagsByBookId.get(bookTag.bookId) ?? []), name])
  }
  const catalogIndex = catalog ? createCatalogIndex(catalog) : undefined

  return books.map((book) => {
    const enrichment = catalogIndex?.forBook(book, now)
    return {
      id: book.id,
      title: book.title,
      authors: uniqueText([...book.authors, ...(enrichment?.authors ?? [])]),
      series: uniqueText(book.series ?? []),
      formats: uniqueText([book.format, ...(enrichment?.formats ?? [])]),
      sources: uniqueText([...(book.sourceNames ?? []), ...(enrichment?.sources ?? [])]),
      tags: uniqueText([...(book.tags ?? []), ...(tagsByBookId.get(book.id) ?? [])]),
      status: book.shelf,
      dateAdded: book.addedAt,
      dateStarted: book.startedAt,
      dateFinished: book.finishedAt,
      dateUpdated: book.lastUpdatedAt,
      progress: book.progress,
      rating: book.rating,
      ownerships: enrichment?.ownerships ?? ['none'],
      loanDueAt: enrichment?.loanDueAt,
      availability: enrichment?.availability ?? 'unavailable',
      durationMinutes: enrichment?.durationMinutes,
    }
  })
}

export function querySmartList(
  rawDefinition: unknown,
  documents: readonly SmartListDocument[],
  options: { readonly now?: string; readonly locale?: string } = {},
): SmartListQueryResult {
  const startedAt = performance.now()
  const parsed = parseSmartListDefinition(rawDefinition)
  if (!parsed.definition) {
    return {
      ok: false,
      issues: parsed.issues,
      rawDefinition,
      durationMs: performance.now() - startedAt,
    }
  }
  const now = options.now ?? new Date().toISOString()
  const descriptions = describeRules(parsed.definition.root, options.locale ?? getLocale())
  const fixedReasons = staticReasonsForRule(parsed.definition.root, descriptions)
  const matchedItems = documents.flatMap((document): SmartListResultItem[] => {
    const root = parsed.definition!.root
    return matchesRule(root, document, now)
      ? [{ document, reasons: fixedReasons ?? reasonsForRule(root, document, now, descriptions) }]
      : []
  })
  const items = sortResults(matchedItems, parsed.definition)
  return {
    ok: true,
    definition: parsed.definition,
    explanation: explainSmartListDefinition(parsed.definition, options.locale ?? getLocale()),
    items,
    groups: groupResults(items, parsed.definition.groupBy),
    durationMs: performance.now() - startedAt,
  }
}

export function explainSmartListDefinition(definition: SmartListDefinition, locale = getLocale()): string {
  return describeRule(definition.root, true, locale)
}

export function describeSmartListCondition(condition: SmartListCondition, locale = getLocale()): string {
  const field = translateCopy(FIELD_LABELS[condition.field], locale)
  const operator = translateCopy(OPERATOR_LABELS[condition.operator], locale)
  const value = formatRuleValue(condition.field, condition.value, locale)
  const statement = condition.operator === 'is-missing'
    ? `${field} ${operator}`
    : `${field} ${operator} ${value}`
  return condition.negate ? translateAt("Not: {{statement}}", locale, { statement }) : statement
}

function matchesRule(rule: SmartListRule, document: SmartListDocument, now: string): boolean {
  if (rule.kind === 'condition') {
    const matchesCondition = evaluateCondition(rule, document, now)
    return rule.negate ? !matchesCondition : matchesCondition
  }
  const groupMatches = rule.combinator === 'all'
    ? rule.rules.every((child) => matchesRule(child, document, now))
    : rule.rules.some((child) => matchesRule(child, document, now))
  return rule.negate ? !groupMatches : groupMatches
}

function reasonsForRule(
  rule: SmartListRule,
  document: SmartListDocument,
  now: string,
  descriptions: ReadonlyMap<string, string>,
): string[] {
  if (rule.kind === 'condition' || rule.negate) return [descriptions.get(rule.id) ?? describeRule(rule, false)]
  const relevant = rule.combinator === 'all'
    ? rule.rules
    : rule.rules.filter((child) => matchesRule(child, document, now))
  return relevant.flatMap((child) => reasonsForRule(child, document, now, descriptions))
}

function describeRules(root: SmartListRule, locale = getLocale()): ReadonlyMap<string, string> {
  const descriptions = new Map<string, string>()
  const visit = (rule: SmartListRule) => {
    descriptions.set(rule.id, rule.kind === 'condition'
      ? describeSmartListCondition(rule, locale)
      : rule.negate ? translateAt("Not: {{statement}}", locale, { statement: describeRule(rule, false, locale) }) : describeRule(rule, false, locale))
    if (rule.kind === 'group') rule.rules.forEach(visit)
  }
  visit(root)
  return descriptions
}

function staticReasonsForRule(
  rule: SmartListRule,
  descriptions: ReadonlyMap<string, string>,
): readonly string[] | undefined {
  if (rule.kind === 'condition' || rule.negate) return [descriptions.get(rule.id)!]
  if (rule.combinator === 'any') return undefined
  const childReasons = rule.rules.map((child) => staticReasonsForRule(child, descriptions))
  return childReasons.every((reasons): reasons is readonly string[] => Boolean(reasons))
    ? childReasons.flat()
    : undefined
}

function evaluateCondition(condition: SmartListCondition, document: SmartListDocument, now: string): boolean {
  if (isDateField(condition.field)) {
    return compareDate(dateValue(document, condition.field), condition.operator, condition.value, now)
  }
  if (isNumberField(condition.field)) {
    return compareNumber(numberValue(document, condition.field), condition.operator, condition.value)
  }
  if (condition.field === 'status') {
    return compareSingle(document.status, condition.operator, String(condition.value))
  }
  if (condition.field === 'availability') {
    const requested = String(condition.value)
    const matches = document.availability === requested
      || (requested === 'available' && document.availability === 'expiring-soon')
    return condition.operator === 'is-not' ? !matches : matches
  }
  const values = textValues(document, condition.field)
  return compareText(values, condition.operator, String(condition.value))
}

function compareSingle(actual: string, operator: SmartListCondition['operator'], expected: string): boolean {
  const matches = normalize(actual) === normalize(expected)
  return operator === 'is-not' ? !matches : matches
}

function compareText(
  values: readonly string[],
  operator: SmartListCondition['operator'],
  expected: string,
): boolean {
  const needle = normalize(expected)
  const matches = operator === 'is' || operator === 'is-not'
    ? values.some((value) => normalize(value) === needle)
    : values.some((value) => normalize(value).includes(needle))
  return operator === 'is-not' || operator === 'not-contains' ? !matches : matches
}

function compareNumber(
  actual: number | undefined,
  operator: SmartListCondition['operator'],
  expected: unknown,
): boolean {
  if (actual === undefined) return false
  if (operator === 'between' && Array.isArray(expected)) {
    return actual >= Number(expected[0]) && actual <= Number(expected[1])
  }
  const value = Number(expected)
  if (operator === 'is') return actual === value
  if (operator === 'is-not') return actual !== value
  if (operator === 'at-least') return actual >= value
  if (operator === 'at-most') return actual <= value
  if (operator === 'greater-than') return actual > value
  return actual < value
}

function compareDate(
  actual: string | undefined,
  operator: SmartListCondition['operator'],
  expected: unknown,
  now: string,
): boolean {
  if (operator === 'is-missing') return !actual
  if (!actual) return false
  const instant = Date.parse(actual)
  const reference = Date.parse(now)
  if (operator === 'before') return instant < Date.parse(String(expected))
  if (operator === 'after') return instant > Date.parse(String(expected))
  const duration = Number(expected) * 86_400_000
  if (operator === 'within-next-days') return instant >= reference && instant <= reference + duration
  if (operator === 'within-last-days') return instant <= reference && instant >= reference - duration
  return instant < reference - duration
}

function sortResults(
  items: readonly SmartListResultItem[],
  definition: SmartListDefinition,
): SmartListResultItem[] {
  const direction = definition.sort.direction === 'ascending' ? 1 : -1
  return items
    .map((item) => ({ item, value: sortValue(item.document, definition.sort.field) }))
    .sort((left, right) => compareNullable(left.value, right.value) * direction
      || left.item.document.title.localeCompare(right.item.document.title)
      || left.item.document.id.localeCompare(right.item.document.id))
    .map(({ item }) => item)
}

function compareNullable(left: number | string | undefined, right: number | string | undefined): number {
  if (left === undefined && right === undefined) return 0
  if (left === undefined) return 1
  if (right === undefined) return -1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

function sortValue(document: SmartListDocument, field: SmartListDefinition['sort']['field']) {
  if (field === 'title') return normalize(document.title)
  if (field === 'author') return normalize(document.authors[0] ?? '')
  if (field === 'date-added') return Date.parse(document.dateAdded)
  if (field === 'date-updated') return Date.parse(document.dateUpdated)
  if (field === 'progress') return document.progress
  if (field === 'rating') return document.rating
  if (field === 'loan-due') return document.loanDueAt ? Date.parse(document.loanDueAt) : undefined
  return document.durationMinutes
}

function groupResults(
  items: readonly SmartListResultItem[],
  field: SmartListGroupField,
): SmartListResultGroup[] {
  if (field === 'none') return [{ key: 'all', label: 'All matches', items }]
  const grouped = new Map<string, SmartListResultItem[]>()
  for (const item of items) {
    const labels = groupLabels(item.document, field)
    for (const label of labels.length ? labels : ['Other']) {
      grouped.set(label, [...(grouped.get(label) ?? []), item])
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, groupItems]) => ({ key: normalize(label), label, items: groupItems }))
}

function groupLabels(document: SmartListDocument, field: Exclude<SmartListGroupField, 'none'>): string[] {
  if (field === 'status') return [STATUS_LABELS[document.status]]
  if (field === 'format') return [...document.formats]
  if (field === 'author') return [...document.authors]
  if (field === 'series') return [...document.series]
  if (field === 'source') return [...document.sources]
  if (field === 'ownership') return document.ownerships.map(titleCase)
  return [titleCase(document.availability)]
}

function describeRule(rule: SmartListRule, root: boolean, locale = getLocale()): string {
  if (rule.kind === 'condition') return describeSmartListCondition(rule, locale)
  const joiner = rule.combinator === 'all' ? translateAt(' and ', locale) : translateAt(' or ', locale)
  const children = rule.rules.map((child) => describeRule(child, false, locale)).join(joiner)
  const grouped = root ? rule.combinator === 'all' ? translateAt('All of: {{rules}}', locale, { rules: children }) : translateAt('Any of: {{rules}}', locale, { rules: children }) : `(${children})`
  return rule.negate ? translateAt("Not {{rules}}", locale, { rules: grouped }) : grouped
}

function textValues(document: SmartListDocument, field: SmartListRuleField): readonly string[] {
  if (field === 'format') return document.formats
  if (field === 'source') return document.sources
  if (field === 'tag') return document.tags
  if (field === 'author') return document.authors
  if (field === 'series') return document.series
  if (field === 'ownership') return document.ownerships
  return []
}

function numberValue(document: SmartListDocument, field: SmartListRuleField): number | undefined {
  if (field === 'progress') return document.progress
  if (field === 'rating') return document.rating
  return document.durationMinutes
}

function dateValue(document: SmartListDocument, field: SmartListRuleField): string | undefined {
  if (field === 'dateAdded') return document.dateAdded
  if (field === 'dateStarted') return document.dateStarted
  if (field === 'dateFinished') return document.dateFinished
  if (field === 'dateUpdated') return document.dateUpdated
  return document.loanDueAt
}

function isDateField(field: SmartListRuleField): boolean {
  return ['dateAdded', 'dateStarted', 'dateFinished', 'dateUpdated', 'loanDueAt'].includes(field)
}

function isNumberField(field: SmartListRuleField): boolean {
  return ['progress', 'rating', 'durationMinutes'].includes(field)
}

function formatRuleValue(field: SmartListRuleField, value: unknown, locale = getLocale()): string {
  const formatNumber = (number: number) => new Intl.NumberFormat(locale).format(number)
  if (Array.isArray(value)) return value.map(item => typeof item === 'number' ? formatNumber(item) : String(item)).join('–')
  if (typeof value === 'number') {
    if (isDateField(field)) return translateAt('dayCount', locale, { count: value, value: formatNumber(value) })
    if (field === 'durationMinutes') {
      const hours = Math.floor(value / 60)
      const minutes = value % 60
      return `${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m` : ''}`.trim()
    }
    return formatNumber(value)
  }
  if (field === 'status') return translateCopy(STATUS_LABELS[String(value) as ShelfId] ?? String(value), locale)
  if (field === 'ownership' || field === 'availability') return translateCopy(titleCase(String(value)), locale)
  if (isDateField(field) && typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toLocaleDateString(locale)
  return String(value)
}

function createCatalogIndex(catalog: Catalog) {
  const workById = new Map(catalog.works.map((work) => [work.id, work]))
  const editionById = new Map(catalog.editions.map((edition) => [edition.id, edition]))
  const editionsByWorkId = new Map<string, typeof catalog.editions>()
  for (const edition of catalog.editions) {
    editionsByWorkId.set(edition.workId, [...(editionsByWorkId.get(edition.workId) ?? []), edition])
  }
  const workIdsByTitle = new Map<string, string[]>()
  for (const work of catalog.works) {
    const title = normalize(work.title.value)
    workIdsByTitle.set(title, [...(workIdsByTitle.get(title) ?? []), work.id])
  }
  const workIdsByIdentifier = new Map<string, string[]>()
  for (const identifier of catalog.identifiers) {
    const workId = identifier.owner.type === 'work'
      ? identifier.owner.id
      : editionById.get(identifier.owner.id)?.workId
    if (!workId) continue
    const key = normalizeIdentifier(identifier.normalizedValue)
    workIdsByIdentifier.set(key, [...(workIdsByIdentifier.get(key) ?? []), workId])
  }
  const personById = new Map(catalog.people.map((person) => [person.id, person]))

  return {
    forBook(book: LibraryBook, now: string) {
      const workIds = new Set<string>()
      if (workById.has(book.id as never)) workIds.add(book.id)
      const directEdition = editionById.get(book.id as never)
      if (directEdition) workIds.add(directEdition.workId)
      for (const identifier of book.identifiers ?? []) {
        for (const workId of workIdsByIdentifier.get(normalizeIdentifier(identifier)) ?? []) workIds.add(workId)
      }
      for (const workId of workIdsByTitle.get(normalize(book.title)) ?? []) workIds.add(workId)
      const editions = [...workIds].flatMap((workId) => editionsByWorkId.get(workId) ?? [])
      const editionIds = new Set(editions.map(({ id }) => id))

      const authors = catalog.contributors.flatMap((contribution) => {
        if (contribution.role !== 'author') return []
        const applies = contribution.target.type === 'work'
          ? workIds.has(contribution.target.id)
          : editionIds.has(contribution.target.id)
        if (!applies) return []
        const person = personById.get(contribution.personId)
        return [person?.displayName.value ?? contribution.creditedAs]
      })
      const formats = [
        ...editions.map(({ medium }) => medium),
        ...catalog.assets.filter(({ editionId }) => editionIds.has(editionId)).map(({ format }) => format),
      ]
      const activeOwnerships = catalog.ownerships.filter(
        (ownership) => editionIds.has(ownership.editionId)
          && (!ownership.disposedAt || Date.parse(ownership.disposedAt) > Date.parse(now)),
      )
      const loans = catalog.loans.filter(({ editionId }) => editionIds.has(editionId))
      const activeLoans = loans.filter(
        (loan) => !loan.returnedAt && Date.parse(loan.borrowedAt) <= Date.parse(now)
          && Date.parse(loan.dueAt) > Date.parse(now),
      )
      const grants = catalog.accessGrants.filter(({ editionId }) => editionIds.has(editionId))
      const bases = new Set<SmartListOwnership>()
      if (activeOwnerships.length) bases.add('owned')
      if (activeLoans.length) bases.add('borrowed')
      if (grants.some(({ basis }) => basis === 'subscription')) bases.add('subscription')
      if (grants.some(({ basis }) => basis === 'public-domain')) bases.add('public-domain')
      if (!bases.size) bases.add('none')

      const states = grants.flatMap((grant) => {
        try {
          return [accessStateAt(grant, catalog.ownerships, catalog.loans, now as never)]
        } catch {
          return []
        }
      })
      const loanDueAt = activeLoans
        .map(({ dueAt }) => dueAt)
        .sort((left, right) => Date.parse(left) - Date.parse(right))[0]
      const expiresSoon = loanDueAt
        ? Date.parse(loanDueAt) - Date.parse(now) <= 7 * 86_400_000
        : false
      const availability: SmartListAvailability = expiresSoon
        ? 'expiring-soon'
        : states.includes('available') || activeOwnerships.length > 0 || activeLoans.length > 0
          ? 'available'
          : states.some((state) => state === 'expired' || state === 'returned' || state === 'ended')
            ? 'expired'
            : 'unavailable'

      const relatedSourceIds = new Set<string>()
      for (const loan of loans) if (loan.sourceRecordId) relatedSourceIds.add(loan.sourceRecordId)
      for (const identifier of catalog.identifiers) {
        const applies = identifier.owner.type === 'work'
          ? workIds.has(identifier.owner.id)
          : editionIds.has(identifier.owner.id)
        if (applies) identifier.sourceRecordIds.forEach((id) => relatedSourceIds.add(id))
      }
      for (const record of catalog.sourceRecords) {
        const referencesBook = record.claims.some(({ target }) => target.type === 'work'
          ? workIds.has(target.id)
          : target.type === 'edition' && editionIds.has(target.id))
          || record.observedIdentifiers.some(({ target }) => target?.type === 'work'
            ? workIds.has(target.id)
            : target?.type === 'edition' && editionIds.has(target.id))
        if (referencesBook) relatedSourceIds.add(record.id)
      }
      const sources = catalog.sourceRecords
        .filter(({ id }) => relatedSourceIds.has(id))
        .map(({ source }) => source.name)
      const durationMinutes = editions
        .flatMap((edition) => edition.medium === 'audiobook' && edition.durationMs
          ? [edition.durationMs.value / 60_000]
          : [])
        .sort((left, right) => left - right)[0]

      return {
        authors: uniqueText(authors),
        formats: uniqueText(formats),
        sources: uniqueText(sources),
        ownerships: [...bases],
        loanDueAt,
        availability,
        durationMinutes,
      }
    },
  }
}

function uniqueText(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (!value?.trim()) continue
    const key = normalize(value)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value.trim())
  }
  return result
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase()
}

function normalizeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toLocaleLowerCase()
}

function titleCase(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toLocaleUpperCase())
}

const FIELD_LABELS: Record<SmartListRuleField, string> = {
  status: 'Status',
  format: 'Format',
  source: 'Source',
  tag: 'Tag',
  author: 'Author',
  series: 'Series',
  dateAdded: 'Date added',
  dateStarted: 'Date started',
  dateFinished: 'Date finished',
  dateUpdated: 'Last updated',
  progress: 'Progress',
  rating: 'Rating',
  ownership: 'Ownership',
  loanDueAt: 'Loan due date',
  availability: 'Availability',
  durationMinutes: 'Duration',
}

const OPERATOR_LABELS: Record<SmartListCondition['operator'], string> = {
  is: 'is',
  'is-not': 'is not',
  contains: 'contains',
  'not-contains': 'does not contain',
  'at-least': 'is at least',
  'at-most': 'is at most',
  'greater-than': 'is greater than',
  'less-than': 'is less than',
  between: 'is between',
  before: 'is before',
  after: 'is after',
  'within-next-days': 'is within the next',
  'within-last-days': 'is within the last',
  'older-than-days': 'is older than',
  'is-missing': 'is missing',
}

const STATUS_LABELS: Record<ShelfId, string> = {
  tbr: 'To Be Read',
  next: 'Up Next',
  reading: 'Reading',
  finished: 'Finished',
  dnf: 'DNF',
}
