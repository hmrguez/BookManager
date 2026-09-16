import {
  catalogSchema,
  contributorIdSchema,
  deriveReadingState,
  editionIdSchema,
  editionSchema,
  identifierIdSchema,
  integrationCheckpointIdSchema,
  listEntryIdSchema,
  listIdSchema,
  metadataCandidateValueSchema,
  personIdSchema,
  personSchema,
  progressSnapshotIdSchema,
  readingDeviceIdSchema,
  readingEventIdSchema,
  readingEventSchema,
  resolveMetadataField,
  sourceClaimIdSchema,
  sourceRecordIdSchema,
  toProgressSnapshot,
  workIdSchema,
  workSchema,
  type Catalog,
  type Contributor,
  type Edition,
  type Identifier,
  type IntegrationCheckpoint,
  type IsoDateTime,
  type JsonValue,
  type List,
  type ListEntry,
  type MetadataField,
  type MetadataTarget,
  type Person,
  type ProgressSnapshot,
  type ReadingEvent,
  type SourceClaim,
  type SourceRecord,
  type Work,
} from '../domain/catalog'
import { canonicalEditionIsbn, normalizeIsbn } from '../metadata/model'
import type { ImportEntityProposal, NormalizedLibraryBook } from './model'
import type { ImportMatchConfidence } from './model'
import { ImportCatalogIndex, catalogNameKey as normalizeText } from './catalog-index'

export type GoodreadsCatalogEntityType = ImportEntityProposal['entityType']

export type GoodreadsCatalogChange = {
  readonly entityType: GoodreadsCatalogEntityType
  readonly entityId: string
  readonly before?: JsonValue
  readonly after: JsonValue
  readonly reason: string
  readonly label: string
}

export type GoodreadsCatalogPlan = {
  readonly changes: readonly GoodreadsCatalogChange[]
  readonly entities: readonly ImportEntityProposal[]
}

const deviceId = readingDeviceIdSchema.parse('reading-device:goodreads-csv')

