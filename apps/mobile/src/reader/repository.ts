import {
  assetIdSchema,
  editionIdSchema,
  progressSnapshotIdSchema,
  readingDeviceIdSchema,
  readingEventIdSchema,
  readingSessionIdSchema,
  type ReadingEvent,
  type ReadingPosition,
} from '../domain/catalog'
import { ReadingLedgerRepository } from '../storage/catalog-repository'
import type { SqlDatabase, SqlRow } from '../storage/database'
import { readNumber, readText } from '../storage/database'
import { readLibraryBooks, writeLibraryBook } from '../storage/library-repository'
import {
  DEFAULT_READER_PREFERENCES,
  fallbackLocatorForReplacement,
  nativeReaderEventSchema,
  readerPreferencesSchema,
  readerCheckpointSchema,
  readiumLocatorSchema,
  type EpubReaderCapability,
  type NativeReaderEvent,
  type ReaderCheckpoint,
  type ReaderPreferences,
  type ReaderPreferenceScope,
  type ReaderPreferenceState,
  type ReadiumLocator,
} from './model'

type CapabilityRow = SqlRow & {
  readonly book_id: string
  readonly edition_id: string
  readonly content_asset_id: string
  readonly content_hash: string
  readonly original_name: string
  readonly asset_payload: string
}

type CheckpointRow = SqlRow & {
  readonly book_id: string
  readonly edition_id: string
  readonly asset_id: string
  readonly asset_fingerprint: string
  readonly last_sequence: number
  readonly locator_json: string | null
  readonly recorded_at: string
}

type PreferenceRow = SqlRow & {
  readonly scope: ReaderPreferenceScope
  readonly book_id: string
  readonly preferences_json: string
}

type ReadingNativeReaderEvent = Exclude<NativeReaderEvent, { readonly kind: 'preference' }>

export class EpubReaderRepository {
  readonly #database: SqlDatabase
  readonly #ledger: ReadingLedgerRepository

  constructor(database: SqlDatabase, ledger = new ReadingLedgerRepository(database)) {
    this.#database = database
    this.#ledger = ledger
  }

