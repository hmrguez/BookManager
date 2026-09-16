export const LOCAL_SEARCH_INDEX_VERSION = 1

export type SearchField =
  | 'title'
  | 'alternate-title'
  | 'contributor'
  | 'series'
  | 'identifier'
  | 'tag'
  | 'list'
  | 'note'
  | 'source'
  | 'edition'

export type SearchEdition = {
  readonly id?: string
  readonly title?: string
  readonly format?: string
  readonly identifiers?: readonly string[]
}

export type LocalSearchDocument = {
  readonly id: string
  readonly title: string
  readonly alternateTitles?: readonly string[]
  readonly contributors?: readonly string[]
  readonly series?: readonly string[]
  readonly identifiers?: readonly string[]
  readonly tags?: readonly string[]
  readonly listNames?: readonly string[]
  readonly notes?: readonly string[]
  readonly sourceNames?: readonly string[]
  readonly editions?: readonly SearchEdition[]
  readonly shelf?: string
  readonly rating?: number
  readonly addedAt?: string
  readonly updatedAt?: string
}

export type SearchHighlight = {
  readonly field: SearchField
  readonly value: string
  readonly ranges: readonly SearchHighlightRange[]
}

export type SearchHighlightRange = {
  readonly start: number
  readonly end: number
}

export type LocalSearchResult = {
  readonly document: LocalSearchDocument
  readonly score: number
  readonly highlights: readonly SearchHighlight[]
  readonly matchedFields: readonly SearchField[]
}

export type LocalSearchSort = 'relevance' | 'title' | 'added' | 'updated'

export type LocalSearchOptions = {
  readonly includeNotes?: boolean
  readonly shelves?: readonly string[]
  readonly formats?: readonly string[]
  readonly minimumRating?: number
  readonly sort?: LocalSearchSort
  readonly limit?: number
}

export type SearchIndexCheckpoint = {
  readonly version: number
  readonly sourceKey: string
  readonly nextDocument: number
  readonly totalDocuments: number
  readonly complete: boolean
}

export type SearchIndexRebuildOptions = {
  readonly checkpoint?: SearchIndexCheckpoint
  readonly chunkSize?: number
  readonly sourceKey?: string
  readonly shouldContinue?: () => boolean
  readonly yieldControl?: () => Promise<void>
  readonly onCheckpoint?: (checkpoint: SearchIndexCheckpoint) => void
}

type IndexedWord = {
  readonly text: string
  readonly start: number
  readonly end: number
}

type IndexedValue = {
  readonly field: SearchField
  readonly value: string
  readonly normalized: string
  readonly sourceStarts: readonly number[]
  readonly sourceEnds: readonly number[]
  readonly words: readonly IndexedWord[]
  readonly weight: number
}

type IndexedDocument = {
  readonly document: LocalSearchDocument
  readonly values: readonly IndexedValue[]
}

type ValueMatch = {
  readonly score: number
  readonly range: SearchHighlightRange
}

type RankedMatch = ValueMatch & {
  readonly value: IndexedValue
}

const FIELD_WEIGHTS: Record<SearchField, number> = {
  title: 12,
  'alternate-title': 10,
  contributor: 9,
  series: 8,
  identifier: 11,
  tag: 7,
  list: 6,
  note: 3,
  source: 4,
  edition: 8,
}

const titleCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

export class LocalSearchIndex {
  #entries = new Map<string, IndexedDocument>()
  #postings = new Map<string, Set<string>>()
  #checkpoint?: SearchIndexCheckpoint

  get size(): number {
    return this.#entries.size
  }

  get checkpoint(): SearchIndexCheckpoint | undefined {
    return this.#checkpoint
  }