/** Builds the canonical records represented by one reviewed Goodreads row. */
export async function planGoodreadsCatalog(input: {
  readonly record: NormalizedLibraryBook
  readonly raw: Readonly<Record<string, string>>
  readonly rowHash: string
  readonly targetBookId: string
  readonly batchId: string
  readonly timestamp: string
  readonly catalog: Catalog
  readonly matchConfidence: ImportMatchConfidence
  /** A batch session validates the complete graph once before writing it. */
  readonly deferValidation?: boolean
  readonly index?: ImportCatalogIndex
}): Promise<GoodreadsCatalogPlan> {
  if (!input.record.goodreads) return { changes: [], entities: [] }
  const timestamp = input.timestamp as IsoDateTime
  const index = input.index ?? new ImportCatalogIndex(input.catalog)
  const token = encodeToken(input.record.externalKey)
  const sourceRecordId = sourceRecordIdSchema.parse(`source-record:goodreads:${token}`)
  const existingSourceRecord = index.get('source-record', sourceRecordId) as SourceRecord | undefined
  const matchedEdition = await findCanonicalEdition(input.record, input.targetBookId, index)
  const editionId = matchedEdition?.id ?? editionIdSchema.parse(`edition:goodreads:${token}`)
  const matchedWork = matchedEdition
    ? index.get('work', matchedEdition.workId) as Work | undefined
    : undefined
  const workId = matchedWork?.id ?? workIdSchema.parse(`work:goodreads:${token}`)
  const observedAt = timestamp
  const claimVersion = input.rowHash.slice(0, 16)
  const claims: SourceClaim[] = [...(existingSourceRecord?.claims ?? [])]
  const claim = (target: MetadataTarget, field: MetadataField, value: JsonValue, suffix: string) => {
    const item: SourceClaim = {
      // A revised export appends source evidence. Existing resolved metadata may still point at an
      // earlier claim, so replacing a claim in place would invalidate the canonical graph.
      id: sourceClaimIdSchema.parse(`source-claim:goodreads:${token}:${suffix}:${claimVersion}`),
      target,
      field,
      value,
      observedAt,
      confidence: field === 'edition.language' ? 0.2 : 0.9,
    }
    const existing = claims.find(({ id }) => id === item.id)
    if (existing) return existing
    claims.push(item)
    return item
  }
  const sourcedField = (target: MetadataTarget, field: MetadataField, value: JsonValue, suffix: string) => {
    const sourceClaim = claim(target, field, value, suffix)
    return resolveMetadataField(metadataCandidateValueSchema.parse({
      kind: 'source',
      target,
      field,
      value,
      sourceRecordId,
      claimId: sourceClaim.id,
      observedAt,
      confidence: sourceClaim.confidence,
    }))
  }

  const workTarget = { type: 'work', id: workId } as const
  const editionTarget = { type: 'edition', id: editionId } as const
  // Keep each export revision as normalized evidence even when a prior canonical value remains
  // authoritative and therefore does not change.
  claim(workTarget, 'work.title', input.record.title, 'work-title')
  claim(editionTarget, 'edition.title', input.record.editionTitle ?? input.record.title, 'edition-title')
  claim(editionTarget, 'edition.language', 'und', 'edition-language')
  if (input.record.publisher) {
    claim(editionTarget, 'edition.publisher', input.record.publisher, 'edition-publisher')
  }
  if (input.record.publicationDate) {
    claim(editionTarget, 'edition.publicationDate', input.record.publicationDate, 'edition-date')
  }
  if (input.record.pageCount && input.record.pageCount > 0) {
    claim(editionTarget, 'edition.pageCount', input.record.pageCount, 'edition-pages')
  }
  const newWork: Work | undefined = matchedWork ? undefined : workSchema.parse({
    id: workId,
    kind: 'single',
    title: sourcedField(workTarget, 'work.title', input.record.title, 'work-title'),
    createdAt: input.record.addedAt ?? timestamp,
    updatedAt: timestamp,
  })
  const newEdition: Edition | undefined = matchedEdition ? undefined : createEdition({
    record: input.record,
    editionId,
    workId,
    timestamp,
    sourcedField,
  })

  const people: Person[] = []
  const contributors: Contributor[] = []
  for (const [position, author] of input.record.authors.entries()) {
    const role = position === 0 ? 'author' as const : 'other' as const
    const existingPerson = index.peopleByName.get(normalizeText(author))
    const personToken = encodeToken(normalizeText(author))
    const personId = existingPerson?.id ?? personIdSchema.parse(`person:goodreads:${personToken}`)
    const target = { type: 'person', id: personId } as const
    claim(target, 'person.displayName', author, `person-${personToken}`)
    if (!existingPerson) {
      people.push(personSchema.parse({
        id: personId,
        displayName: sourcedField(target, 'person.displayName', author, `person-${personToken}`),
        createdAt: input.record.addedAt ?? timestamp,
        updatedAt: timestamp,
      }))
    }
    const existingContributor = input.catalog.contributors.find((contributor) =>
      contributor.personId === personId
      && contributor.target.type === 'work'
      && contributor.target.id === workId
      && contributor.role === role,
    )
    if (!existingContributor) {
      contributors.push({
        id: contributorIdSchema.parse(`contributor:goodreads:${token}:${position}`),
        personId,
        target: workTarget,
        role,
        creditedAs: author,
        position,
      })
    }
  }

  const currentObservedIdentifiers = (input.record.identifiers ?? []).flatMap((value) => {
    const normalizedValue = normalizeIsbn(value)
    if (!normalizedValue) return []
    return [{
      target: editionTarget,
      scheme: normalizedValue.length === 13 ? 'isbn-13' as const : 'isbn-10' as const,
      value,
      normalizedValue,
      confidence: 1,
    }]
  })
  const observedIdentifiers = uniqueBy(
    [...(existingSourceRecord?.observedIdentifiers ?? []), ...currentObservedIdentifiers],
    (identifier) => `${identifier.target?.type}:${identifier.target?.id}:${identifier.scheme}:${identifier.normalizedValue}`,
  )
  const sourceRecord: SourceRecord = {
    id: sourceRecordId,
    source: { kind: 'file-import', name: 'Goodreads CSV' },
    externalKey: input.record.externalKey,
    observedAt,
    importedAt: existingSourceRecord?.importedAt ?? timestamp,
    claims,
    observedIdentifiers,
    rawPayload: appendRawRevision(
      existingSourceRecord?.rawPayload,
      input.raw,
      input.rowHash,
      observedAt,
    ),
  }
  const identifiers: Identifier[] = currentObservedIdentifiers.map((observed) => {
    const existing = input.catalog.identifiers.find((identifier) =>
      identifier.owner.type === 'edition'
      && identifier.owner.id === editionId
      && identifier.normalizedValue === observed.normalizedValue,
    )
    return existing
      ? { ...existing, sourceRecordIds: unique([...existing.sourceRecordIds, sourceRecordId]) }
      : {
          id: identifierIdSchema.parse(
            `identifier:goodreads:${token}:${observed.scheme.replace('-', '')}`,
          ),
          owner: editionTarget,
          scheme: observed.scheme,
          value: observed.value,
          normalizedValue: observed.normalizedValue,
          sourceRecordIds: [sourceRecordId],
          createdAt: timestamp,
        }
  })

  const listPlans = planLists(input.record, workId, timestamp, input.catalog)
  const checkpoint = planCheckpoint(input.batchId, timestamp, input.catalog)
  const events = createReadingEvents({
    record: input.record,
    rowHash: input.rowHash,
    token,
    editionId,
    sourceRecordId,
    checkpointId: checkpoint.id,
    timestamp,
  }).filter((event) => !input.catalog.readingEvents.some(({ id }) => id === event.id))
  const snapshotId = progressSnapshotIdSchema.parse(`progress:goodreads:${token}`)
  const hasGoodreadsSnapshot = input.catalog.progressSnapshots.some(({ id }) => id === snapshotId)
  const snapshot = events.length && (!matchedEdition || hasGoodreadsSnapshot)
    ? createSnapshot(
        snapshotId,
        editionId,
        [...input.catalog.readingEvents.filter((event) => event.editionId === editionId), ...events],
        timestamp,
      )
    : undefined

  // Parsing the merged graph catches cross-record mistakes before SQLite is touched.
  const additions = {
    works: newWork ? [newWork] : [],
    editions: newEdition ? [newEdition] : [],
    assets: [],
    identifiers,
    sourceRecords: [sourceRecord],
    metadataOverrides: [],
    ownerships: [],
    loans: [],
    accessGrants: [],
    people,
    contributors,
    workParts: [],
    lists: listPlans.lists,
    listEntries: listPlans.entries,
    integrationCheckpoints: [checkpoint],
    readingEvents: events,
    progressSnapshots: snapshot ? [snapshot] : [],
  }
  if (!input.deferValidation) catalogSchema.parse(mergeCatalog(input.catalog, additions))

  const ordered: Array<readonly [GoodreadsCatalogEntityType, unknown, string, string]> = [
    ...(newWork ? [['work', newWork, 'Create the canonical work.', newWork.title.value] as const] : []),
    ['source-record', sourceRecord, 'Keep the original Goodreads row as source evidence.', 'Goodreads source record'],
    ...people.map((person) => ['person', person, 'Create a canonical contributor identity.', person.displayName.value] as const),
    ...(newEdition ? [['edition', newEdition, 'Create the exported edition.', newEdition.title.value] as const] : []),
    ...identifiers.map((identifier) => ['identifier', identifier, 'Attach the exported edition identifier.', `${identifier.scheme.toUpperCase()} ${identifier.normalizedValue}`] as const),
    ...contributors.map((contributor) => ['contributor', contributor, 'Credit the exported author.', contributor.creditedAs] as const),
    ...listPlans.lists.map((list) => ['list', list, 'Create a Goodreads shelf locally.', list.name] as const),
    ...listPlans.entries.map((entry) => ['list-entry', entry, 'Add this work to its Goodreads shelf.', 'Shelf membership'] as const),
    ['integration-checkpoint', checkpoint, 'Checkpoint this local Goodreads migration.', 'Goodreads migration checkpoint'],
    ...events.map((event) => ['reading-event', event, 'Preserve exported reading history.', readingEventLabel(event)] as const),
    ...(snapshot ? [['progress-snapshot', snapshot, 'Project the imported reading state.', 'Reading state'] as const] : []),
  ]

  const changes = ordered.flatMap(([entityType, after, reason, label]) => {
    const before = index.get(entityType, (after as { id: string }).id)
    if (before && sameJson(before, after)) return []
    return [{
      entityType,
      entityId: (after as { id: string }).id,
      before: before === undefined ? undefined : toJson(before),
      after: toJson(after),
      reason,
      label,
    }]
  })
  const changedKeys = new Set(changes.map(({ entityType, entityId }) => `${entityType}:${entityId}`))
  const entities = ordered.map(([entityType, entity, rationale, label]) => {
    const entityId = (entity as { id: string }).id
    const before = index.get(entityType, entityId)
    return {
      entityType,
      entityId,
      action: !before ? 'add' : changedKeys.has(`${entityType}:${entityId}`) ? 'update' : 'unchanged',
      label,
      sourceKey: 'goodreads-csv',
      confidence: input.matchConfidence,
      rationale,
    } satisfies ImportEntityProposal
  })
  return { changes, entities }
}