  async capabilityForBook(bookId: string): Promise<EpubReaderCapability | undefined> {
    const [row] = await this.#database.query<CapabilityRow>(
      `SELECT i.book_id, i.edition_id, i.content_asset_id, i.content_hash, i.original_name,
              a.payload_json AS asset_payload
       FROM epub_imports i
       JOIN assets a ON a.id = i.content_asset_id
       WHERE i.book_id = ?
       ORDER BY i.imported_at DESC, i.id DESC
       LIMIT 1`,
      [bookId],
    )
    if (!row) return undefined
    const payload = JSON.parse(readText(row, 'asset_payload')) as {
      readonly location?: { readonly kind?: string; readonly relativePath?: string }
    }
    if (payload.location?.kind !== 'managed-file' || !payload.location.relativePath) return undefined
    return {
      bookId: readText(row, 'book_id'),
      editionId: readText(row, 'edition_id'),
      assetId: readText(row, 'content_asset_id'),
      assetFingerprint: readText(row, 'content_hash'),
      relativePath: payload.location.relativePath,
      title: readText(row, 'original_name').replace(/\.epub$/i, ''),
    }
  }

  async resumeLocator(capability: EpubReaderCapability): Promise<ReadiumLocator | undefined> {
    const [row] = await this.#database.query<CheckpointRow>(
      `SELECT book_id, edition_id, asset_id, asset_fingerprint, last_sequence,
              locator_json, recorded_at
       FROM epub_reader_checkpoints
       WHERE book_id = ? AND locator_json IS NOT NULL
       ORDER BY CASE WHEN asset_id = ? THEN 0 ELSE 1 END,
                recorded_at DESC, asset_id DESC
       LIMIT 1`,
      [capability.bookId, capability.assetId],
    )
    if (!row || row.locator_json === null) return undefined
    const locator = readiumLocatorSchema.parse(JSON.parse(row.locator_json))
    return readText(row, 'asset_fingerprint') === capability.assetFingerprint
      ? locator
      : fallbackLocatorForReplacement(locator)
  }

  async checkpointForBook(bookId: string): Promise<ReaderCheckpoint | undefined> {
    const [row] = await this.#database.query<CheckpointRow>(
      `SELECT book_id, edition_id, asset_id, asset_fingerprint, last_sequence,
              locator_json, recorded_at
       FROM epub_reader_checkpoints
       WHERE book_id = ?
       ORDER BY recorded_at DESC, asset_id DESC
       LIMIT 1`,
      [bookId],
    )
    if (!row) return undefined
    return readerCheckpointSchema.parse({
      bookId: readText(row, 'book_id'),
      editionId: readText(row, 'edition_id'),
      assetId: readText(row, 'asset_id'),
      assetFingerprint: readText(row, 'asset_fingerprint'),
      lastSequence: readNumber(row, 'last_sequence'),
      ...(row.locator_json === null ? {} : { locator: JSON.parse(row.locator_json) }),
      recordedAt: readText(row, 'recorded_at'),
    })
  }

  async preferencesForBook(bookId: string): Promise<ReaderPreferenceState> {
    const rows = await this.#database.query<PreferenceRow>(
      `SELECT scope, book_id, preferences_json
       FROM epub_reader_preferences
       WHERE (scope = 'global' AND book_id = '')
          OR (scope = 'book' AND book_id = ?)
       ORDER BY scope`,
      [bookId],
    )
    let global: ReaderPreferences = DEFAULT_READER_PREFERENCES
    let book: ReaderPreferences | undefined
    for (const row of rows) {
      const preferences = readerPreferencesSchema.parse(JSON.parse(readText(row, 'preferences_json')))
      if (readText(row, 'scope') === 'global') global = preferences
      else book = preferences
    }
    return { global, ...(book ? { book } : {}) }
  }

  async savePreferences(
    scope: ReaderPreferenceScope,
    bookId: string,
    preferences: ReaderPreferences | null,
    recordedAt = new Date().toISOString(),
  ): Promise<void> {
    if (scope === 'global' && preferences === null) {
      throw new Error('Global reader preferences cannot be removed.')
    }
    const storageBookId = scope === 'global' ? '' : bookId
    if (preferences === null) {
      await this.#database.run(
        "DELETE FROM epub_reader_preferences WHERE scope = 'book' AND book_id = ?",
        [storageBookId],
      )
    } else {
      const validated = readerPreferencesSchema.parse(preferences)
      await this.#database.run(
        `INSERT INTO epub_reader_preferences(scope, book_id, preferences_json, recorded_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope, book_id) DO UPDATE SET
           preferences_json = excluded.preferences_json,
           recorded_at = excluded.recorded_at`,
        [scope, storageBookId, JSON.stringify(validated), recordedAt],
      )
    }
    await this.#database.persist()
  }

  async ingest(candidate: NativeReaderEvent): Promise<'applied' | 'duplicate' | 'stale'> {
    const event = nativeReaderEventSchema.parse(candidate)
    const [activeImport] = await this.#database.query<{ readonly content_asset_id: string }>(
      `SELECT content_asset_id
       FROM epub_imports
       WHERE book_id = ?
       ORDER BY imported_at DESC, id DESC
       LIMIT 1`,
      [event.bookId],
    )
    if (activeImport && readText(activeImport, 'content_asset_id') !== event.assetId) return 'stale'
    const [checkpoint] = await this.#database.query<{ readonly last_sequence: number }>(
      'SELECT last_sequence FROM epub_reader_checkpoints WHERE asset_id = ?',
      [event.assetId],
    )
    if (checkpoint && readNumber(checkpoint, 'last_sequence') >= event.sequence) return 'stale'

    if (event.kind === 'preference') {
      await this.savePreferences(
        event.preferenceScope,
        event.bookId,
        event.preferences,
        event.emittedAt,
      )
      await this.#saveCheckpoint(event)
      return 'applied'
    }

    const eventId = readingEventId(event.id)
    const [existing] = await this.#database.query('SELECT id FROM reading_events WHERE id = ?', [eventId])
    const readingEvent = toReadingEvent(event, eventId)
    const position = event.locator ? toReadingPosition(event) : undefined
    if (!existing) {
      const snapshot = position
        ? {
            id: progressSnapshotIdSchema.parse(`progress:reader:${event.assetId}`),
            editionId: readingEvent.editionId,
            assetId: readingEvent.assetId,
            status: 'reading' as const,
            position,
            normalizedProgress: position.normalizedProgress,
            sourceEventId: readingEvent.id,
            projectedAt: event.emittedAt,
          }
        : undefined
      await this.#ledger.append({
        events: [readingEvent],
        ...(snapshot ? { snapshots: [snapshot] } : {}),
      })
    }
    await this.#saveCheckpoint(event)
    return existing ? 'duplicate' : 'applied'
  }

  async #saveCheckpoint(event: NativeReaderEvent): Promise<void> {
    const locator = 'locator' in event ? event.locator : undefined
    const progression = locator?.locations.totalProgression
    await this.#database.run(
      `INSERT INTO epub_reader_checkpoints(
         asset_id, book_id, edition_id, asset_fingerprint, last_sequence,
         locator_json, total_progression, chapter_href, chapter_title, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET
         last_sequence = excluded.last_sequence,
         locator_json = COALESCE(excluded.locator_json, epub_reader_checkpoints.locator_json),
         total_progression = COALESCE(excluded.total_progression, epub_reader_checkpoints.total_progression),
         chapter_href = COALESCE(excluded.chapter_href, epub_reader_checkpoints.chapter_href),
         chapter_title = COALESCE(excluded.chapter_title, epub_reader_checkpoints.chapter_title),
         recorded_at = excluded.recorded_at
       WHERE excluded.last_sequence > epub_reader_checkpoints.last_sequence`,
      [
        event.assetId,
        event.bookId,
        event.editionId,
        event.assetFingerprint,
        event.sequence,
        locator ? JSON.stringify(locator) : null,
        progression ?? null,
        locator?.href ?? null,
        locator?.title ?? null,
        event.emittedAt,
      ],
    )
    if (progression !== undefined) {
      const book = (await readLibraryBooks(this.#database)).find(({ id }) => id === event.bookId)
      if (book) {
        const progress = Math.max(0, Math.min(99, Math.round(progression * 100)))
        await writeLibraryBook(this.#database, {
          ...book,
          shelf: book.shelf === 'finished' ? 'finished' : 'reading',
          progress: book.shelf === 'finished' ? 100 : progress,
          startedAt: book.startedAt ?? event.emittedAt,
          lastUpdatedAt: event.emittedAt,
        })
        await this.#database.persist()
      }
    }
  }
}

