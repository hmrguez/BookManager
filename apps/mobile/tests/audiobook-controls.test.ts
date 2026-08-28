import { describe, expect, test } from 'bun:test'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage } from '../src/storage/migrations'
import {
  AudiobookControlsRepository,
  DEFAULT_AUDIOBOOK_CONTROL_PREFERENCES,
  audiobookControlPreferencesSchema,
} from '../src/playback/controls'
import { playbackSnapshotSchema, type PlaybackSnapshot } from '../src/playback/model'
import { fixtureIds, representativeCatalog } from './fixtures/catalog'
import { BunSqliteDatabase } from './storage-test-database'

const bookId = 'book:audiobook-controls'
const queueId = 'queue:audiobook-controls'
const recordedAt = '2026-08-29T18:00:00.000Z'

describe('audiobook listening controls', () => {
  test('merges a per-book speed over durable global listening defaults', async () => {
    const database = await controlsDatabase()
    const repository = new AudiobookControlsRepository(database, {
      now: () => new Date(recordedAt),
    })

    expect(await repository.preferencesForBook(bookId)).toEqual({
      global: DEFAULT_AUDIOBOOK_CONTROL_PREFERENCES,
      effective: DEFAULT_AUDIOBOOK_CONTROL_PREFERENCES,
    })

    await repository.saveGlobalControls(bookId, {
      forwardSkipMs: 45_000,
      backwardSkipMs: 10_000,
      shakeToExtend: true,
    })
    await repository.saveRate(bookId, 1.5, 'global')
    await repository.saveRate(bookId, 1.25, 'book')

    expect(await repository.preferencesForBook(bookId)).toMatchObject({
      global: { rate: 1.5, forwardSkipMs: 45_000, backwardSkipMs: 10_000, shakeToExtend: true },
      book: { rate: 1.25 },
      effective: { rate: 1.25, forwardSkipMs: 45_000, backwardSkipMs: 10_000, shakeToExtend: true },
    })

    await repository.clearBookRate(bookId)
    expect((await repository.preferencesForBook(bookId)).effective.rate).toBe(1.5)
    expect(() => audiobookControlPreferencesSchema.parse({
      ...DEFAULT_AUDIOBOOK_CONTROL_PREFERENCES,
      forwardSkipMs: 1_000,
    })).toThrow()
    await database.close()
  })

  test('anchors bookmarks and notes to the authoritative session revision and exports the note', async () => {
    const database = await controlsDatabase()
    const repository = new AudiobookControlsRepository(database, {
      now: () => new Date(recordedAt),
      createId: (prefix) => `${prefix}:test`,
    })
    const snapshot = playbackSnapshot({
      revision: 17,
      absolutePositionMs: 372_300,
      chapterId: 'chapter:two',
    })

    const bookmark = await repository.createAnnotation({
      bookId,
      snapshot,
      kind: 'bookmark',
      note: 'Return to the narrator’s change in tone.',
    })

    expect(bookmark).toMatchObject({
      id: 'audiobook-bookmark:test',
      queueId,
      playbackSessionId: 'session:audiobook-controls',
      snapshotRevision: 17,
      absolutePositionMs: 372_300,
      chapterId: 'chapter:two',
      note: 'Return to the narrator’s change in tone.',
    })
    expect(await repository.annotationsForBook(bookId)).toEqual([bookmark])

    const markdown = await repository.exportAnnotationsMarkdown(bookId)
    expect(markdown).toContain('Bookmark · 6:12')
    expect(markdown).toContain('Chapter: A second chapter')
    expect(markdown).toContain('Return to the narrator’s change in tone.')
    expect(markdown).not.toContain('voice_relative_path')
    await database.close()
  })

  test('refuses to place an annotation on a stale or different queue', async () => {
    const database = await controlsDatabase()
    const repository = new AudiobookControlsRepository(database)

    await expect(repository.createAnnotation({
      bookId,
      snapshot: playbackSnapshot({ queueId: 'queue:different' }),
      kind: 'text-note',
      note: 'This must not drift to another book.',
    })).rejects.toMatchObject({ code: 'commandRejected' })
    expect(await repository.annotationsForBook(bookId)).toEqual([])
    await database.close()
  })
})

