import {
  workIdSchema,
  type Catalog,
  type Contributor,
  type Edition,
  type Identifier,
  type SourceRecord,
  type Work,
  type WorkId,
} from '../domain/catalog'
import { LocalSearchIndex, fuzzySearchTextSimilarity, normalizeSearchText } from '../search/local-search'
import {
  duplicateCandidateId,
  duplicateCandidateSchema,
  duplicatePairKey,
  type DuplicateCandidate,
  type DuplicateEvidence,
  type DuplicatePairDecision,
} from './model'

type WorkFacts = {
  readonly work: Work
  readonly title: string
  readonly contributors: readonly string[]
  readonly editions: readonly Edition[]
  readonly identifiers: readonly Identifier[]
  readonly sourceLinks: readonly string[]
}

export type DuplicateDetectionResult = {
  readonly review: readonly DuplicateCandidate[]
  readonly background: readonly DuplicateCandidate[]
  readonly suppressedPairs: number
}

export function detectDuplicateWorks(
  catalog: Catalog,
  decisions: readonly DuplicatePairDecision[] = [],
): DuplicateDetectionResult {
  const facts = catalog.works.map((work) => factsFor(catalog, work))
  const byId = new Map(facts.map((fact) => [fact.work.id, fact]))
  const pairKeys = candidatePairKeys(facts)
  const activeDecisions = new Set(
    decisions.filter(({ undoneAt }) => !undoneAt).map(({ pairKey }) => pairKey),
  )
  const candidates: DuplicateCandidate[] = []
  let suppressedPairs = 0

  for (const pairKey of pairKeys) {
    if (activeDecisions.has(pairKey)) {
      suppressedPairs += 1
      continue
    }
    const [leftWorkId, rightWorkId] = workIdsFromPairKey(pairKey)
    const left = byId.get(leftWorkId)
    const right = byId.get(rightWorkId)
    if (!left || !right) continue
    const candidate = compareFacts(left, right)
    if (candidate) candidates.push(candidate)
  }

  candidates.sort((left, right) =>
    right.score - left.score
    || left.leftWorkId.localeCompare(right.leftWorkId)
    || left.rightWorkId.localeCompare(right.rightWorkId),
  )

  return {
    review: candidates.filter(({ reviewPriority }) => reviewPriority === 'review'),
    background: candidates.filter(({ reviewPriority }) => reviewPriority === 'background'),
    suppressedPairs,
  }
}

function candidatePairKeys(facts: readonly WorkFacts[]): Set<string> {
  const pairKeys = new Set<string>()
  const index = new LocalSearchIndex()
  index.replace(facts.map((fact) => ({
    id: fact.work.id,
    title: fact.title,
    contributors: fact.contributors,
    identifiers: fact.identifiers.map(({ normalizedValue }) => normalizedValue),
    sourceNames: fact.sourceLinks,
    editions: fact.editions.map((edition) => ({
      id: edition.id,
      title: edition.title.value,
      format: edition.medium,
    })),
  })))

  for (const fact of facts) {
    const results = index.search(fact.title, { limit: 40 })
    for (const result of results) {
      if (result.document.id !== fact.work.id) {
        pairKeys.add(duplicatePairKey(fact.work.id, result.document.id))
      }
    }
  }

  addGroupedPairs(pairKeys, facts, ({ identifiers }) =>
    identifiers.map(({ scheme, normalizedValue }) => `${scheme}:${normalizedValue}`),
  )
  addGroupedPairs(pairKeys, facts, ({ sourceLinks }) => sourceLinks)
  return pairKeys
}

function addGroupedPairs(
  destination: Set<string>,
  facts: readonly WorkFacts[],
  keysFor: (facts: WorkFacts) => readonly string[],
): void {
  const groups = new Map<string, string[]>()
  for (const fact of facts) {
    for (const key of keysFor(fact)) {
      const workIds = groups.get(key) ?? []
      workIds.push(fact.work.id)
      groups.set(key, workIds)
    }
  }
  for (const workIds of groups.values()) {
    for (let leftIndex = 0; leftIndex < workIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < workIds.length; rightIndex += 1) {
        destination.add(duplicatePairKey(workIds[leftIndex]!, workIds[rightIndex]!))
      }
    }
  }
}