function toReadingEvent(
  event: ReadingNativeReaderEvent,
  id: ReturnType<typeof readingEventId>,
): ReadingEvent {
  const position = event.locator ? toReadingPosition(event) : undefined
  const envelope = {
    id,
    editionId: editionIdSchema.parse(event.editionId),
    assetId: assetIdSchema.parse(event.assetId),
    source: { kind: 'local' as const, method: 'epub-reader' as const },
    deviceId: readingDeviceIdSchema.parse(`reading-device:${event.platform}:readium`),
    observedAt: event.emittedAt,
    effectiveAt: event.emittedAt,
    recordedAt: new Date().toISOString(),
    timeConfidence: 1,
  }
  if (event.kind === 'session') {
    return {
      ...envelope,
      kind: 'session',
      sessionId: readingSessionIdSchema.parse(event.sessionId),
      startedAt: event.startedAt ?? event.emittedAt,
      endedAt: event.endedAt ?? event.emittedAt,
      activeDurationMs: event.activeDurationMs ?? 0,
      ...(position ? { endPosition: position } : {}),
    }
  }
  return {
    ...envelope,
    kind: event.kind === 'start' ? (position ? 'resume' : 'start') : 'location',
    ...(position ? { position } : {}),
  } as ReadingEvent
}

function toReadingPosition(event: ReadingNativeReaderEvent): ReadingPosition {
  const locator = readiumLocatorSchema.parse(event.locator)
  const progression = locator.locations.totalProgression
  return {
    locator: {
      kind: 'epub',
      href: locator.href,
      locator: locator.locations.fragments[0]
        ?? `readium-progression:${locator.locations.progression ?? 0}`,
      type: locator.type,
      ...(locator.title ? { title: locator.title } : {}),
      fragments: locator.locations.fragments,
      ...(locator.locations.progression === undefined
        ? {}
        : { progression: locator.locations.progression }),
      ...(progression === undefined ? {} : { totalProgression: progression }),
      ...(locator.locations.position === undefined ? {} : { position: locator.locations.position }),
      text: locator.text,
      assetFingerprint: event.assetFingerprint,
      toolkit: { name: 'readium', platform: event.platform, version: event.toolkitVersion },
    },
    ...(progression === undefined ? {} : { normalizedProgress: progression }),
    normalization: progression === undefined
      ? { kind: 'none', confidence: 0, reason: 'Readium did not report total progression' }
      : { kind: 'epub-progression', confidence: 1 },
  }
}

function readingEventId(nativeId: string) {
  const safe = nativeId.replace(/[^a-zA-Z0-9:._-]/g, '-')
  return readingEventIdSchema.parse(safe.startsWith('reading-event:') ? safe : `reading-event:${safe}`)
}