async function controlsDatabase(): Promise<BunSqliteDatabase> {
  const database = new BunSqliteDatabase()
  await migrateStorage(database)
  await new CatalogRepository(database).replace(representativeCatalog)
  await new LibraryRepository(database).save({
    id: bookId,
    title: 'A Listening Fixture',
    authors: ['A. Reader'],
    format: 'Audiobook',
    pageCount: 0,
    shelf: 'reading',
    progress: 12,
    currentPage: 0,
    rating: 0,
    notes: '',
    addedAt: recordedAt,
    lastUpdatedAt: recordedAt,
  })
  await database.run(
    `INSERT INTO audiobook_imports(
       id, fingerprint, source_set_fingerprint, metadata_key, title, book_id, edition_id,
       content_asset_id, cover_asset_id, source_record_id, outcome, imported_at,
       manifest_json, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    [
      'audiobook-import:controls',
      'a'.repeat(64),
      'b'.repeat(64),
      'controls-test',
      'A Listening Fixture',
      bookId,
      fixtureIds.editions.leftHandAudio,
      fixtureIds.assets.leftHandM4b,
      fixtureIds.sources.google,
      'imported',
      recordedAt,
      JSON.stringify(manifest()),
      JSON.stringify({ id: 'audiobook-import:controls' }),
    ],
  )
  return database
}

function manifest() {
  return {
    schemaVersion: 1,
    queueId,
    editionId: fixtureIds.editions.leftHandAudio,
    assetId: fixtureIds.assets.leftHandM4b,
    fingerprint: 'a'.repeat(64),
    createdAt: recordedAt,
    displayMetadata: { title: 'A Listening Fixture', authors: ['A. Reader'], narrators: ['N. Voice'] },
    systemSurfaceMetadata: {
      private: { title: 'Wovenleaf', subtitle: 'Audiobook' },
      preview: { title: 'A Listening Fixture', contributor: 'A. Reader' },
    },
    segments: [{
      id: 'segment:one',
      mediaType: 'audio/mp4',
      container: 'mpeg-4-audio',
      durationMs: 900_000,
      absoluteStartMs: 0,
      absoluteEndMs: 900_000,
      fingerprint: 'a'.repeat(64),
      playableCapability: 'source:controls',
    }],
    chapters: [
      { key: 'chapter:one', title: 'A first chapter', segmentId: 'segment:one', absoluteStartMs: 0, absoluteEndMs: 300_000, provenance: 'embedded' },
      { key: 'chapter:two', title: 'A second chapter', segmentId: 'segment:one', absoluteStartMs: 300_000, absoluteEndMs: 900_000, provenance: 'embedded' },
    ],
    initialAbsolutePositionMs: 0,
    rate: 1,
    skipIntervals: { forwardMs: 30_000, backwardMs: 15_000 },
    sleepTimer: null,
    sourceCapabilities: { local: true, seekable: true, relinkable: true },
  }
}

function playbackSnapshot(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return playbackSnapshotSchema.parse({
    bridgeVersion: 1,
    engineEpoch: 'engine:audiobook-controls',
    queueId,
    playbackSessionId: 'session:audiobook-controls',
    revision: 1,
    state: 'paused',
    suppressionReason: 'none',
    playIntent: false,
    segmentId: 'segment:one',
    chapterId: 'chapter:one',
    absolutePositionMs: 0,
    segmentPositionMs: 0,
    durationMs: 900_000,
    bufferedPositionMs: 900_000,
    activeDurationMs: 0,
    rate: 1,
    sleepTimer: null,
    route: { kind: 'built-in', name: 'Device', external: false },
    capabilities: {
      bridgeVersion: 1,
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
    observedAt: recordedAt,
    ...overrides,
  })
}