function createEdition(input: {
  readonly record: NormalizedLibraryBook
  readonly editionId: ReturnType<typeof editionIdSchema.parse>
  readonly workId: ReturnType<typeof workIdSchema.parse>
  readonly timestamp: IsoDateTime
  readonly sourcedField: (target: MetadataTarget, field: MetadataField, value: JsonValue, suffix: string) => ReturnType<typeof resolveMetadataField>
}): Edition {
  const target = { type: 'edition', id: input.editionId } as const
  const common = {
    id: input.editionId,
    workId: input.workId,
    title: input.sourcedField(target, 'edition.title', input.record.editionTitle ?? input.record.title, 'edition-title'),
    language: input.sourcedField(target, 'edition.language', 'und', 'edition-language'),
    ...(input.record.publisher
      ? { publisher: input.sourcedField(target, 'edition.publisher', input.record.publisher, 'edition-publisher') }
      : {}),
    ...(input.record.publicationDate
      ? { publicationDate: input.sourcedField(target, 'edition.publicationDate', input.record.publicationDate, 'edition-date') }
      : {}),
    createdAt: input.record.addedAt ?? input.timestamp,
    updatedAt: input.timestamp,
  }
  const format = input.record.format?.toLocaleLowerCase() ?? ''
  if (/audio/.test(format)) return editionSchema.parse({ ...common, medium: 'audiobook' })
  const pageCount = input.record.pageCount && input.record.pageCount > 0
    ? input.sourcedField(target, 'edition.pageCount', input.record.pageCount, 'edition-pages')
    : undefined
  if (/ebook|kindle|digital/.test(format)) {
    return editionSchema.parse({ ...common, medium: 'ebook', ...(pageCount ? { pageCount } : {}) })
  }
  const binding = /hardcover/.test(format) ? 'hardcover' : /paperback/.test(format) ? 'paperback' : 'other'
  return editionSchema.parse({ ...common, medium: 'print', binding, ...(pageCount ? { pageCount } : {}) })
}