  replace(documents: readonly LocalSearchDocument[]): void {
    this.#entries.clear()
    this.#postings.clear()
    for (const document of documents) this.#add(document)
    this.#checkpoint = {
      version: LOCAL_SEARCH_INDEX_VERSION,
      sourceKey: sourceKeyFor(documents),
      nextDocument: documents.length,
      totalDocuments: documents.length,
      complete: true,
    }
  }

  async rebuild(
    documents: readonly LocalSearchDocument[],
    options: SearchIndexRebuildOptions = {},
  ): Promise<SearchIndexCheckpoint> {
    const chunkSize = boundedChunkSize(options.chunkSize ?? 50)
    const yieldControl = options.yieldControl ?? yieldToMainThread
    const sourceKey = options.sourceKey
      ?? await sourceKeyForCooperatively(documents, chunkSize, yieldControl)
    const requestedCheckpoint = options.checkpoint
    const canResume = Boolean(
      requestedCheckpoint
      && requestedCheckpoint.version === LOCAL_SEARCH_INDEX_VERSION
      && requestedCheckpoint.sourceKey === sourceKey
      && requestedCheckpoint.totalDocuments === documents.length
      && requestedCheckpoint.nextDocument === this.#entries.size,
    )

    if (!canResume) {
      this.#entries.clear()
      this.#postings.clear()
    }

    let nextDocument = canResume ? requestedCheckpoint?.nextDocument ?? 0 : 0

    while (nextDocument < documents.length && (options.shouldContinue?.() ?? true)) {
      const chunkEnd = Math.min(documents.length, nextDocument + chunkSize)
      for (; nextDocument < chunkEnd; nextDocument += 1) {
        this.#add(documents[nextDocument])
      }

      this.#checkpoint = checkpointFor(sourceKey, nextDocument, documents.length)
      options.onCheckpoint?.(this.#checkpoint)
      if (nextDocument < documents.length) {
        await yieldControl()
      }
    }

    this.#checkpoint = checkpointFor(sourceKey, nextDocument, documents.length)
    options.onCheckpoint?.(this.#checkpoint)
    return this.#checkpoint
  }

  search(query: string, options: LocalSearchOptions = {}): LocalSearchResult[] {
    const normalizedQuery = normalize(query).text
    const queryTokens = unique(normalizedQuery.split(' ').filter(Boolean))
    const results: LocalSearchResult[] = []

    const candidateIndexes = queryTokens.length
      ? this.#candidateIndexes(queryTokens)
      : this.#entries.keys()
    for (const entryIndex of candidateIndexes) {
      const entry = this.#entries.get(entryIndex)!
      if (!passesFilters(entry.document, options)) continue

      if (queryTokens.length === 0) {
        results.push({ document: entry.document, score: 0, highlights: [], matchedFields: [] })
        continue
      }

      const searchableValues = options.includeNotes
        ? entry.values
        : entry.values.filter(({ field }) => field !== 'note')
      const tokenMatches: RankedMatch[] = []
      let rejected = false

      for (const token of queryTokens) {
        const match = bestTokenMatch(searchableValues, token)
        if (!match) {
          rejected = true
          break
        }
        tokenMatches.push(match)
      }
      if (rejected) continue

      const phraseMatch = normalizedQuery.includes(' ')
        ? bestPhraseMatch(searchableValues, normalizedQuery)
        : undefined
      const score = tokenMatches.reduce((sum, match) => sum + match.score, 0)
        + (phraseMatch?.score ?? 0)
      const matches = phraseMatch ? [...tokenMatches, phraseMatch] : tokenMatches
      results.push({
        document: entry.document,
        score,
        highlights: highlightsFor(matches),
        matchedFields: unique(matches.map(({ value }) => value.field)),
      })
    }

    results.sort(resultComparator(options.sort ?? 'relevance', queryTokens.length > 0))
    return results.slice(0, boundedLimit(options.limit ?? results.length))
  }

  /** Copy only changed posting sets; existing snapshots remain safe for React readers. */
  withChanges(documents: readonly LocalSearchDocument[], removedIds: readonly string[] = []): LocalSearchIndex {
    const next = new LocalSearchIndex()
    next.#entries = new Map(this.#entries)
    next.#postings = new Map(this.#postings)
    const replacements = documents.map(indexDocument)
    const ids = new Set([...removedIds, ...documents.map(({ id }) => id)])
    const touchedKeys = new Set<string>()
    for (const id of ids) {
      const previous = this.#entries.get(id)
      if (previous) for (const key of previous.values.flatMap(postingKeysFor)) touchedKeys.add(key)
    }
    for (const entry of replacements) {
      for (const key of entry.values.flatMap(postingKeysFor)) touchedKeys.add(key)
    }
    for (const key of touchedKeys) next.#postings.set(key, new Set(this.#postings.get(key)))
    for (const id of ids) {
      const previous = next.#entries.get(id)
      if (!previous) continue
      for (const key of previous.values.flatMap(postingKeysFor)) next.#postings.get(key)?.delete(id)
      next.#entries.delete(id)
    }
    for (const entry of replacements) next.#addEntry(entry)
    for (const key of touchedKeys) {
      if (!next.#postings.get(key)?.size) next.#postings.delete(key)
    }
    // Rebuild checkpoints describe a specific source and cannot be reused after an edit.
    return next
  }

  #add(document: LocalSearchDocument): void {
    this.#addEntry(indexDocument(document))
  }

  #addEntry(entry: IndexedDocument): void {
    const id = entry.document.id
    this.#entries.set(id, entry)
    for (const key of new Set(entry.values.flatMap(postingKeysFor))) {
      const indexes = this.#postings.get(key) ?? new Set<string>()
      indexes.add(id)
      this.#postings.set(key, indexes)
    }
  }

  #candidateIndexes(queryTokens: readonly string[]): Iterable<string> {
    let candidates: Set<string> | undefined
    for (const token of queryTokens) {
      const tokenCandidates = new Set<string>()
      const prefixMatches = this.#postings.get(`p:${token}`) ?? []
      for (const index of prefixMatches) tokenCandidates.add(index)
      for (const gram of gramsFor(token)) {
        for (const index of this.#postings.get(`g:${gram}`) ?? []) tokenCandidates.add(index)
      }
      if (tokenCandidates.size === 0) return []
      if (!candidates) {
        candidates = tokenCandidates
      } else {
        for (const index of candidates) {
          if (!tokenCandidates.has(index)) candidates.delete(index)
        }
      }
      if (candidates.size === 0) return []
    }
    return candidates ?? []
  }
}

