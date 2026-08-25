import type { EditionId, PersonId, SourceClaimId, SourceRecordId, WorkId } from './ids'
import type { ResolvedMetadataValue, SourceClaim } from './metadata'
import { readingLedgerSchema, readingPositionsInEvent, type ReadingPosition } from './progress'
import type { CatalogRecords } from './records'
import { sameTarget, type EditionRef, type MetadataTarget, type WorkRef } from './shared'

export type AddInvariantIssue = (path: readonly (number | string)[], message: string) => void

export function validateCatalogInvariants(
  catalog: CatalogRecords,
  addIssue: AddInvariantIssue,
): void {
  const works = uniqueMap(catalog.works, 'works', addIssue)
  const editions = uniqueMap(catalog.editions, 'editions', addIssue)
  const assets = uniqueMap(catalog.assets, 'assets', addIssue)
  const sourceRecords = uniqueMap(catalog.sourceRecords, 'sourceRecords', addIssue)
  const ownerships = uniqueMap(catalog.ownerships, 'ownerships', addIssue)
  const loans = uniqueMap(catalog.loans, 'loans', addIssue)
  const people = uniqueMap(catalog.people, 'people', addIssue)
  const lists = uniqueMap(catalog.lists, 'lists', addIssue)
  const overrides = uniqueMap(catalog.metadataOverrides, 'metadataOverrides', addIssue)
  const integrationCheckpoints = new Map(
    catalog.integrationCheckpoints.map((checkpoint) => [checkpoint.id, checkpoint]),
  )
  const readingEvents = new Map(catalog.readingEvents.map((event) => [event.id, event]))

  uniqueMap(catalog.identifiers, 'identifiers', addIssue)
  uniqueMap(catalog.accessGrants, 'accessGrants', addIssue)
  uniqueMap(catalog.contributors, 'contributors', addIssue)
  uniqueMap(catalog.workParts, 'workParts', addIssue)
  uniqueMap(catalog.listEntries, 'listEntries', addIssue)
  uniqueMap(catalog.progressSnapshots, 'progressSnapshots', addIssue)

  const ledgerResult = readingLedgerSchema.safeParse({
    integrationCheckpoints: catalog.integrationCheckpoints,
    events: catalog.readingEvents,
  })
  if (!ledgerResult.success) {
    ledgerResult.error.issues.forEach((issue) => {
      const [collection, ...rest] = issue.path
      const safeRest = rest.filter((segment): segment is string | number => typeof segment !== 'symbol')
      addIssue(
        [collection === 'events' ? 'readingEvents' : String(collection), ...safeRest],
        issue.message,
      )
    })
  }

  const sourceClaims = new Map<
    SourceClaimId,
    { readonly recordId: SourceRecordId; readonly claim: SourceClaim }
  >()

  catalog.sourceRecords.forEach((record, recordIndex) => {
    record.claims.forEach((claim, claimIndex) => {
      const path = ['sourceRecords', recordIndex, 'claims', claimIndex] as const
      if (sourceClaims.has(claim.id)) addIssue([...path, 'id'], `Duplicate SourceClaim ID ${claim.id}`)
      sourceClaims.set(claim.id, { recordId: record.id, claim })
      validateMetadataTarget(claim.target, works, editions, people, path, addIssue)
    })

    record.observedIdentifiers.forEach((identifier, identifierIndex) => {
      if (identifier.target) {
        validateCatalogTarget(
          identifier.target,
          works,
          editions,
          ['sourceRecords', recordIndex, 'observedIdentifiers', identifierIndex, 'target'],
          addIssue,
        )
      }
    })
  })

  catalog.metadataOverrides.forEach((override, index) => {
    validateMetadataTarget(
      override.target,
      works,
      editions,
      people,
      ['metadataOverrides', index, 'target'],
      addIssue,
    )
  })

  catalog.works.forEach((work, index) => {
    const target = { type: 'work', id: work.id } as const
    validateResolved(work.title, target, 'work.title', ['works', index, 'title'])
    if (work.subtitle) validateResolved(work.subtitle, target, 'work.subtitle', ['works', index, 'subtitle'])
    if (work.description) validateResolved(work.description, target, 'work.description', ['works', index, 'description'])
    if (work.originalLanguage) {
      validateResolved(
        work.originalLanguage,
        target,
        'work.originalLanguage',
        ['works', index, 'originalLanguage'],
      )
    }
  })

  catalog.editions.forEach((edition, index) => {
    if (!works.has(edition.workId)) {
      addIssue(['editions', index, 'workId'], `Missing Work ${edition.workId}`)
    }
    const target = { type: 'edition', id: edition.id } as const
    validateResolved(edition.title, target, 'edition.title', ['editions', index, 'title'])
    validateResolved(edition.language, target, 'edition.language', ['editions', index, 'language'])
    if (edition.subtitle) validateResolved(edition.subtitle, target, 'edition.subtitle', ['editions', index, 'subtitle'])
    if (edition.publisher) validateResolved(edition.publisher, target, 'edition.publisher', ['editions', index, 'publisher'])
    if (edition.publicationDate) {
      validateResolved(
        edition.publicationDate,
        target,
        'edition.publicationDate',
        ['editions', index, 'publicationDate'],
      )
    }
    if (edition.medium === 'audiobook' && edition.durationMs) {
      validateResolved(
        edition.durationMs,
        target,
        'edition.durationMs',
        ['editions', index, 'durationMs'],
      )
    }
    if (edition.medium !== 'audiobook' && edition.pageCount) {
      validateResolved(
        edition.pageCount,
        target,
        'edition.pageCount',
        ['editions', index, 'pageCount'],
      )
    }

    if (edition.coverAssetId) {
      const cover = assets.get(edition.coverAssetId)
      if (!cover || cover.editionId !== edition.id || cover.role !== 'cover') {
        addIssue(
          ['editions', index, 'coverAssetId'],
          'An edition cover must reference a cover Asset belonging to that Edition',
        )
      }
    }
  })

  catalog.assets.forEach((asset, index) => {
    const edition = editions.get(asset.editionId)
    if (!edition) {
      addIssue(['assets', index, 'editionId'], `Missing Edition ${asset.editionId}`)
    }
    if (asset.location.kind === 'remote' && !sourceRecords.has(asset.location.sourceRecordId)) {
      addIssue(
        ['assets', index, 'location', 'sourceRecordId'],
        `Missing SourceRecord ${asset.location.sourceRecordId}`,
      )
    }
    if (asset.role === 'cover' && asset.format !== 'image') {
      addIssue(['assets', index, 'format'], 'A cover Asset must use the image format')
    }
    if (asset.role === 'content' && edition?.medium === 'print') {
      addIssue(
        ['assets', index, 'role'],
        'A digital content Asset requires an ebook or audiobook Edition',
      )
    }
    if (
      asset.role === 'content' &&
      edition?.medium === 'ebook' &&
      asset.format !== 'epub' &&
      asset.format !== 'pdf'
    ) {
      addIssue(['assets', index, 'format'], 'An ebook content Asset must be EPUB or PDF')
    }
    if (
      asset.role === 'content' &&
      edition?.medium === 'audiobook' &&
      asset.format !== 'm4b' &&
      asset.format !== 'mp3'
    ) {
      addIssue(['assets', index, 'format'], 'An audiobook content Asset must be M4B or MP3')
    }
  })

  const canonicalIdentifierKeys = new Set<string>()
  catalog.identifiers.forEach((identifier, index) => {
    validateCatalogTarget(identifier.owner, works, editions, ['identifiers', index, 'owner'], addIssue)
    const key = `${identifier.owner.type}:${identifier.owner.id}:${identifier.scheme}:${identifier.normalizedValue}`
    if (canonicalIdentifierKeys.has(key)) {
      addIssue(['identifiers', index], `Duplicate canonical Identifier ${key}`)
    }
    canonicalIdentifierKeys.add(key)
    identifier.sourceRecordIds.forEach((sourceRecordId, sourceIndex) => {
      const sourceRecord = sourceRecords.get(sourceRecordId)
      if (!sourceRecord) {
        addIssue(
          ['identifiers', index, 'sourceRecordIds', sourceIndex],
          `Missing SourceRecord ${sourceRecordId}`,
        )
      } else if (
        !sourceRecord.observedIdentifiers.some(
          (observed) =>
            observed.target?.type === identifier.owner.type &&
            observed.target.id === identifier.owner.id &&
            observed.scheme === identifier.scheme &&
            observed.normalizedValue === identifier.normalizedValue,
        )
      ) {
        addIssue(
          ['identifiers', index, 'sourceRecordIds', sourceIndex],
          'Supporting SourceRecord must contain the same identifier observation and owner',
        )
      }
    })
  })

  catalog.ownerships.forEach((ownership, index) => {
    if (!editions.has(ownership.editionId)) {
      addIssue(['ownerships', index, 'editionId'], `Missing Edition ${ownership.editionId}`)
    }
    validateOptionalSource(
      ownership.sourceRecordId,
      sourceRecords,
      ['ownerships', index, 'sourceRecordId'],
      addIssue,
    )
  })

  catalog.loans.forEach((loan, index) => {
    if (!editions.has(loan.editionId)) {
      addIssue(['loans', index, 'editionId'], `Missing Edition ${loan.editionId}`)
    }
    validateOptionalSource(
      loan.sourceRecordId,
      sourceRecords,
      ['loans', index, 'sourceRecordId'],
      addIssue,
    )
  })

  catalog.accessGrants.forEach((grant, index) => {
    if (!editions.has(grant.editionId)) {
      addIssue(['accessGrants', index, 'editionId'], `Missing Edition ${grant.editionId}`)
    }
    if (grant.basis === 'ownership') {
      const ownership = ownerships.get(grant.ownershipId)
      if (!ownership || ownership.editionId !== grant.editionId) {
        addIssue(
          ['accessGrants', index, 'ownershipId'],
          'Access must reference Ownership for the same Edition',
        )
      }
    }
    if (grant.basis === 'loan') {
      const loan = loans.get(grant.loanId)
      if (!loan || loan.editionId !== grant.editionId) {
        addIssue(
          ['accessGrants', index, 'loanId'],
          'Access must reference a Loan for the same Edition',
        )
      }
    }
    if (grant.basis === 'subscription' && !sourceRecords.has(grant.sourceRecordId)) {
      addIssue(
        ['accessGrants', index, 'sourceRecordId'],
        `Missing SourceRecord ${grant.sourceRecordId}`,
      )
    }
  })

  catalog.people.forEach((person, index) => {
    const target = { type: 'person', id: person.id } as const
    validateResolved(
      person.displayName,
      target,
      'person.displayName',
      ['people', index, 'displayName'],
    )
    if (person.sortName) {
      validateResolved(person.sortName, target, 'person.sortName', ['people', index, 'sortName'])
    }
  })

  catalog.contributors.forEach((contributor, index) => {
    if (!people.has(contributor.personId)) {
      addIssue(['contributors', index, 'personId'], `Missing Person ${contributor.personId}`)
    }
    validateCatalogTarget(
      contributor.target,
      works,
      editions,
      ['contributors', index, 'target'],
      addIssue,
    )
  })

  catalog.workParts.forEach((part, index) => {
    const container = works.get(part.containerWorkId)
    if (!container) {
      addIssue(['workParts', index, 'containerWorkId'], `Missing Work ${part.containerWorkId}`)
    } else if (container.kind === 'single') {
      addIssue(
        ['workParts', index, 'containerWorkId'],
        'A WorkPart container must be an anthology or collection',
      )
    }
    if (!works.has(part.workId)) {
      addIssue(['workParts', index, 'workId'], `Missing Work ${part.workId}`)
    }
  })

  catalog.readingEvents.forEach((event, index) => {
    const edition = editions.get(event.editionId)
    if (!edition) {
      addIssue(['readingEvents', index, 'editionId'], `Missing Edition ${event.editionId}`)
      return
    }
    if (event.assetId) {
      const asset = assets.get(event.assetId)
      if (!asset || asset.editionId !== event.editionId) {
        addIssue(
          ['readingEvents', index, 'assetId'],
          'Reading event Asset must belong to the same Edition',
        )
      }
    }
    if (event.source.kind === 'integration' && event.source.sourceRecordId) {
      validateOptionalSource(
        event.source.sourceRecordId,
        sourceRecords,
        ['readingEvents', index, 'source', 'sourceRecordId'],
        addIssue,
      )
    }
    if (
      event.integrationCheckpointId &&
      !integrationCheckpoints.has(event.integrationCheckpointId)
    ) {
      addIssue(
        ['readingEvents', index, 'integrationCheckpointId'],
        `Missing integration checkpoint ${event.integrationCheckpointId}`,
      )
    }
    readingPositionsInEvent(event).forEach((position, positionIndex) => {
      validateReadingPosition(
        position,
        edition,
        ['readingEvents', index, 'positions', positionIndex],
        addIssue,
      )
    })
  })

  catalog.progressSnapshots.forEach((progress, index) => {
    const edition = editions.get(progress.editionId)
    if (!edition) {
      addIssue(['progressSnapshots', index, 'editionId'], `Missing Edition ${progress.editionId}`)
      return
    }
    if (progress.assetId) {
      const asset = assets.get(progress.assetId)
      if (!asset || asset.editionId !== progress.editionId) {
        addIssue(
          ['progressSnapshots', index, 'assetId'],
          'Progress Asset must belong to the same Edition',
        )
      }
    }
    if (progress.position) {
      validateReadingPosition(
        progress.position,
        edition,
        ['progressSnapshots', index, 'position'],
        addIssue,
      )
    }
    if (progress.sourceEventId) {
      const sourceEvent = readingEvents.get(progress.sourceEventId)
      if (!sourceEvent || sourceEvent.editionId !== progress.editionId) {
        addIssue(
          ['progressSnapshots', index, 'sourceEventId'],
          'Progress snapshot source must be a reading event for the same Edition',
        )
      }
    }
  })

  const listSlugs = new Set<string>()
  catalog.lists.forEach((list, index) => {
    if (listSlugs.has(list.slug)) {
      addIssue(['lists', index, 'slug'], `Duplicate List slug ${list.slug}`)
    }
    listSlugs.add(list.slug)
  })

  const listPositions = new Set<string>()
  const listWorks = new Set<string>()
  catalog.listEntries.forEach((entry, index) => {
    if (!lists.has(entry.listId)) {
      addIssue(['listEntries', index, 'listId'], `Missing List ${entry.listId}`)
    }
    if (!works.has(entry.workId)) {
      addIssue(['listEntries', index, 'workId'], `Missing Work ${entry.workId}`)
    }
    const positionKey = `${entry.listId}:${entry.position}`
    if (listPositions.has(positionKey)) {
      addIssue(
        ['listEntries', index, 'position'],
        `Duplicate position ${entry.position} in List ${entry.listId}`,
      )
    }
    listPositions.add(positionKey)
    const workKey = `${entry.listId}:${entry.workId}`
    if (listWorks.has(workKey)) {
      addIssue(['listEntries', index, 'workId'], `Work ${entry.workId} already belongs to this List`)
    }
    listWorks.add(workKey)
  })

  function validateResolved(
    resolved: ResolvedMetadataValue,
    expectedTarget: MetadataTarget,
    expectedField: ResolvedMetadataValue['candidate']['field'],
    path: readonly (number | string)[],
  ) {
    if (
      !sameTarget(resolved.candidate.target, expectedTarget) ||
      resolved.candidate.field !== expectedField
    ) {
      addIssue(path, `Metadata candidate must target ${expectedTarget.id} field ${expectedField}`)
    }
    if (resolved.candidate.kind === 'source') {
      const match = sourceClaims.get(resolved.candidate.claimId)
      if (
        !match ||
        match.recordId !== resolved.candidate.sourceRecordId ||
        !sameTarget(match.claim.target, expectedTarget) ||
        match.claim.field !== expectedField ||
        JSON.stringify(match.claim.value) !== JSON.stringify(resolved.candidate.value) ||
        match.claim.observedAt !== resolved.candidate.observedAt ||
        match.claim.confidence !== resolved.candidate.confidence
      ) {
        addIssue(path, 'Source metadata must reference a matching SourceRecord claim')
      }
    }
    if (resolved.userOverride) {
      const storedOverride = overrides.get(resolved.userOverride.id)
      if (
        !storedOverride ||
        !sameTarget(storedOverride.target, expectedTarget) ||
        storedOverride.field !== expectedField ||
        JSON.stringify(storedOverride.value) !== JSON.stringify(resolved.userOverride.value)
      ) {
        addIssue(path, 'Resolved metadata must reference its stored user override')
      }
    }
  }
}

