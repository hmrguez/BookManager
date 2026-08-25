import { describe, expect, test } from 'bun:test'
import {
  catalogSchema,
  contributorIdSchema,
  createWorkSplitOperation,
  editionIdSchema,
  identifierIdSchema,
  listEntryIdSchema,
  listIdSchema,
  metadataCandidateValueSchema,
  readingEventIdSchema,
  resolveMetadataField,
  workIdSchema,
  type Catalog,
  type JsonValue,
  type MetadataField,
  type MetadataTarget,
} from '../src/domain/catalog'
import { detectDuplicateWorks, previewWorkMerge } from '../src/duplicates'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { DuplicateReviewRepository } from '../src/storage/duplicate-review-repository'
import { migrateStorage } from '../src/storage/migrations'
import { fixtureIds, representativeCatalog } from './fixtures/catalog'
import { BunSqliteDatabase } from './storage-test-database'

const timestamp = '2026-08-26T10:00:00.000Z'
const duplicateWorkId = workIdSchema.parse('work:left-hand-imported-copy')
const duplicateEditionId = editionIdSchema.parse('edition:left-hand-imported-paperback')

describe('explainable duplicate candidate generation', () => {
  test('uses fuzzy search for recall while identifiers and contributors explain confidence', () => {
    const catalog = catalogWithDuplicate({ title: 'The Left Hand of Darknes', exactIsbn: true })
    const scan = detectDuplicateWorks(catalog)
    const candidate = scan.review.find(({ pairKey }) =>
      pairKey.includes(encodeURIComponent(duplicateWorkId)),
    )

    expect(candidate).toMatchObject({
      confidence: 'high',
      requiresReview: true,
      reviewPriority: 'review',
    })
    expect(candidate?.evidence.map(({ kind }) => kind)).toEqual(expect.arrayContaining([
      'identifier',
      'title',
      'contributors',
      'format-caution',
    ]))
    expect(catalog.editions.find(({ id }) => id === duplicateEditionId)?.medium).toBe('print')
    expect(catalog.editions.find(({ id }) => id === fixtureIds.editions.leftHandEbook)?.workId)
      .toBe(fixtureIds.works.leftHand)
  })

  test('keeps title-only uncertainty in a quiet background queue', () => {
    const catalog = catalogWithDuplicate({
      title: 'The Left Hand of Darkness',
      exactIsbn: false,
      includeContributor: false,
      includeOriginalLanguage: false,
      shareSources: false,
    })
    const scan = detectDuplicateWorks(catalog)

    expect(scan.review.some(({ leftWorkId, rightWorkId }) =>
      leftWorkId === duplicateWorkId || rightWorkId === duplicateWorkId,
    )).toBe(false)
    expect(scan.background).toContainEqual(expect.objectContaining({
      confidence: 'low',
      reviewPriority: 'background',
      requiresReview: true,
    }))
  })

  test('honors durable keep, relation, and never-suggest decisions without deleting evidence', () => {
    const catalog = catalogWithDuplicate({ title: 'The Left Hand of Darkness', exactIsbn: true })
    const initial = detectDuplicateWorks(catalog)
    const candidate = initial.review.find(({ leftWorkId, rightWorkId }) =>
      leftWorkId === duplicateWorkId || rightWorkId === duplicateWorkId,
    )!
    const suppressed = detectDuplicateWorks(catalog, [{
      id: 'duplicate-decision:left-hand-separate',
      pairKey: candidate.pairKey,
      leftWorkId: candidate.leftWorkId,
      rightWorkId: candidate.rightWorkId,
      action: 'never-suggest',
      decidedAt: timestamp,
      rationale: 'Reader confirmed these are distinct adaptations.',
    }])

    expect(suppressed.suppressedPairs).toBeGreaterThanOrEqual(1)
    expect([...suppressed.review, ...suppressed.background]).not.toContainEqual(
      expect.objectContaining({ pairKey: candidate.pairKey }),
    )
    expect(catalog.identifiers).toHaveLength(catalogWithDuplicate({
      title: 'The Left Hand of Darkness', exactIsbn: true,
    }).identifiers.length)
  })
})