function planLists(
  record: NormalizedLibraryBook,
  workId: ReturnType<typeof workIdSchema.parse>,
  timestamp: IsoDateTime,
  catalog: Catalog,
): { lists: List[]; entries: ListEntry[] } {
  const names = unique([record.goodreads?.exclusiveShelf ?? '', ...(record.listNames ?? [])].filter(Boolean))
  const lists: List[] = []
  const entries: ListEntry[] = []
  for (const name of names) {
    const slug = `goodreads-${slugify(name)}`
    const existingList = catalog.lists.find((list) => list.slug === slug)
    const list = existingList ?? {
      id: listIdSchema.parse(`list:goodreads:${encodeToken(slug)}`),
      kind: 'custom' as const,
      slug,
      name: humanShelfName(name),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    if (!existingList) lists.push(list)
    const existingEntry = catalog.listEntries.find((entry) => entry.listId === list.id && entry.workId === workId)
    if (existingEntry) continue
    const positions = catalog.listEntries.filter((entry) => entry.listId === list.id).map(({ position }) => position)
    entries.push({
      id: listEntryIdSchema.parse(`list-entry:goodreads:${encodeToken(`${list.id}|${workId}`)}`),
      listId: list.id,
      workId,
      position: positions.length ? Math.max(...positions) + 1 : 0,
      createdAt: record.addedAt ?? timestamp,
      updatedAt: timestamp,
    })
  }
  return { lists, entries }
}

function planCheckpoint(batchId: string, timestamp: IsoDateTime, catalog: Catalog): IntegrationCheckpoint {
  const checkpointId = integrationCheckpointIdSchema.parse(`integration-checkpoint:goodreads:${encodeToken(batchId)}`)
  const previous = catalog.integrationCheckpoints
    .filter(({ id, integrationKey, direction }) =>
      id !== checkpointId && integrationKey === 'goodreads-csv' && direction === 'import',
    )
    .sort((left, right) => right.committedAt.localeCompare(left.committedAt))[0]
  return {
    id: checkpointId,
    integrationKey: 'goodreads-csv',
    direction: 'import',
    previousCheckpointId: previous?.id,
    deviceId,
    observedAt: timestamp,
    committedAt: timestamp,
  }
}

function createReadingEvents(input: {
  readonly record: NormalizedLibraryBook
  readonly rowHash: string
  readonly token: string
  readonly editionId: ReturnType<typeof editionIdSchema.parse>
  readonly sourceRecordId: ReturnType<typeof sourceRecordIdSchema.parse>
  readonly checkpointId: ReturnType<typeof integrationCheckpointIdSchema.parse>
  readonly timestamp: IsoDateTime
}): ReadingEvent[] {
  const facts: unknown[] = []
  const suffix = input.rowHash.slice(0, 16)
  const source = {
    kind: 'integration' as const,
    integrationKey: 'goodreads-csv',
    sourceRecordId: input.sourceRecordId,
  }
  const event = (kind: string, effectiveAt: string, confidence: number) => ({
    id: readingEventIdSchema.parse(`reading-event:goodreads:${input.token}:${suffix}:${kind}`),
    editionId: input.editionId,
    source,
    deviceId,
    integrationCheckpointId: input.checkpointId,
    observedAt: input.timestamp,
    effectiveAt,
    recordedAt: input.timestamp,
    timeConfidence: confidence,
  })
  if (input.record.shelf === 'reading') {
    facts.push({
      // Goodreads exports no start date. Import time is honest current-state evidence; Date Added
      // remains available on the library record and raw source row.
      ...event('start', input.timestamp, 0.2),
      kind: 'start',
    })
  }
  if (input.record.shelf === 'finished') {
    const effectiveAt = input.record.finishedAt ?? input.timestamp
    facts.push({
      ...event('finish', effectiveAt, input.record.finishedAt ? 1 : 0.2),
      kind: 'finish',
      position: {
        locator: { kind: 'percent', fraction: 1 },
        normalizedProgress: 1,
        normalization: { kind: 'reported-percent', confidence: 1 },
      },
    })
  }
  if (input.record.rating && input.record.rating > 0) {
    facts.push({
      ...event('rating', input.record.finishedAt ?? input.timestamp, input.record.finishedAt ? 0.8 : 0.2),
      kind: 'rating',
      value: input.record.rating,
    })
  }
  if (input.record.notes) {
    facts.push({
      ...event('note', input.record.finishedAt ?? input.timestamp, input.record.finishedAt ? 0.8 : 0.2),
      kind: 'note',
      text: input.record.notes,
    })
  }
  const parsedFacts = readingEventSchema.array().parse(facts)
  if (!parsedFacts.length) return []
  const marker = readingEventSchema.parse({
    ...event('import', input.timestamp, 1),
    kind: 'import',
    importedEventIds: parsedFacts.map(({ id }) => id),
    externalBatchKey: input.record.externalKey,
  })
  return [...parsedFacts, marker]
}

function createSnapshot(
  snapshotId: ReturnType<typeof progressSnapshotIdSchema.parse>,
  editionId: ReturnType<typeof editionIdSchema.parse>,
  events: readonly ReadingEvent[],
  timestamp: IsoDateTime,
): ProgressSnapshot {
  return toProgressSnapshot(
    snapshotId,
    deriveReadingState(editionId, events),
    timestamp,
  )
}

function appendRawRevision(
  existing: JsonValue | undefined,
  row: Readonly<Record<string, string>>,
  rowHash: string,
  observedAt: IsoDateTime,
): JsonValue {
  const prior = isGoodreadsRawPayload(existing) ? existing.revisions : []
  const revisions = prior.some((revision) => revision.rowHash === rowHash)
    ? prior
    : [...prior, { rowHash, observedAt, row: { ...row } }]
  return {
    format: 'goodreads-library-export',
    latestRowHash: rowHash,
    revisions,
  }
}

function isGoodreadsRawPayload(value: JsonValue | undefined): value is {
  readonly format: 'goodreads-library-export'
  readonly latestRowHash: string
  readonly revisions: Array<{
    readonly rowHash: string
    readonly observedAt: IsoDateTime
    readonly row: Record<string, string>
  }>
} {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false
  const candidate = value as Record<string, JsonValue>
  return candidate.format === 'goodreads-library-export'
    && typeof candidate.latestRowHash === 'string'
    && Array.isArray(candidate.revisions)
    && candidate.revisions.every((revision) => {
      if (!revision || Array.isArray(revision) || typeof revision !== 'object') return false
      const item = revision as Record<string, JsonValue>
      return typeof item.rowHash === 'string'
        && typeof item.observedAt === 'string'
        && item.row !== null
        && !Array.isArray(item.row)
        && typeof item.row === 'object'
    })
}

async function findCanonicalEdition(
  record: NormalizedLibraryBook,
  targetBookId: string,
  index: ImportCatalogIndex,
): Promise<Edition | undefined> {
  const identifier = (record.identifiers ?? [])
    .flatMap((value) => canonicalEditionIsbn(value) ?? [])
    .map((isbn) => index.identifiersByIsbn.get(isbn)).find(Boolean)
  if (identifier?.owner.type === 'edition') {
    return index.get('edition', identifier.owner.id) as Edition | undefined
  }
  const legacyToken = (await sha256(targetBookId)).slice(0, 32)
  return (index.get('edition', `edition:legacy:${legacyToken}`)
    ?? index.get('edition', `edition:goodreads:${encodeToken(record.externalKey)}`)) as Edition | undefined
}

function mergeCatalog(catalog: Catalog, additions: Omit<Catalog, never>): Catalog {
  const replaceById = <Entity extends { readonly id: string }>(current: readonly Entity[], next: readonly Entity[]) => {
    const byId = new Map(current.map((entity) => [entity.id, entity]))
    next.forEach((entity) => byId.set(entity.id, entity))
    return [...byId.values()]
  }
  return {
    works: replaceById(catalog.works, additions.works),
    editions: replaceById(catalog.editions, additions.editions),
    assets: replaceById(catalog.assets, additions.assets),
    identifiers: replaceById(catalog.identifiers, additions.identifiers),
    sourceRecords: replaceById(catalog.sourceRecords, additions.sourceRecords),
    metadataOverrides: replaceById(catalog.metadataOverrides, additions.metadataOverrides),
    ownerships: replaceById(catalog.ownerships, additions.ownerships),
    loans: replaceById(catalog.loans, additions.loans),
    accessGrants: replaceById(catalog.accessGrants, additions.accessGrants),
    people: replaceById(catalog.people, additions.people),
    contributors: replaceById(catalog.contributors, additions.contributors),
    workParts: replaceById(catalog.workParts, additions.workParts),
    lists: replaceById(catalog.lists, additions.lists),
    listEntries: replaceById(catalog.listEntries, additions.listEntries),
    integrationCheckpoints: replaceById(catalog.integrationCheckpoints, additions.integrationCheckpoints),
    readingEvents: replaceById(catalog.readingEvents, additions.readingEvents),
    progressSnapshots: replaceById(catalog.progressSnapshots, additions.progressSnapshots),
  }
}

function readingEventLabel(event: ReadingEvent): string {
  if (event.kind === 'import') return 'Reading history import marker'
  return event.kind.replace(/(^|-)(\w)/g, (_match, _dash, character: string) => ` ${character.toUpperCase()}`).trim()
}

function humanShelfName(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function slugify(value: string): string {
  return normalizeText(value).replace(/\s+/g, '-') || 'shelf'
}

function encodeToken(value: string): string {
  return [...new TextEncoder().encode(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('') || 'empty'
}

function unique<Value>(values: readonly Value[]): Value[] {
  return [...new Set(values)]
}

function uniqueBy<Value>(values: readonly Value[], key: (value: Value) => string): Value[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const valueKey = key(value)
    if (seen.has(valueKey)) return false
    seen.add(valueKey)
    return true
  })
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
