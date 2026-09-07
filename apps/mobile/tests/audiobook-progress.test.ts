import { describe, expect, test } from 'bun:test'
import {
  assetIdSchema,
  editionIdSchema,
  readingDeviceIdSchema,
  readingEventIdSchema,
  readingEventSchema,
} from '../src/domain/catalog'
import { CatalogRepository, ReadingLedgerRepository } from '../src/storage/catalog-repository'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage } from '../src/storage/migrations'
import {
  AUDIOBOOK_PLAYBACK_BRIDGE_VERSION,
  playbackSnapshotSchema,
  type NativePlaybackEvent,
  type PlaybackSnapshot,
} from '../src/playback/model'
import { AudiobookProgressRepository } from '../src/playback/progress'
import { representativeCatalog, fixtureIds } from './fixtures/catalog'
import { BunSqliteDatabase } from './storage-test-database'

const durationMs = 35_820_000
const queueId = 'queue:audiobook-progress-test'
const bookId = 'book:audiobook-progress-test'

describe('audiobook progress and listening sessions', () => {
  test('opening and configuring an unplayed audiobook keeps it on its original shelf', async () => {
    const database = await progressDatabase()
    const repository = new AudiobookProgressRepository(database)
    await repository.checkpointSnapshot(playbackSnapshot({ state: 'paused', playIntent: false }), true)
    await repository.ingestJournal([
      playbackEvent('rate-change', 2, '2026-08-29T12:00:01.000Z', 0, 0, 1.5),
      playbackEvent('seek', 3, '2026-08-29T12:00:02.000Z', 15_000, 0, 1.5, 0),
    ])
    const [book] = await new LibraryRepository(database).list()
    expect(book).toMatchObject({ shelf: 'tbr', progress: 0 })
    expect(book?.startedAt).toBeUndefined()
    await database.close()
  })

  test('play at zero starts reading and checkpoints update library and canonical progress before pause', async () => {
    const database = await progressDatabase()
    const repository = new AudiobookProgressRepository(database)
    const startedAt = '2026-08-29T12:00:00.000Z'
    await repository.ingestJournal([playbackEvent('play', 1, startedAt, 0, 0, 1)])
    expect((await new LibraryRepository(database).list())[0]).toMatchObject({
      shelf: 'reading', progress: 0, startedAt,
    })

    const current = playbackSnapshot({
      playbackSessionId: 'session:listening', revision: 2,
      absolutePositionMs: durationMs / 4, activeDurationMs: 30_000,
      observedAt: '2026-08-29T12:00:30.000Z',
    })
    await repository.checkpointSnapshot(current)
    expect((await new LibraryRepository(database).list())[0]).toMatchObject({
      shelf: 'reading', progress: 25, startedAt,
    })
    const ledger = await new ReadingLedgerRepository(database).read()
    const catalog = await new CatalogRepository(database).read()
    expect(catalog.progressSnapshots.find(({ id }) => id === `progress:audio:${fixtureIds.assets.leftHandM4b}`)).toMatchObject({
      status: 'reading', normalizedProgress: 0.25,
      position: { locator: { kind: 'audio-time', positionMs: durationMs / 4 } },
    })
    expect(await new AudiobookProgressRepository(database).resolvePositionForBook(bookId)).toMatchObject({
      status: 'resolved', positionMs: durationMs / 4,
    })
    await repository.checkpointSnapshot(current, true)
    expect((await new ReadingLedgerRepository(database).read()).events).toHaveLength(ledger.events.length)

    await repository.ingestJournal([
      playbackEvent('seek', 3, '2026-08-29T12:00:31.000Z', durationMs / 10, 30_000, 1, durationMs / 4),
      playbackEvent('pause', 4, '2026-08-29T12:00:32.000Z', durationMs / 10, 30_000, 1),
    ])
    expect((await new LibraryRepository(database).list())[0]).toMatchObject({
      shelf: 'reading', progress: 10, startedAt,
    })
    const pausedLedger = await new ReadingLedgerRepository(database).read()
    expect(pausedLedger.events.find(({ kind }) => kind === 'session')).toMatchObject({ activeDurationMs: 30_000 })
    await database.close()
  })

  test('recovered playback leaves explicitly finished books finished', async () => {
    const database = await progressDatabase()
    const library = new LibraryRepository(database)
    const book = (await library.list())[0]!
    await library.save({ ...book, shelf: 'finished', progress: 100, finishedAt: book.lastUpdatedAt })
    await new AudiobookProgressRepository(database).checkpointSnapshot(playbackSnapshot({
      state: 'paused', playIntent: false, activeDurationMs: 20_000,
      absolutePositionMs: durationMs / 2, suppressionReason: 'process-recreated',
    }), true)
    expect((await library.list())[0]).toMatchObject({ shelf: 'finished', progress: 100 })
    await database.close()
  })

  test('uses active wall time for sessions while seeks and speed affect only media progress', async () => {
    const database = await progressDatabase()
    const repository = new AudiobookProgressRepository(database, {
      now: () => new Date('2026-08-29T10:02:00.000Z'),
    })
    const events = [
      playbackEvent('play', 1, '2026-08-29T10:00:00.000Z', 1_000, 0, 1),
      playbackEvent('rate-change', 2, '2026-08-29T10:00:20.000Z', 31_000, 15_000, 2),
      playbackEvent('seek', 3, '2026-08-29T10:00:25.000Z', 300_000, 20_000, 2, 31_000),
      playbackEvent('pause', 4, '2026-08-29T10:01:00.000Z', 370_000, 40_000, 2),
    ]

    expect(await repository.ingestJournal(events)).toEqual(events.map(({ id }) => id))
    const ledger = await new ReadingLedgerRepository(database).read()
    const sessions = ledger.events.filter(
      (event) => event.editionId === fixtureIds.editions.leftHandAudio && event.kind === 'session',
    )
    const session = sessions.at(-1)

    expect(session).toMatchObject({
      kind: 'session',
      startedAt: '2026-08-29T10:00:00.000Z',
      endedAt: '2026-08-29T10:01:00.000Z',
      activeDurationMs: 40_000,
      startPosition: { locator: { kind: 'audio-time', positionMs: 1_000 } },
      endPosition: { locator: { kind: 'audio-time', positionMs: 370_000 } },
    })
    expect(session?.kind === 'session' && session.activeDurationMs).not.toBe(369_000)
    expect((await new LibraryRepository(database).list()).at(0)).toMatchObject({
      id: bookId,
      shelf: 'reading',
      progress: 1,
      startedAt: '2026-08-29T10:00:00.000Z',
    })

    const beforeReplay = ledger.events.length
    expect(await repository.ingestJournal(events)).toEqual(events.map(({ id }) => id))
    expect((await new ReadingLedgerRepository(database).read()).events).toHaveLength(beforeReplay)
    await database.close()
  })

  test('excludes buffering and pauses because native active time is monotonic evidence', async () => {
    const database = await progressDatabase()
    const repository = new AudiobookProgressRepository(database)
    await repository.ingestJournal([
      playbackEvent('play', 1, '2026-08-29T11:00:00.000Z', 0, 0, 1, 0, 'session:buffering'),
      playbackEvent('pause', 2, '2026-08-29T11:01:00.000Z', 20_000, 20_000, 1, 20_000, 'session:buffering'),
    ])

    const ledger = await new ReadingLedgerRepository(database).read()
    const session = ledger.events.find(
      (event) => event.kind === 'session' && event.id.includes('buffering'),
    )
    expect(session).toMatchObject({ kind: 'session', activeDurationMs: 20_000 })
    await database.close()
  })

  test('throttles ordinary checkpoint writes but persists at the recovery position bound', async () => {
    const database = await progressDatabase()
    const repository = new AudiobookProgressRepository(database)
    const initial = playbackSnapshot({
      playbackSessionId: 'session:checkpoint',
      revision: 1,
      absolutePositionMs: 10_000,
      activeDurationMs: 10_000,
      observedAt: '2026-08-29T12:00:00.000Z',
    })
    expect(await repository.checkpointSnapshot(initial, true)).toBe('saved')
    expect(await repository.checkpointSnapshot(playbackSnapshot({
      ...initial,
      revision: 2,
      absolutePositionMs: 24_999,
      activeDurationMs: 18_999,
      observedAt: '2026-08-29T12:00:09.000Z',
    }))).toBe('throttled')
    expect(await repository.checkpointSnapshot(playbackSnapshot({
      ...initial,
      revision: 3,
      absolutePositionMs: 25_000,
      activeDurationMs: 19_000,
      observedAt: '2026-08-29T12:00:09.001Z',
    }))).toBe('saved')

    expect(await repository.checkpointForBook(bookId)).toMatchObject({
      absolutePositionMs: 25_000,
      activeDurationMs: 19_000,
      chapterId: 'chapter:test',
    })
    await database.close()
  })

  test('closes a process-lost interval at the last durable active-time checkpoint', async () => {
    const database = await progressDatabase()
    const repository = new AudiobookProgressRepository(database)
    await repository.ingestJournal([
      playbackEvent('play', 1, '2026-08-29T11:30:00.000Z', 40_000, 5_000, 1, 40_000, 'session:recovered'),
    ])
    await repository.checkpointSnapshot(playbackSnapshot({
      playbackSessionId: 'session:recovered',
      engineEpoch: 'android-engine:restored',
      revision: 2,
      state: 'paused',
      suppressionReason: 'process-recreated',
      playIntent: false,
      absolutePositionMs: 55_000,
      activeDurationMs: 20_000,
      observedAt: '2026-08-29T11:35:00.000Z',
    }), true)

    const ledger = await new ReadingLedgerRepository(database).read()
    const recovered = ledger.events.find(
      (event) => event.kind === 'session' && event.id.includes('playback-snapshot'),
    )
    expect(recovered).toMatchObject({
      kind: 'session',
      activeDurationMs: 15_000,
      timeConfidence: 0.75,
      endPosition: { locator: { kind: 'audio-time', positionMs: 55_000 } },
    })
    await database.close()
  })

  test('keeps a first-party checkpoint over newer imported progress and honors manual correction', async () => {
    const database = await progressDatabase()
    const repository = new AudiobookProgressRepository(database)
    await repository.checkpointSnapshot(playbackSnapshot({
      playbackSessionId: 'session:precedence',
      revision: 4,
      absolutePositionMs: 8_000_000,
      activeDurationMs: 4_000_000,
      observedAt: '2026-08-28T12:00:00.000Z',
    }), true)
    const ledger = new ReadingLedgerRepository(database)
    await ledger.append({
      events: [positionEvent(
        'reading-event:imported:newer-progress',
        32_000_000,
        '2026-08-29T12:00:00.000Z',
        { kind: 'migration', migrationKey: 'newer-import' },
      )],
    })

    expect(await repository.resolvePositionForBook(bookId)).toMatchObject({
      status: 'resolved',
      positionMs: 8_000_000,
      selectedCandidateId: expect.stringContaining('checkpoint'),
    })

    await ledger.append({
      events: [positionEvent(
        'reading-event:manual:chosen-progress',
        5_000_000,
        '2026-08-20T12:00:00.000Z',
        { kind: 'local', method: 'manual' },
      )],
    })
    expect(await repository.resolvePositionForBook(bookId)).toMatchObject({
      status: 'resolved',
      positionMs: 5_000_000,
      sourceEventId: 'reading-event:manual:chosen-progress',
    })
    await database.close()
  })
})