describe('merge preview and reversible repository', () => {
  test('previews every reader-owned destination before changing identity', () => {
    const catalog = catalogWithDuplicate({ title: 'The Left Hand of Darkness', exactIsbn: true })
    const preview = previewWorkMerge(catalog, fixtureIds.works.leftHand, duplicateWorkId)

    expect(preview.moving).toMatchObject({
      editions: 2,
      assets: 4,
      progress: 2,
      annotations: 1,
      listMemberships: 2,
      ownerships: 1,
      sources: 2,
    })
    expect(preview.listChanges.map(({ kind }) => kind).sort()).toEqual(['consolidate', 'move'])
    expect(preview.destinationAfter.editions).toBe(3)
    expect(preview.editions.every(({ toWorkId }) => toWorkId === duplicateWorkId)).toBe(true)
    expect(preview.assurances.join(' ')).toContain('journaled')
  })

  test('merges and undoes editions, lists, progress, annotations, loans, assets, and sources exactly', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const catalogRepository = new CatalogRepository(database)
    await catalogRepository.replace(catalogWithDuplicate({
      title: 'The Left Hand of Darkness',
      exactIsbn: true,
    }))
    const before = await catalogRepository.read()
    let sequence = 0
    const duplicates = new DuplicateReviewRepository(database, {
      now: () => new Date(timestamp),
      createId: (kind) => `${kind === 'decision' ? 'duplicate-decision' : 'identity-operation'}:test-${++sequence}`,
    })

    const result = await duplicates.mergeWorks({
      absorbedWorkId: fixtureIds.works.leftHand,
      survivingWorkId: duplicateWorkId,
      rationale: 'Reader reviewed the title, author, ISBN, formats, and destination preview.',
    })
    const merged = await catalogRepository.read()
    const movedEditionIds = new Set(result.journal.operation.editionIds)

    expect(merged.editions.filter(({ id }) => movedEditionIds.has(id)).every(
      ({ workId }) => workId === duplicateWorkId,
    )).toBe(true)
    expect(merged.assets).toEqual(before.assets)
    expect(merged.readingEvents).toEqual(before.readingEvents)
    expect(merged.progressSnapshots).toEqual(before.progressSnapshots)
    expect(merged.loans).toEqual(before.loans)
    expect(merged.ownerships).toEqual(before.ownerships)
    expect(merged.sourceRecords).toEqual(before.sourceRecords)
    expect(merged.listEntries.filter(({ workId }) => workId === duplicateWorkId)).toHaveLength(2)
    expect((await duplicates.listDecisions()).at(-1)).toMatchObject({ action: 'merge' })

    await duplicates.undoOperation(result.journal.operation.id)
    expect(await catalogRepository.read()).toEqual(before)
    expect((await duplicates.listOperations()).at(-1)).toMatchObject({ status: 'undone' })
    expect((await duplicates.listDecisions()).at(-1)?.undoneAt).toBe(timestamp)
    await database.close()
  })

  test('applies split and reassignment operations with compare-and-swap undo', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const catalogRepository = new CatalogRepository(database)
    await catalogRepository.replace(catalogWithDuplicate({
      title: 'The Left Hand of Darkness',
      exactIsbn: false,
    }))
    const before = await catalogRepository.read()
    const duplicates = new DuplicateReviewRepository(database, { now: () => new Date(timestamp) })
    const operation = createWorkSplitOperation(
      [duplicateEditionId],
      duplicateWorkId,
      fixtureIds.works.leftHand,
      {
        id: 'identity-operation:split-imported-paperback',
        recordedAt: timestamp,
        rationale: 'The paperback was assigned to the wrong imported Work.',
      },
    )

    await duplicates.applyOperation(operation)
    expect((await catalogRepository.read()).editions.find(({ id }) => id === duplicateEditionId)?.workId)
      .toBe(fixtureIds.works.leftHand)
    await duplicates.undoOperation(operation.id)
    expect(await catalogRepository.read()).toEqual(before)
    await database.close()
  })

  test('keeps a never-suggest choice local and undoable', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await new CatalogRepository(database).replace(catalogWithDuplicate({
      title: 'The Left Hand of Darkness',
      exactIsbn: true,
    }))
    const duplicates = new DuplicateReviewRepository(database, {
      now: () => new Date(timestamp),
      createId: () => 'duplicate-decision:never-left-hand',
    })
    const before = await duplicates.scan()
    const decision = await duplicates.recordDecision({
      leftWorkId: fixtureIds.works.leftHand,
      rightWorkId: duplicateWorkId,
      action: 'never-suggest',
      rationale: 'Confirmed as distinct.',
    })

    expect((await duplicates.scan()).review.length).toBeLessThan(before.review.length)
    await duplicates.undoDecision(decision.id)
    expect((await duplicates.scan()).review.length).toBe(before.review.length)
    await database.close()
  })
})

type DuplicateOptions = {
  readonly title: string
  readonly exactIsbn: boolean
  readonly includeContributor?: boolean
  readonly includeOriginalLanguage?: boolean
  readonly shareSources?: boolean
}

