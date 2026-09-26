import {
  assetIdSchema,
  editionIdSchema,
  progressSnapshotIdSchema,
  readingDeviceIdSchema,
  readingEventIdSchema,
  readingPositionSchema,
  readingSessionIdSchema,
  type ReadingEvent,
  type ReadingPosition,
} from '../domain/catalog'
import { libraryBookSchema } from '../library-model'
import { ReadingLedgerRepository } from '../storage/catalog-repository'
import type { SqlDatabase, SqlRow } from '../storage/database'
import { readNumber, readText } from '../storage/database'
import { readLibraryBooks, writeLibraryBook } from '../storage/library-repository'
import { epubCompatibilityProfileSchema } from '../epub/compatibility'
import {
  DEFAULT_READER_PREFERENCES,
  annotationForReplacement,
  fallbackLocatorForReplacement,
  nativeReaderEventSchema,
  readerAnnotationSchema,
  readerAnnotationStateSchema,
  readerNavigationStateSchema,
  readerPreferencesSchema,
  readerCheckpointSchema,
  readiumLocatorSchema,
  sortReaderAnnotations,
  type EpubReaderCapability,
  type NativeReaderEvent,
  type ReaderAnnotationState,
  type ReaderCheckpoint,
  type ReaderNavigationState,
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
  readonly book_payload: string | null
  readonly asset_payload: string
  readonly import_payload: string
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

type ReadingNativeReaderEvent = Exclude<
  NativeReaderEvent,
  { readonly kind: 'preference' | 'bookmark' | 'toc' | 'annotation' }
>

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
              b.payload_json AS book_payload, a.payload_json AS asset_payload,
              i.payload_json AS import_payload
       FROM epub_imports i
       JOIN assets a ON a.id = i.content_asset_id
       LEFT JOIN library_books b ON b.id = i.book_id
       WHERE i.book_id = ?
       ORDER BY i.imported_at DESC, i.id DESC
       LIMIT 1`,
      [bookId],
    )
    if (!row) return undefined
    const payload = JSON.parse(readText(row, 'asset_payload')) as {
      readonly format?: string
      readonly location?: { readonly kind?: string; readonly relativePath?: string; readonly bookmarkId?: string }
    }
    if (!['managed-file', 'linked-file', 'missing'].includes(payload.location?.kind ?? '')) return undefined
    const importPayload = JSON.parse(readText(row, 'import_payload')) as {
      readonly provenance?: { readonly compatibility?: unknown }
    }
    const compatibility = epubCompatibilityProfileSchema.safeParse(
      importPayload.provenance?.compatibility,
    )
    return {
      bookId: readText(row, 'book_id'),
      editionId: readText(row, 'edition_id'),
      assetId: readText(row, 'content_asset_id'),
      assetFingerprint: readText(row, 'content_hash'),
      relativePath: payload.location?.kind === 'managed-file' ? payload.location.relativePath ?? '' : '',
      ...(payload.location?.kind === 'linked-file' ? { referenceId: payload.location.bookmarkId } : {}),
      format: payload.format === 'pdf' ? 'pdf' : 'epub',
      title: row.book_payload === null
        ? readText(row, 'original_name').replace(/\.epub$/i, '')
        : libraryBookSchema.parse(JSON.parse(readText(row, 'book_payload'))).title,
      ...(compatibility.success ? { compatibility: compatibility.data } : {}),
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
    if (!row || row.locator_json === null) {
      // Portable archives retain the library's physical PDF page, while native
      // checkpoints are device-local caches. Rebuild resume after a clean restore.
      if (capability.format !== 'pdf') return undefined
      const book = (await readLibraryBooks(this.#database)).find(({ id }) => id === capability.bookId)
      if (!book?.currentPage || !book.pageCount) return undefined
      const page = Math.min(book.currentPage, book.pageCount)
      return readiumLocatorSchema.parse({
        href: 'document.pdf', type: 'application/pdf',
        locations: { position: page, pageCount: book.pageCount, totalProgression: page / book.pageCount },
      })
    }
    const locator = readiumLocatorSchema.parse(JSON.parse(row.locator_json))
    if ((locator.type === 'application/pdf') !== (capability.format === 'pdf')) return undefined
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

  async navigationStateForBook(capability: EpubReaderCapability): Promise<ReaderNavigationState> {
    const [row] = await this.#database.query<{ readonly state_json: string }>(
      'SELECT state_json FROM epub_reader_navigation WHERE book_id = ?',
      [capability.bookId],
    )
    if (!row) {
      return readerNavigationStateSchema.parse({
        version: 1,
        bookId: capability.bookId,
        editionId: capability.editionId,
        bookmarks: [],
        updatedAt: new Date(0).toISOString(),
      })
    }
    const state = readerNavigationStateSchema.parse(JSON.parse(readText(row, 'state_json')))
    const toc = state.toc
      ? {
          assetFingerprint: state.toc.assetFingerprint,
          locator: state.toc.assetFingerprint === capability.assetFingerprint
            ? state.toc.locator
            : fallbackLocatorForReplacement(state.toc.locator),
        }
      : undefined
    return readerNavigationStateSchema.parse({
      ...state,
      editionId: capability.editionId,
      ...(toc ? { toc } : {}),
      bookmarks: state.bookmarks.map((bookmark) => ({
        ...bookmark,
        locator: bookmark.assetFingerprint === capability.assetFingerprint
          ? bookmark.locator
          : fallbackLocatorForReplacement(bookmark.locator),
      })),
    })
  }

  async allNavigationStates(): Promise<ReaderNavigationState[]> {
    const rows = await this.#database.query<{ readonly state_json: string }>(
      'SELECT state_json FROM epub_reader_navigation ORDER BY book_id',
    )
    return rows.map((row) =>
      readerNavigationStateSchema.parse(JSON.parse(readText(row, 'state_json'))),
    )
  }

  async annotationStateForBook(capability: EpubReaderCapability): Promise<ReaderAnnotationState> {
    const [row] = await this.#database.query<{ readonly state_json: string }>(
      'SELECT state_json FROM epub_reader_annotations WHERE book_id = ?',
      [capability.bookId],
    )
    if (!row) {
      return readerAnnotationStateSchema.parse({
        version: 1,
        bookId: capability.bookId,
        editionId: capability.editionId,
        annotations: [],
        updatedAt: new Date(0).toISOString(),
      })
    }
    const state = readerAnnotationStateSchema.parse(JSON.parse(readText(row, 'state_json')))
    return readerAnnotationStateSchema.parse({
      ...state,
      editionId: capability.editionId,
      annotations: state.annotations.map((annotation) =>
        annotationForReplacement(annotation, capability),
      ),
    })
  }

  async allAnnotationStates(): Promise<ReaderAnnotationState[]> {
    const rows = await this.#database.query<{ readonly state_json: string }>(
      'SELECT state_json FROM epub_reader_annotations ORDER BY book_id',
    )
    return rows.map((row) =>
      readerAnnotationStateSchema.parse(JSON.parse(readText(row, 'state_json'))),
    )
  }

  async replaceAnnotationStates(states: readonly ReaderAnnotationState[]): Promise<void> {
    await this.#database.transaction(async (database) => {
      await replaceReaderAnnotationStates(database, states)
    })
  }

  async replaceNavigationStates(states: readonly ReaderNavigationState[]): Promise<void> {
    await this.#database.transaction(async (database) => {
      await replaceReaderNavigationStates(database, states)
    })
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
    const isActiveInterval = event.kind === 'session' && event.activeCapture !== undefined
    const isReplacedAsset = activeImport && readText(activeImport, 'content_asset_id') !== event.assetId
    if (isReplacedAsset && !isActiveInterval) return 'stale'
    const [checkpoint] = await this.#database.query<{ readonly last_sequence: number }>(
      'SELECT last_sequence FROM epub_reader_checkpoints WHERE asset_id = ?',
      [event.assetId],
    )
    const isOldSequence = checkpoint && readNumber(checkpoint, 'last_sequence') >= event.sequence
    // Late outbox slices still carry independent time evidence. Only their progress
    // projection is stale; dropping them here would lose crash-recovered activity.
    if (isOldSequence && !isActiveInterval) return 'stale'
    const historicalOnly = isActiveInterval && (isOldSequence || isReplacedAsset)

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

    if (event.kind === 'bookmark' || event.kind === 'toc') {
      await this.#saveNavigationState(event)
      await this.#saveCheckpoint(event, undefined)
      return 'applied'
    }

    if (event.kind === 'annotation') {
      await this.#saveAnnotationState(event)
      await this.#saveCheckpoint(event, undefined)
      return 'applied'
    }

    const eventId = readingEventId(event.id)
    const [existing] = await this.#database.query('SELECT id FROM reading_events WHERE id = ?', [eventId])
    const readingEvent = toReadingEvent(event, eventId)
    const position = event.locator ? toReadingPosition(event) : undefined
    if (!existing) {
      const snapshot = position && !historicalOnly
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
    if (!historicalOnly) await this.#saveCheckpoint(event, position?.normalizedProgress)
    return existing ? 'duplicate' : 'applied'
  }

  async #saveNavigationState(
    event: Extract<NativeReaderEvent, { readonly kind: 'bookmark' | 'toc' }>,
  ): Promise<void> {
    const [row] = await this.#database.query<{ readonly state_json: string }>(
      'SELECT state_json FROM epub_reader_navigation WHERE book_id = ?',
      [event.bookId],
    )
    const current = row
      ? readerNavigationStateSchema.parse(JSON.parse(readText(row, 'state_json')))
      : readerNavigationStateSchema.parse({
          version: 1,
          bookId: event.bookId,
          editionId: event.editionId,
          bookmarks: [],
          updatedAt: event.emittedAt,
        })
    let next: ReaderNavigationState
    if (event.kind === 'toc') {
      const { toc: _toc, ...withoutToc } = current
      next = readerNavigationStateSchema.parse({
        ...withoutToc,
        editionId: event.editionId,
        ...(event.locator
          ? { toc: { assetFingerprint: event.assetFingerprint, locator: event.locator } }
          : {}),
        updatedAt: event.emittedAt,
      })
    } else {
      const retained = current.bookmarks.filter(({ id }) => id !== event.bookmarkId)
      const bookmarks = event.action === 'upsert' && event.locator && event.createdAt
        ? [
            ...retained,
            {
              id: event.bookmarkId,
              assetId: event.assetId,
              assetFingerprint: event.assetFingerprint,
              locator: event.locator,
              createdAt: event.createdAt,
              updatedAt: event.emittedAt,
            },
          ]
        : retained
      next = readerNavigationStateSchema.parse({
        ...current,
        editionId: event.editionId,
        bookmarks: bookmarks.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
        updatedAt: event.emittedAt,
      })
    }
    await this.#database.run(
      `INSERT INTO epub_reader_navigation(book_id, edition_id, state_json, recorded_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(book_id) DO UPDATE SET
         edition_id = excluded.edition_id,
         state_json = excluded.state_json,
         recorded_at = excluded.recorded_at`,
      [next.bookId, next.editionId, JSON.stringify(next), next.updatedAt],
    )
    await this.#database.persist()
  }

  async #saveAnnotationState(
    event: Extract<NativeReaderEvent, { readonly kind: 'annotation' }>,
  ): Promise<void> {
    const [row] = await this.#database.query<{ readonly state_json: string }>(
      'SELECT state_json FROM epub_reader_annotations WHERE book_id = ?',
      [event.bookId],
    )
    const current = row
      ? readerAnnotationStateSchema.parse(JSON.parse(readText(row, 'state_json')))
      : readerAnnotationStateSchema.parse({
          version: 1,
          bookId: event.bookId,
          editionId: event.editionId,
          annotations: [],
          updatedAt: event.emittedAt,
        })
    const existing = current.annotations.find(({ id }) => id === event.annotationId)
    const retained = current.annotations.filter(({ id }) => id !== event.annotationId)
    let annotations = current.annotations
    if (event.action === 'upsert' && event.annotation) {
      const annotation = readerAnnotationSchema.parse(event.annotation)
      if (
        annotation.id !== event.annotationId
        || annotation.bookId !== event.bookId
        || annotation.editionId !== event.editionId
        || annotation.assetId !== event.assetId
        || annotation.assetFingerprint !== event.assetFingerprint
      ) {
        throw new Error('The annotation identity does not match its native reader event.')
      }
      annotations = [...retained, annotation]
    } else if (event.action === 'delete' && existing) {
      annotations = [...retained, { ...existing, updatedAt: event.emittedAt, deletedAt: event.emittedAt }]
    } else if (event.action === 'restore' && existing) {
      const { deletedAt: _deletedAt, ...restored } = existing
      annotations = [...retained, { ...restored, updatedAt: event.emittedAt }]
    }
    const next = readerAnnotationStateSchema.parse({
      ...current,
      editionId: event.editionId,
      annotations: sortReaderAnnotations(annotations),
      updatedAt: event.emittedAt,
    })
    await this.#database.run(
      `INSERT INTO epub_reader_annotations(book_id, edition_id, state_json, recorded_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(book_id) DO UPDATE SET
         edition_id = excluded.edition_id,
         state_json = excluded.state_json,
         recorded_at = excluded.recorded_at`,
      [next.bookId, next.editionId, JSON.stringify(next), next.updatedAt],
    )
    await this.#database.persist()
  }

  async #saveCheckpoint(event: NativeReaderEvent, normalizedProgress?: number): Promise<void> {
    const isReadingEvent =
      event.kind === 'start' || event.kind === 'location' || event.kind === 'session'
    const locator = isReadingEvent ? event.locator : undefined
    const progression = isReadingEvent && event.reachedEnd && locator
      ? 1
      : locator?.locations.totalProgression
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
    if (isReadingEvent) {
      const book = (await readLibraryBooks(this.#database)).find(({ id }) => id === event.bookId)
      if (book && book.shelf !== 'dnf') {
        const progress = normalizedProgress === undefined
          ? book.progress
          : event.reachedEnd
            ? 100
            : Math.max(0, Math.min(99, Math.round(normalizedProgress * 100)))
        await writeLibraryBook(this.#database, {
          ...book,
          shelf: book.shelf === 'finished' ? 'finished' : 'reading',
          progress: book.shelf === 'finished' ? 100 : progress,
          ...(locator?.type === 'application/pdf' && locator.locations.position
            ? { currentPage: locator.locations.position, pageCount: locator.locations.pageCount ?? book.pageCount } : {}),
          startedAt: book.startedAt ?? event.emittedAt,
          lastUpdatedAt: event.emittedAt,
        })
        await this.#database.persist()
      }
    }
  }
}

export async function replaceReaderNavigationStates(
  database: SqlDatabase,
  states: readonly ReaderNavigationState[],
): Promise<void> {
  const validated = readerNavigationStateSchema.array().parse(states)
  await database.run('DELETE FROM epub_reader_navigation')
  for (const state of validated) {
    await database.run(
      `INSERT INTO epub_reader_navigation(book_id, edition_id, state_json, recorded_at)
       VALUES (?, ?, ?, ?)`,
      [state.bookId, state.editionId, JSON.stringify(state), state.updatedAt],
    )
  }
}

export async function replaceReaderAnnotationStates(
  database: SqlDatabase,
  states: readonly ReaderAnnotationState[],
): Promise<void> {
  const validated = readerAnnotationStateSchema.array().parse(states)
  await database.run('DELETE FROM epub_reader_annotations')
  for (const state of validated) {
    await database.run(
      `INSERT INTO epub_reader_annotations(book_id, edition_id, state_json, recorded_at)
       VALUES (?, ?, ?, ?)`,
      [state.bookId, state.editionId, JSON.stringify(state), state.updatedAt],
    )
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
    source: { kind: 'local' as const, method: event.locator?.type === 'application/pdf' ? 'pdf-reader' as const : 'epub-reader' as const },
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
      ...(event.activeCapture ? { activeCapture: event.activeCapture } : {}),
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
  if (locator.type === 'application/pdf') {
    const page = locator.locations.position ?? 1
    const totalPages = locator.locations.pageCount
    return readingPositionSchema.parse({
      locator: { kind: 'page', page },
      ...(totalPages ? { normalizedProgress: page / totalPages } : {}),
      normalization: totalPages
        ? { kind: 'edition-page-count', totalPages, confidence: 1 }
        : { kind: 'none', confidence: 0, reason: 'PDF page count unavailable' },
    })
  }
  // Completion describes the visible page; the canonical resume locator still
  // describes its beginning and must be stored without changing its anchor.
  const progression = event.reachedEnd ? 1 : locator.locations.totalProgression
  const candidate = {
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
  const parsed = readingPositionSchema.safeParse(candidate)
  if (parsed.success) return parsed.data

  console.warn('Invalid EPUB progress; defaulting to 0 while preserving the reader locator.', {
    eventId: event.id,
    bookId: event.bookId,
    issues: parsed.error.issues,
  })
  return readingPositionSchema.parse({
    ...candidate,
    locator: { ...candidate.locator, totalProgression: 0 },
    normalizedProgress: 0,
    normalization: { kind: 'epub-progression', confidence: 0 },
  })
}

function readingEventId(nativeId: string) {
  const safe = nativeId.replace(/[^a-zA-Z0-9:._-]/g, '-')
  return readingEventIdSchema.parse(safe.startsWith('reading-event:') ? safe : `reading-event:${safe}`)
}