function indexDocument(document: LocalSearchDocument): IndexedDocument {
  const values: IndexedValue[] = []
  const add = (field: SearchField, candidates: readonly (string | undefined)[]) => {
    for (const candidate of candidates) {
      const value = candidate?.trim()
      if (!value) continue
      const normalized = normalize(value)
      if (!normalized.text) continue
      values.push({
        field,
        value,
        normalized: normalized.text,
        sourceStarts: normalized.sourceStarts,
        sourceEnds: normalized.sourceEnds,
        words: wordsFor(normalized.text),
        weight: FIELD_WEIGHTS[field],
      })
    }
  }

  add('title', [document.title])
  add('alternate-title', document.alternateTitles ?? [])
  add('contributor', document.contributors ?? [])
  add('series', document.series ?? [])
  add('identifier', identifierCandidates(document.identifiers ?? []))
  add('tag', document.tags ?? [])
  add('list', document.listNames ?? [])
  add('note', document.notes ?? [])
  add('source', document.sourceNames ?? [])
  for (const edition of document.editions ?? []) {
    add('edition', [edition.title, edition.format])
    add('identifier', identifierCandidates(edition.identifiers ?? []))
  }

  return { document, values }
}

function bestTokenMatch(values: readonly IndexedValue[], token: string): RankedMatch | undefined {
  let best: RankedMatch | undefined
  for (const value of values) {
    const match = matchToken(value, token)
    if (!match) continue
    const ranked = { value, ...match }
    if (!best || ranked.score > best.score || (
      ranked.score === best.score && fieldOrder(ranked.value.field) < fieldOrder(best.value.field)
    )) {
      best = ranked
    }
  }
  return best
}

function matchToken(value: IndexedValue, token: string): ValueMatch | undefined {
  if (value.normalized === token) return valueMatch(value, 34 * value.weight, 0, token.length)
  if (value.normalized.startsWith(token)) return valueMatch(value, 29 * value.weight, 0, token.length)

  let best: ValueMatch | undefined
  for (const word of value.words) {
    let rawScore = 0
    let normalizedStart = word.start
    let normalizedEnd = word.end

    if (word.text === token) {
      rawScore = 27
    } else if (word.text.startsWith(token)) {
      rawScore = 23 - Math.min(4, word.text.length - token.length) * 0.35
      normalizedEnd = word.start + token.length
    } else {
      const substring = word.text.indexOf(token)
      if (substring >= 0) {
        rawScore = 17 - Math.min(4, substring) * 0.5
        normalizedStart = word.start + substring
        normalizedEnd = normalizedStart + token.length
      } else {
        const distance = boundedDamerauLevenshtein(token, word.text, typoTolerance(token.length))
        if (distance === undefined) continue
        rawScore = 14 - distance * 3 - Math.abs(word.text.length - token.length) * 0.25
      }
    }

    const match = valueMatch(
      value,
      Math.round(rawScore * value.weight),
      normalizedStart,
      normalizedEnd,
    )
    if (!best || match.score > best.score) best = match
  }
  return best
}

function bestPhraseMatch(
  values: readonly IndexedValue[],
  normalizedQuery: string,
): RankedMatch | undefined {
  let best: RankedMatch | undefined
  for (const value of values) {
    const start = value.normalized.indexOf(normalizedQuery)
    if (start === -1) continue
    const ranked = {
      value,
      ...valueMatch(
        value,
        (start === 0 ? 13 : 9) * value.weight,
        start,
        start + normalizedQuery.length,
      ),
    }
    if (!best || ranked.score > best.score) best = ranked
  }
  return best
}

