import { describe, expect, test } from 'bun:test'
import {
  accessStateAt,
  catalogSchema,
  reparentEditionsForWorkMerge,
  workIdSchema,
} from '../src/domain/catalog'
import { fixtureIds, representativeCatalog } from './fixtures/catalog'

describe('canonical catalog model', () => {
  test('round-trips every representative fixture through the aggregate Zod schema', () => {
    expect(catalogSchema.parse(representativeCatalog)).toEqual(representativeCatalog)
  })

  test('keeps one canonical ISBN when two sources report the same normalized value', () => {
    const identifiers = representativeCatalog.identifiers.filter(
      ({ normalizedValue }) => normalizedValue === '9780441478125',
    )
    const observations = representativeCatalog.sourceRecords.flatMap((record) =>
      record.observedIdentifiers
        .filter(({ normalizedValue }) => normalizedValue === '9780441478125')
        .map((identifier) => ({ recordId: record.id, identifier })),
    )

    expect(identifiers).toHaveLength(1)
    expect(identifiers[0]?.sourceRecordIds).toEqual([
      fixtureIds.sources.google,
      fixtureIds.sources.openLibrary,
    ])
    expect(observations).toHaveLength(2)
    expect(observations.every(({ identifier }) => identifier.target?.id === fixtureIds.editions.leftHandEbook)).toBe(true)
  })

  test('keeps ebook and audiobook progress independent under the same Work', () => {
    const ebook = representativeCatalog.progressSnapshots.find(
      ({ editionId }) => editionId === fixtureIds.editions.leftHandEbook,
    )
    const audio = representativeCatalog.progressSnapshots.find(
      ({ editionId }) => editionId === fixtureIds.editions.leftHandAudio,
    )
    const editions = representativeCatalog.editions.filter(
      ({ workId }) => workId === fixtureIds.works.leftHand,
    )

    expect(editions.map(({ medium }) => medium).sort()).toEqual(['audiobook', 'ebook'])
    expect(ebook).toMatchObject({
      locator: { kind: 'epub' },
      normalizedProgress: 0.42,
    })
    expect(audio).toMatchObject({
      locator: { kind: 'audio-time' },
      normalizedProgress: 0.2,
    })
  })

  test('models translation language and translator on the Edition, not the Work', () => {
    const work = representativeCatalog.works.find(
      ({ id }) => id === fixtureIds.works.masterAndMargarita,
    )
    const edition = representativeCatalog.editions.find(
      ({ id }) => id === fixtureIds.editions.translated,
    )
    const translator = representativeCatalog.contributors.find(
      ({ role }) => role === 'translator',
    )

    expect(work?.originalLanguage?.value).toBe('ru')
    expect(edition?.language.value).toBe('en')
    expect(translator?.target).toEqual({
      type: 'edition',
      id: fixtureIds.editions.translated,
    })
  })

  test('represents an anthology as an ordered relationship between Works', () => {
    const anthology = representativeCatalog.works.find(
      ({ id }) => id === fixtureIds.works.anthology,
    )
    const parts = representativeCatalog.workParts
      .filter(({ containerWorkId }) => containerWorkId === fixtureIds.works.anthology)
      .sort((left, right) => left.position - right.position)

    expect(anthology?.kind).toBe('anthology')
    expect(parts.map(({ workId }) => workId)).toEqual([
      fixtureIds.works.anthologyStoryOne,
      fixtureIds.works.anthologyStoryTwo,
    ])
  })

  test('accepts an Edition without inventing an ISBN', () => {
    const identifiers = representativeCatalog.identifiers.filter(
      ({ owner }) =>
        owner.type === 'edition' && owner.id === fixtureIds.editions.missingIsbn,
    )

    expect(identifiers).toEqual([])
  })

  test('derives Libby access from the Loan expiry instead of copying status fields', () => {
    const grant = representativeCatalog.accessGrants.find(({ basis }) => basis === 'loan')
    if (!grant) throw new Error('Expected the Libby access fixture')

    expect(
      accessStateAt(
        grant,
        representativeCatalog.ownerships,
        representativeCatalog.loans,
        '2026-09-01T09:59:59.999Z',
      ),
    ).toBe('available')
    expect(
      accessStateAt(
        grant,
        representativeCatalog.ownerships,
        representativeCatalog.loans,
        '2026-09-01T10:00:00.000Z',
      ),
    ).toBe('expired')
  })

  test('retains provider metadata while an explicit user correction wins', () => {
    const corrected = representativeCatalog.works.find(
      ({ id }) => id === fixtureIds.works.corrected,
    )

    expect(corrected?.title).toMatchObject({
      value: 'Piranesi',
      winner: 'user-override',
      candidate: { kind: 'source', value: 'Piranezi', confidence: 0.74 },
      userOverride: { value: 'Piranesi' },
    })
    expect(representativeCatalog.sourceRecords).toContainEqual(
      expect.objectContaining({ id: fixtureIds.sources.incorrectMetadata }),
    )
  })

  test('reparents whole Editions during a Work merge without erasing edition data', () => {
    const absorbedWorkId = workIdSchema.parse('work:left-hand-duplicate')
    const editionsBeforeMerge = representativeCatalog.editions
      .filter(({ workId }) => workId === fixtureIds.works.leftHand)
      .map((edition) => ({ ...edition, workId: absorbedWorkId }))
    const editionsAfterMerge = reparentEditionsForWorkMerge(
      editionsBeforeMerge,
      absorbedWorkId,
      fixtureIds.works.leftHand,
    )

    expect(editionsAfterMerge).toEqual(
      editionsBeforeMerge.map((edition) => ({
        ...edition,
        workId: fixtureIds.works.leftHand,
      })),
    )
    expect(editionsAfterMerge.find(({ medium }) => medium === 'ebook')).toMatchObject({
      pageCount: { value: 304 },
      language: { value: 'en' },
      coverAssetId: fixtureIds.assets.leftHandEbookCover,
    })
    expect(editionsAfterMerge.find(({ medium }) => medium === 'audiobook')).toMatchObject({
      durationMs: { value: 35_820_000 },
      language: { value: 'en' },
      coverAssetId: fixtureIds.assets.leftHandAudioCover,
    })

    const movedEditionIds = new Set(editionsAfterMerge.map(({ id }) => id))
    expect(
      representativeCatalog.identifiers.some(
        ({ owner }) => owner.type === 'edition' && movedEditionIds.has(owner.id),
      ),
    ).toBe(true)
    expect(
      representativeCatalog.assets.filter(({ editionId }) => movedEditionIds.has(editionId)),
    ).not.toHaveLength(0)
    expect(
      representativeCatalog.contributors.some(
        ({ role, target }) =>
          role === 'narrator' && target.type === 'edition' && movedEditionIds.has(target.id),
      ),
    ).toBe(true)
  })

  test('rejects a format locator attached to the wrong Edition medium', () => {
    const invalidCatalog = {
      ...representativeCatalog,
      progressSnapshots: representativeCatalog.progressSnapshots.map((progress) =>
        progress.editionId === fixtureIds.editions.leftHandAudio
          ? { ...progress, locator: { kind: 'epub', locator: 'epubcfi(/6/2)' } }
          : progress,
      ),
    }

    expect(() => catalogSchema.parse(invalidCatalog)).toThrow(
      'EPUB progress requires an ebook Edition',
    )
  })
})