function compareFacts(left: WorkFacts, right: WorkFacts): DuplicateCandidate | undefined {
  const evidence: DuplicateEvidence[] = []
  const add = (item: DuplicateEvidence) => evidence.push(item)
  const titleSimilarity = fuzzySearchTextSimilarity(left.title, right.title)

  if (titleSimilarity === 1) {
    add({
      kind: 'title', tone: 'supporting', weight: 0.36,
      label: 'Same normalized title',
      explanation: `“${left.title}” and “${right.title}” normalize to the same searchable title.`,
    })
  } else if (titleSimilarity >= 0.94) {
    add({
      kind: 'title', tone: 'supporting', weight: 0.29,
      label: 'Near-identical title',
      explanation: `The fuzzy title match is ${Math.round(titleSimilarity * 100)}%, including likely punctuation or typing differences.`,
    })
  } else if (titleSimilarity >= 0.84) {
    add({
      kind: 'title', tone: 'supporting', weight: 0.22,
      label: 'Strong title resemblance',
      explanation: `The fuzzy title match is ${Math.round(titleSimilarity * 100)}%.`,
    })
  } else if (titleSimilarity >= 0.74) {
    add({
      kind: 'title', tone: 'supporting', weight: 0.15,
      label: 'Possible title resemblance',
      explanation: `The fuzzy title match is ${Math.round(titleSimilarity * 100)}%; other evidence must carry the review.`,
    })
  }

  const sharedIdentifiers = intersection(
    left.identifiers.map(identifierKey),
    right.identifiers.map(identifierKey),
  )
  for (const key of sharedIdentifiers) {
    const [scheme, ...valueParts] = key.split(':')
    const value = valueParts.join(':')
    const isIsbn = scheme === 'isbn-10' || scheme === 'isbn-13'
    add({
      kind: 'identifier', tone: 'supporting', weight: isIsbn ? 0.52 : 0.42,
      label: `Exact ${scheme?.toUpperCase()} match`,
      explanation: `${value} identifies an Edition. It is strong evidence, but never merges Works on its own.`,
    })
  }

  const sharedLinks = intersection(left.sourceLinks, right.sourceLinks)
  for (const link of sharedLinks) {
    add({
      kind: 'source-link', tone: 'supporting', weight: 0.55,
      label: 'Shared source identity',
      explanation: `Both Works are already linked to ${link}.`,
    })
  }

  const contributorComparison = compareContributors(left.contributors, right.contributors)
  if (contributorComparison === 'exact') {
    add({
      kind: 'contributors', tone: 'supporting', weight: 0.3,
      label: 'Same credited contributors',
      explanation: `Both Works credit ${left.contributors.join(', ')}.`,
    })
  } else if (contributorComparison === 'overlap') {
    const shared = intersection(normalized(left.contributors), normalized(right.contributors))
    add({
      kind: 'contributors', tone: 'supporting', weight: 0.18,
      label: 'Contributor overlap',
      explanation: `Both records include ${shared.join(', ')} among their contributors.`,
    })
  } else if (contributorComparison === 'conflict') {
    add({
      kind: 'contributors', tone: 'caution', weight: -0.22,
      label: 'Different credited contributors',
      explanation: 'Both records have contributors, but none of the normalized names agree.',
    })
  }

  addPublicationEvidence(left, right, add)

  const leftLanguage = left.work.originalLanguage?.value
  const rightLanguage = right.work.originalLanguage?.value
  if (leftLanguage && rightLanguage) {
    add(leftLanguage === rightLanguage ? {
      kind: 'language', tone: 'supporting', weight: 0.04,
      label: 'Same original language',
      explanation: `Both Works record ${leftLanguage} as the original language.`,
    } : {
      kind: 'language', tone: 'caution', weight: -0.14,
      label: 'Different original languages',
      explanation: `${leftLanguage} and ${rightLanguage} may indicate a translation or a different Work.`,
    })
  }

  if (left.work.kind !== right.work.kind) {
    add({
      kind: 'work-kind', tone: 'caution', weight: -0.2,
      label: 'Different Work structures',
      explanation: `One record is ${left.work.kind}; the other is ${right.work.kind}.`,
    })
  }

  const leftMedia = unique(left.editions.map(({ medium }) => medium))
  const rightMedia = unique(right.editions.map(({ medium }) => medium))
  if (sharedIdentifiers.length && !leftMedia.some((medium) => rightMedia.includes(medium))) {
    add({
      kind: 'format-caution', tone: 'caution', weight: -0.06,
      label: 'Identifier crosses formats',
      explanation: `The exact Edition identifier appears across ${leftMedia.join('/')} and ${rightMedia.join('/')}; verify the editions before merging their Works.`,
    })
  }

  if (!evidence.length) return undefined
  const score = clamp(evidence.reduce((sum, item) => sum + item.weight, 0), 0, 1)
  if (score < 0.28) return undefined
  const confidence = score >= 0.72 ? 'high' : score >= 0.48 ? 'medium' : 'low'
  const [leftWorkId, rightWorkId] = [left.work.id, right.work.id].sort()
  return duplicateCandidateSchema.parse({
    id: duplicateCandidateId(leftWorkId!, rightWorkId!),
    pairKey: duplicatePairKey(leftWorkId!, rightWorkId!),
    leftWorkId,
    rightWorkId,
    confidence,
    score,
    reviewPriority: confidence === 'low' ? 'background' : 'review',
    requiresReview: true,
    evidence,
  })
}