function valueMatch(
  value: IndexedValue,
  score: number,
  normalizedStart: number,
  normalizedEnd: number,
): ValueMatch {
  const lastIndex = Math.max(normalizedStart, normalizedEnd - 1)
  return {
    score,
    range: {
      start: value.sourceStarts[normalizedStart] ?? 0,
      end: value.sourceEnds[lastIndex] ?? value.value.length,
    },
  }
}

function highlightsFor(matches: readonly RankedMatch[]): SearchHighlight[] {
  const grouped = new Map<string, { value: IndexedValue; ranges: SearchHighlightRange[] }>()
  for (const match of matches) {
    const key = `${match.value.field}\u0000${match.value.value}`
    const current = grouped.get(key) ?? { value: match.value, ranges: [] }
    current.ranges.push(match.range)
    grouped.set(key, current)
  }

  return [...grouped.values()].map(({ value, ranges }) => ({
    field: value.field,
    value: value.value,
    ranges: mergeRanges(ranges),
  }))
}

function mergeRanges(ranges: readonly SearchHighlightRange[]): SearchHighlightRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: SearchHighlightRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, range.end) }
    } else {
      merged.push(range)
    }
  }
  return merged
}

function passesFilters(document: LocalSearchDocument, options: LocalSearchOptions): boolean {
  if (options.shelves?.length && (!document.shelf || !options.shelves.includes(document.shelf))) {
    return false
  }
  if (options.formats?.length) {
    const documentFormats = unique((document.editions ?? []).flatMap(({ format }) => format ?? []))
    if (!documentFormats.some((format) => options.formats?.includes(format))) return false
  }
  if (options.minimumRating !== undefined && (document.rating ?? 0) < options.minimumRating) {
    return false
  }
  return true
}

function resultComparator(
  sort: LocalSearchSort,
  hasQuery: boolean,
): (left: LocalSearchResult, right: LocalSearchResult) => number {
  return (left, right) => {
    if (sort === 'relevance' && !hasQuery) return 0
    if (sort === 'relevance' && hasQuery && left.score !== right.score) {
      return right.score - left.score
    }
    if (sort === 'added') {
      const dateOrder = compareDate(right.document.addedAt, left.document.addedAt)
      if (dateOrder) return dateOrder
    }
    if (sort === 'updated') {
      const dateOrder = compareDate(right.document.updatedAt, left.document.updatedAt)
      if (dateOrder) return dateOrder
    }
    const titleOrder = titleCollator.compare(left.document.title, right.document.title)
    return titleOrder || left.document.id.localeCompare(right.document.id)
  }
}

function compareDate(left?: string, right?: string): number {
  return (left ?? '').localeCompare(right ?? '')
}

export function normalizeSearchText(value: string): string {
  return normalize(value).text
}

/**
 * Uses the same punctuation, diacritic, token, and transposition rules as local search.
 * Duplicate review uses this only after the index has produced a bounded candidate set.
 */
export function fuzzySearchTextSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeSearchText(left)
  const normalizedRight = normalizeSearchText(right)
  if (!normalizedLeft || !normalizedRight) return 0
  if (normalizedLeft === normalizedRight) return 1

  const distance = boundedDamerauLevenshtein(
    normalizedLeft,
    normalizedRight,
    Math.max(normalizedLeft.length, normalizedRight.length),
  )
  const editSimilarity = 1 - (distance ?? Math.max(
    normalizedLeft.length,
    normalizedRight.length,
  )) / Math.max(normalizedLeft.length, normalizedRight.length)
  const leftWords = new Set(normalizedLeft.split(' ').filter(Boolean))
  const rightWords = new Set(normalizedRight.split(' ').filter(Boolean))
  const sharedWords = [...leftWords].filter((word) => rightWords.has(word)).length
  const tokenSimilarity = (2 * sharedWords) / Math.max(1, leftWords.size + rightWords.size)

  return Math.max(editSimilarity, tokenSimilarity * 0.96)
}

function normalize(value: string): {
  readonly text: string
  readonly sourceStarts: readonly number[]
  readonly sourceEnds: readonly number[]
} {
  const characters: string[] = []
  const sourceStarts: number[] = []
  const sourceEnds: number[] = []
  let sourceOffset = 0
  let previousWasSpace = true

  for (const sourceCharacter of value) {
    const sourceEnd = sourceOffset + sourceCharacter.length
    const decomposed = sourceCharacter
      .normalize('NFKD')
      .replace(/\p{Mark}/gu, '')
      .toLocaleLowerCase()
    for (const character of decomposed) {
      const normalizedCharacter = /[\p{Letter}\p{Number}]/u.test(character) ? character : ' '
      if (normalizedCharacter === ' ') {
        if (previousWasSpace) continue
        previousWasSpace = true
      } else {
        previousWasSpace = false
      }
      characters.push(normalizedCharacter)
      sourceStarts.push(sourceOffset)
      sourceEnds.push(sourceEnd)
    }
    sourceOffset = sourceEnd
  }

  if (characters.at(-1) === ' ') {
    characters.pop()
    sourceStarts.pop()
    sourceEnds.pop()
  }

  return { text: characters.join(''), sourceStarts, sourceEnds }
}