function validateReadingPosition(
  position: ReadingPosition,
  edition: CatalogRecords['editions'][number],
  path: readonly (number | string)[],
  addIssue: AddInvariantIssue,
): void {
  const { locator } = position
  if (locator.kind === 'audio-time' && edition.medium !== 'audiobook') {
    addIssue(path, 'Audio-time progress requires an audiobook Edition')
  }
  if (locator.kind === 'epub' && edition.medium !== 'ebook') {
    addIssue(path, 'EPUB progress requires an ebook Edition')
  }
  if (locator.kind === 'page' && edition.medium === 'audiobook') {
    addIssue(path, 'Page progress requires a print or ebook Edition')
  }
  if (
    locator.kind === 'audio-time' &&
    edition.medium === 'audiobook' &&
    edition.durationMs &&
    locator.positionMs > edition.durationMs.value
  ) {
    addIssue(path, 'Audio progress exceeds Edition duration')
  }
  if (
    locator.kind === 'page' &&
    edition.medium !== 'audiobook' &&
    edition.pageCount &&
    locator.page > edition.pageCount.value
  ) {
    addIssue(path, 'Page progress exceeds Edition page count')
  }
}

function uniqueMap<Entity extends { readonly id: string }>(
  entities: readonly Entity[],
  collectionName: string,
  addIssue: AddInvariantIssue,
): Map<Entity['id'], Entity> {
  const result = new Map<Entity['id'], Entity>()
  entities.forEach((entity, index) => {
    if (result.has(entity.id)) addIssue([collectionName, index, 'id'], `Duplicate ID ${entity.id}`)
    result.set(entity.id, entity)
  })
  return result
}