function addPublicationEvidence(
  left: WorkFacts,
  right: WorkFacts,
  add: (evidence: DuplicateEvidence) => void,
): void {
  const leftYears = unique(left.editions.flatMap(({ publicationDate }) =>
    publicationDate?.value?.slice(0, 4) ?? [],
  ))
  const rightYears = unique(right.editions.flatMap(({ publicationDate }) =>
    publicationDate?.value?.slice(0, 4) ?? [],
  ))
  const sharedYears = intersection(leftYears, rightYears)
  if (sharedYears.length) {
    add({
      kind: 'publication', tone: 'supporting', weight: 0.06,
      label: 'Publication year agrees',
      explanation: `Both records include an Edition published in ${sharedYears.join(', ')}.`,
    })
  }

  const leftPublishers = normalized(left.editions.flatMap(({ publisher }) => publisher?.value ?? []))
  const rightPublishers = normalized(right.editions.flatMap(({ publisher }) => publisher?.value ?? []))
  const sharedPublishers = intersection(leftPublishers, rightPublishers)
  if (sharedPublishers.length) {
    add({
      kind: 'publication', tone: 'supporting', weight: 0.05,
      label: 'Publisher agrees',
      explanation: `The Edition metadata shares ${sharedPublishers.join(', ')}.`,
    })
  }
}

function factsFor(catalog: Catalog, work: Work): WorkFacts {
  const editions = catalog.editions.filter(({ workId }) => workId === work.id)
  const editionIds = new Set(editions.map(({ id }) => id))
  const contributors = catalog.contributors
    .filter((contributor) => contributorBelongsToWork(contributor, work.id, editionIds))
    .filter(({ role }) => role === 'author' || role === 'editor' || role === 'compiler')
    .map(({ creditedAs }) => creditedAs)
  const identifiers = catalog.identifiers.filter(({ owner }) =>
    owner.type === 'work' ? owner.id === work.id : editionIds.has(owner.id),
  )
  const sourceLinks = catalog.sourceRecords
    .filter((source) => sourceBelongsToWork(source, work.id, editionIds))
    .map(({ source, externalKey }) => `${source.name} · ${externalKey}`)
  return {
    work,
    title: work.title.value,
    contributors: unique(contributors),
    editions,
    identifiers,
    sourceLinks: unique(sourceLinks),
  }
}

function contributorBelongsToWork(
  contributor: Contributor,
  workId: string,
  editionIds: ReadonlySet<string>,
): boolean {
  return contributor.target.type === 'work'
    ? contributor.target.id === workId
    : editionIds.has(contributor.target.id)
}

function sourceBelongsToWork(
  source: SourceRecord,
  workId: string,
  editionIds: ReadonlySet<string>,
): boolean {
  const belongs = (target: { readonly type: 'work' | 'edition'; readonly id: string }) =>
    target.type === 'work' ? target.id === workId : editionIds.has(target.id)
  return source.claims.some(({ target }) => target.type !== 'person' && belongs(target))
    || source.observedIdentifiers.some(({ target }) => target && belongs(target))
}

function compareContributors(
  left: readonly string[],
  right: readonly string[],
): 'exact' | 'overlap' | 'conflict' | 'missing' {
  if (!left.length || !right.length) return 'missing'
  const normalizedLeft = normalized(left).sort()
  const normalizedRight = normalized(right).sort()
  if (normalizedLeft.join('\u0000') === normalizedRight.join('\u0000')) return 'exact'
  return intersection(normalizedLeft, normalizedRight).length ? 'overlap' : 'conflict'
}

function workIdsFromPairKey(pairKey: string): readonly [WorkId, WorkId] {
  const [left, right] = pairKey.replace('duplicate-pair:', '').split(':')
  return [workIdSchema.parse(decodeURIComponent(left!)), workIdSchema.parse(decodeURIComponent(right!))]
}

function identifierKey(identifier: Identifier): string {
  return `${identifier.scheme}:${identifier.normalizedValue}`
}

function normalized(values: readonly string[]): string[] {
  return unique(values.map(normalizeSearchText).filter(Boolean))
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightValues = new Set(right)
  return unique(left.filter((value) => rightValues.has(value)))
}

function unique<Value>(values: readonly Value[]): Value[] {
  return [...new Set(values)]
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