function catalogWithDuplicate(options: DuplicateOptions): Catalog {
  const workTarget = { type: 'work', id: duplicateWorkId } as const
  const editionTarget = { type: 'edition', id: duplicateEditionId } as const
  const shareSources = options.shareSources ?? options.exactIsbn
  const sourceRecords = shareSources
    ? representativeCatalog.sourceRecords.map((source) => {
      if (source.id !== fixtureIds.sources.google && source.id !== fixtureIds.sources.openLibrary) {
        return source
      }
      return {
        ...source,
        observedIdentifiers: [...source.observedIdentifiers, {
          target: editionTarget,
          scheme: 'isbn-13' as const,
          value: '978-0-441-47812-5',
          normalizedValue: '9780441478125',
          confidence: 0.98,
        }],
      }
    })
    : representativeCatalog.sourceRecords
  const note = {
    id: readingEventIdSchema.parse('reading-event:left-hand-ebook:note'),
    kind: 'note' as const,
    text: 'Identity must not detach this annotation.',
    editionId: fixtureIds.editions.leftHandEbook,
    assetId: fixtureIds.assets.leftHandEpub,
    source: { kind: 'local' as const, method: 'manual' as const },
    deviceId: representativeCatalog.readingEvents[0]!.deviceId,
    observedAt: timestamp,
    effectiveAt: timestamp,
    recordedAt: timestamp,
    timeConfidence: 1,
  }
  const readingListId = listIdSchema.parse('list:reading-queue')
  const favoritesListId = listIdSchema.parse('list:favorites')

  return catalogSchema.parse({
    ...representativeCatalog,
    works: [...representativeCatalog.works, {
      id: duplicateWorkId,
      kind: 'single',
      title: localField(workTarget, 'work.title', options.title),
      originalLanguage: options.includeOriginalLanguage === false
        ? undefined
        : localField(workTarget, 'work.originalLanguage', 'en'),
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    editions: [...representativeCatalog.editions, {
      id: duplicateEditionId,
      workId: duplicateWorkId,
      medium: 'print',
      binding: 'paperback',
      title: localField(editionTarget, 'edition.title', options.title),
      language: localField(editionTarget, 'edition.language', 'en'),
      publisher: localField(editionTarget, 'edition.publisher', 'Ace Books'),
      publicationDate: localField(editionTarget, 'edition.publicationDate', '2010'),
      pageCount: localField(editionTarget, 'edition.pageCount', 304),
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    identifiers: options.exactIsbn ? [...representativeCatalog.identifiers, {
      id: identifierIdSchema.parse('identifier:left-hand-imported:isbn13'),
      owner: editionTarget,
      scheme: 'isbn-13',
      value: '978-0-441-47812-5',
      normalizedValue: '9780441478125',
      sourceRecordIds: shareSources
        ? [fixtureIds.sources.google, fixtureIds.sources.openLibrary]
        : [],
      createdAt: timestamp,
    }] : representativeCatalog.identifiers,
    sourceRecords,
    contributors: options.includeContributor === false
      ? representativeCatalog.contributors
      : [...representativeCatalog.contributors, {
        id: contributorIdSchema.parse('contributor:left-hand-imported:author'),
        personId: fixtureIds.people.leGuin,
        target: workTarget,
        role: 'author',
        creditedAs: 'Ursula K. Le Guin',
        position: 0,
      }],
    lists: [...representativeCatalog.lists, {
      id: readingListId,
      kind: 'custom',
      slug: 'reading-queue',
      name: 'Reading queue',
      createdAt: timestamp,
      updatedAt: timestamp,
    }, {
      id: favoritesListId,
      kind: 'custom',
      slug: 'favorites',
      name: 'Favorites',
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    listEntries: [...representativeCatalog.listEntries, {
      id: listEntryIdSchema.parse('list-entry:reading:left-hand-original'),
      listId: readingListId,
      workId: fixtureIds.works.leftHand,
      position: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }, {
      id: listEntryIdSchema.parse('list-entry:reading:left-hand-imported'),
      listId: readingListId,
      workId: duplicateWorkId,
      position: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }, {
      id: listEntryIdSchema.parse('list-entry:favorites:left-hand-original'),
      listId: favoritesListId,
      workId: fixtureIds.works.leftHand,
      position: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    readingEvents: [...representativeCatalog.readingEvents, note],
  })
}

function localField<Value extends JsonValue>(
  target: MetadataTarget,
  field: MetadataField,
  value: Value,
) {
  return resolveMetadataField(metadataCandidateValueSchema.parse({
    kind: 'local',
    target,
    field,
    value,
    recordedAt: timestamp,
    method: 'manual-entry',
  }))
}