function validateMetadataTarget(
  target: MetadataTarget,
  works: ReadonlyMap<WorkId, unknown>,
  editions: ReadonlyMap<EditionId, unknown>,
  people: ReadonlyMap<PersonId, unknown>,
  path: readonly (number | string)[],
  addIssue: AddInvariantIssue,
) {
  if (target.type === 'work' && !works.has(target.id)) addIssue(path, `Missing Work ${target.id}`)
  if (target.type === 'edition' && !editions.has(target.id)) {
    addIssue(path, `Missing Edition ${target.id}`)
  }
  if (target.type === 'person' && !people.has(target.id)) addIssue(path, `Missing Person ${target.id}`)
}

function validateCatalogTarget(
  target: WorkRef | EditionRef,
  works: ReadonlyMap<WorkId, unknown>,
  editions: ReadonlyMap<EditionId, unknown>,
  path: readonly (number | string)[],
  addIssue: AddInvariantIssue,
) {
  if (target.type === 'work' && !works.has(target.id)) addIssue(path, `Missing Work ${target.id}`)
  if (target.type === 'edition' && !editions.has(target.id)) {
    addIssue(path, `Missing Edition ${target.id}`)
  }
}

function validateOptionalSource(
  sourceRecordId: SourceRecordId | undefined,
  sourceRecords: ReadonlyMap<SourceRecordId, unknown>,
  path: readonly (number | string)[],
  addIssue: AddInvariantIssue,
) {
  if (sourceRecordId && !sourceRecords.has(sourceRecordId)) {
    addIssue(path, `Missing SourceRecord ${sourceRecordId}`)
  }
}