function wordsFor(normalized: string): IndexedWord[] {
  const words: IndexedWord[] = []
  const matcher = /[^ ]+/g
  for (const match of normalized.matchAll(matcher)) {
    const start = match.index
    words.push({ text: match[0], start, end: start + match[0].length })
  }
  return words
}

function typoTolerance(length: number): number {
  if (length < 4) return 0
  if (length < 8) return 1
  return 2
}

function boundedDamerauLevenshtein(
  left: string,
  right: string,
  maximum: number,
): number | undefined {
  if (maximum === 0 || Math.abs(left.length - right.length) > maximum) return undefined
  if (left === right) return 0

  let previousPrevious = new Array<number>(right.length + 1).fill(0)
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    let rowMinimum = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      let distance = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      )
      if (
        leftIndex > 1
        && rightIndex > 1
        && left[leftIndex - 1] === right[rightIndex - 2]
        && left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        distance = Math.min(distance, (previousPrevious[rightIndex - 2] ?? 0) + 1)
      }
      current[rightIndex] = distance
      rowMinimum = Math.min(rowMinimum, distance)
    }
    if (rowMinimum > maximum) return undefined
    previousPrevious = previous
    previous = current
  }

  const distance = previous[right.length] ?? maximum + 1
  return distance <= maximum ? distance : undefined
}

function fieldOrder(field: SearchField): number {
  return Object.keys(FIELD_WEIGHTS).indexOf(field)
}

function identifierCandidates(values: readonly string[]): string[] {
  return unique(values.flatMap((value) => {
    const compact = value.replace(/[^\p{Letter}\p{Number}]/gu, '')
    return compact && compact !== value ? [value, compact] : [value]
  }))
}

function postingKeysFor(value: IndexedValue): string[] {
  return value.words.flatMap(({ text: word }) => {
    const prefixes = Array.from(
      { length: Math.min(word.length, 16) },
      (_, index) => `p:${word.slice(0, index + 1)}`,
    )
    return [...prefixes, ...gramsFor(word).map((gram) => `g:${gram}`)]
  })
}

function gramsFor(value: string): string[] {
  const size = value.length < 6 ? 2 : 3
  if (value.length < size) return []
  return unique(Array.from(
    { length: value.length - size + 1 },
    (_, index) => value.slice(index, index + size),
  ))
}

function checkpointFor(
  sourceKey: string,
  nextDocument: number,
  totalDocuments: number,
): SearchIndexCheckpoint {
  return {
    version: LOCAL_SEARCH_INDEX_VERSION,
    sourceKey,
    nextDocument,
    totalDocuments,
    complete: nextDocument === totalDocuments,
  }
}

function sourceKeyFor(documents: readonly LocalSearchDocument[]): string {
  let hash = 2_166_136_261
  for (const document of documents) {
    hash = addDocumentToHash(hash, document)
  }
  return `local-search:${LOCAL_SEARCH_INDEX_VERSION}:${documents.length}:${(hash >>> 0).toString(16)}`
}

async function sourceKeyForCooperatively(
  documents: readonly LocalSearchDocument[],
  chunkSize: number,
  yieldControl: () => Promise<void>,
): Promise<string> {
  let hash = 2_166_136_261
  for (let index = 0; index < documents.length; index += 1) {
    hash = addDocumentToHash(hash, documents[index])
    if ((index + 1) % chunkSize === 0 && index + 1 < documents.length) await yieldControl()
  }
  return `local-search:${LOCAL_SEARCH_INDEX_VERSION}:${documents.length}:${(hash >>> 0).toString(16)}`
}

function addDocumentToHash(hash: number, document: LocalSearchDocument): number {
  const fingerprint = JSON.stringify(document)
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash ^= fingerprint.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash
}

function boundedChunkSize(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error('Search index chunk size must be positive')
  return Math.min(value, 1_000)
}

function boundedLimit(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new Error('Search result limit cannot be negative')
  return Math.min(value, 10_000)
}

function unique<Value>(values: readonly Value[]): Value[] {
  return [...new Set(values)]
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0))
}