async function progressDatabase(): Promise<BunSqliteDatabase> {
  const database = new BunSqliteDatabase()
  await migrateStorage(database)
  await new CatalogRepository(database).replace(representativeCatalog)
  await new LibraryRepository(database).save({
    id: bookId,
    title: 'The Left Hand of Darkness',
    authors: ['Ursula K. Le Guin'],
    pageCount: 0,
    shelf: 'tbr',
    progress: 0,
    currentPage: 0,
    rating: 0,
    notes: '',
    addedAt: '2026-08-29T09:00:00.000Z',
    lastUpdatedAt: '2026-08-29T09:00:00.000Z',
  })
  const manifest = {
    schemaVersion: 1,
    queueId,
    editionId: fixtureIds.editions.leftHandAudio,
    assetId: fixtureIds.assets.leftHandM4b,
    fingerprint: 'a'.repeat(64),
    createdAt: '2026-08-29T09:00:00.000Z',
    displayMetadata: { title: 'The Left Hand of Darkness', authors: ['Ursula K. Le Guin'], narrators: [] },
    systemSurfaceMetadata: {
      private: { title: 'Wovenleaf', subtitle: 'Audiobook' },
      preview: { title: 'The Left Hand of Darkness', contributor: 'Ursula K. Le Guin' },
    },
    segments: [{
      id: 'segment:test',
      mediaType: 'audio/mp4',
      container: 'mpeg-4-audio',
      durationMs,
      absoluteStartMs: 0,
      absoluteEndMs: durationMs,
      fingerprint: 'a'.repeat(64),
      playableCapability: 'source:test',
    }],
    chapters: [{
      key: 'chapter:test',
      title: 'Chapter',
      segmentId: 'segment:test',
      absoluteStartMs: 0,
      absoluteEndMs: durationMs,
      provenance: 'embedded',
    }],
    initialAbsolutePositionMs: 0,
    rate: 1,
    skipIntervals: { forwardMs: 30_000, backwardMs: 15_000 },
    sleepTimer: null,
    sourceCapabilities: { local: true, seekable: true, relinkable: true },
  }
  await database.run(
    `INSERT INTO audiobook_imports(
       id, fingerprint, source_set_fingerprint, metadata_key, title, book_id, edition_id,
       content_asset_id, cover_asset_id, source_record_id, outcome, imported_at,
       manifest_json, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    [
      'audiobook-import:progress-test',
      'a'.repeat(64),
      'b'.repeat(64),
      'progress-test',
      'The Left Hand of Darkness',
      bookId,
      fixtureIds.editions.leftHandAudio,
      fixtureIds.assets.leftHandM4b,
      fixtureIds.sources.google,
      'imported',
      '2026-08-29T09:00:00.000Z',
      JSON.stringify(manifest),
      JSON.stringify({ id: 'audiobook-import:progress-test' }),
    ],
  )
  return database
}

function playbackEvent(
  kind: NativePlaybackEvent['kind'],
  sequence: number,
  observedAt: string,
  afterPositionMs: number,
  activeDurationMs: number,
  rate: number,
  beforePositionMs = afterPositionMs,
  playbackSessionId = 'session:listening',
): NativePlaybackEvent {
  return {
    bridgeVersion: AUDIOBOOK_PLAYBACK_BRIDGE_VERSION,
    id: `playback-event:test:${playbackSessionId}:${sequence}`,
    sequence,
    engineEpoch: 'android-engine:test',
    queueId,
    playbackSessionId,
    revision: sequence,
    kind,
    observedAt,
    activeDurationMs,
    beforePositionMs,
    afterPositionMs,
    rate,
    reason: 'test',
    confidence: 1,
    segmentId: 'segment:test',
    chapterId: 'chapter:test',
    error: null,
  }
}

function playbackSnapshot(overrides: Partial<PlaybackSnapshot>): PlaybackSnapshot {
  return playbackSnapshotSchema.parse({
    bridgeVersion: AUDIOBOOK_PLAYBACK_BRIDGE_VERSION,
    engineEpoch: 'android-engine:test',
    queueId,
    playbackSessionId: 'session:snapshot',
    revision: 1,
    state: 'playing',
    suppressionReason: 'none',
    playIntent: true,
    segmentId: 'segment:test',
    chapterId: 'chapter:test',
    absolutePositionMs: 0,
    segmentPositionMs: 0,
    durationMs,
    bufferedPositionMs: durationMs,
    activeDurationMs: 0,
    rate: 1,
    sleepTimer: null,
    route: { kind: 'built-in', name: 'Device', external: false },
    capabilities: {
      bridgeVersion: AUDIOBOOK_PLAYBACK_BRIDGE_VERSION,
      engine: 'android-media3',
      backgroundPlayback: true,
      systemControls: true,
      processRestoration: true,
      systemLibrary: true,
      airPlay: false,
      cast: false,
      routeSelection: true,
      sleepTimer: true,
      seek: true,
      supportedMediaTypes: ['audio/mpeg', 'audio/mp4'],
      minimumRate: 0.5,
      maximumRate: 3,
    },
    lastCommandId: null,
    error: null,
    observedAt: '2026-08-29T12:00:00.000Z',
    ...overrides,
  })
}

function positionEvent(
  id: string,
  positionMs: number,
  observedAt: string,
  source: { readonly kind: 'migration'; readonly migrationKey: string }
    | { readonly kind: 'local'; readonly method: 'manual' },
) {
  return readingEventSchema.parse({
    id: readingEventIdSchema.parse(id),
    editionId: editionIdSchema.parse(fixtureIds.editions.leftHandAudio),
    assetId: assetIdSchema.parse(fixtureIds.assets.leftHandM4b),
    source,
    deviceId: readingDeviceIdSchema.parse('reading-device:test:progress'),
    observedAt,
    effectiveAt: observedAt,
    recordedAt: observedAt,
    timeConfidence: 1,
    kind: 'location',
    position: {
      locator: { kind: 'audio-time', positionMs },
      normalizedProgress: positionMs / durationMs,
      normalization: { kind: 'edition-duration', durationMs, confidence: 1 },
    },
  })
}
