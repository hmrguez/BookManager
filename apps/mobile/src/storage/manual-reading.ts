import {
  deriveReadingState, editionSchema, isoDateTimeSchema, progressSnapshotIdSchema,
  readingEventSchema, resolveMetadataField, toProgressSnapshot, workSchema,
  type Edition, type ReadingEvent,
} from '../domain/catalog'
import { canonicalEditionIsbn } from '../metadata/model'
import { libraryBookSchema, type LibraryBook } from '../library-model'
import { appendReadingLedgerBatch, CatalogRepository, upsertImportableCatalogEntity } from './catalog-repository'
import { readText, type SqlDatabase } from './database'
import { writeLibraryBook } from './library-repository'

export type ManualReadingOperation = { id: string; confirmFinish?: boolean; reread?: boolean; undoOf?: string; undoProgress?: { progress: number; currentPage: number } }
const lifecycleFields = ['shelf', 'startedAt', 'finishedAt'] as const
export const readingChanged = (before: LibraryBook | undefined, after: LibraryBook) =>
  lifecycleFields.some((field) => before?.[field] !== after[field])

/** Only explicit reader actions enter here; imports and progress capture use their own provenance. */
export async function saveManualReadingChange(
  database: SqlDatabase, before: LibraryBook | undefined, after: LibraryBook, operation: ManualReadingOperation,
): Promise<void> {
  const prefix = `reading-event:manual:${operation.id}:`
  const [retry] = await database.query('SELECT id FROM reading_events WHERE id = ?', [`${prefix}0`])
  if (retry) return // Never replay an old projection over later activity after a committed retry.
  const [row] = await database.query('SELECT payload_json FROM library_books WHERE id = ?', [after.id])
  const current = row ? libraryBookSchema.parse(JSON.parse(readText(row, 'payload_json'))) : undefined
  if (current?.manualReadingRevision === operation.id) return
  if (Boolean(current) !== Boolean(before) || (current && before && lifecycleFields.some((key) => current[key] !== before[key]))) {
    throw new Error('Reading history changed. Reload the library before trying again.')
  }
  if (operation.undoOf && (current?.manualReadingRevision !== operation.undoOf
    || (operation.undoProgress && (current.progress !== operation.undoProgress.progress || current.currentPage !== operation.undoProgress.currentPage)))) {
    throw new Error('A later reading change prevents this undo. Reload the library to review it.')
  }
  const edition = await resolveReadingEdition(database, current ?? after)
  const catalog = await new CatalogRepository(database).read()
  const prior = catalog.readingEvents.filter((event) => event.editionId === edition.id)
  const state = deriveReadingState(edition.id, prior)
  const active = new Set(state.appliedEventIds)
  const latestFinish = prior.filter((event) => active.has(event.id) && finishPayload(event))
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt)).at(-1)
  const recordedAt = isoDateTimeSchema.parse(after.lastUpdatedAt)
  const events: ReadingEvent[] = []
  const append = (payload: object, effectiveAt = recordedAt) => events.push(readingEventSchema.parse({
    ...payload, id: `${prefix}${events.length}`, editionId: edition.id,
    ...(state.currentPositionAssetId ? { assetId: state.currentPositionAssetId } : {}),
    source: { kind: 'local', method: 'manual' }, deviceId: 'reading-device:manual',
    observedAt: recordedAt, recordedAt, effectiveAt, timeConfidence: 1,
  }))
  const nativePosition = state.currentPosition?.locator.kind !== 'percent' ? state.currentPosition : undefined
  const position = nativePosition ?? { locator: { kind: 'percent', fraction: after.progress / 100 },
    normalizedProgress: after.progress / 100, normalization: { kind: 'reported-percent', confidence: 1 } }
  if (operation.undoOf) {
    const targets = prior.filter(({ id }) => id.startsWith(`reading-event:manual:${operation.undoOf}:`))
    if (targets.length) append({ kind: 'correction', targetEventIds: targets.map(({ id }) => id), reason: 'Reader undid a reading change', action: { kind: 'tombstone' } })
  } else if (operation.reread) {
    if (before?.shelf !== 'finished') throw new Error('Finish the current reading before starting a reread.')
    append({ kind: 'start', position })
  } else {
    if (before?.shelf === 'finished' && after.shelf !== 'finished' && latestFinish) {
      append({ kind: 'correction', targetEventIds: correctionTargets(latestFinish, prior), reason: 'Reader undid completion', action: { kind: 'tombstone' } })
    }
    if (after.shelf === 'finished') {
      if (!after.finishedAt) throw new Error('Choose a finish date to confirm completion.')
      // Reported completion does not claim the native reader reached its end. Retain the
      // last locator without fabricating a 100% CFI/audio position.
      const finishPosition = nativePosition ? {
        locator: nativePosition.locator,
        normalization: { kind: 'none', confidence: 0, reason: 'Reader-reported finish; native end position is unknown' },
      } : { locator: { kind: 'percent', fraction: 1 }, normalizedProgress: 1,
        normalization: { kind: 'reported-percent', confidence: 1 } }
      const replacement = { kind: 'finish', position: finishPosition }
      if (before?.shelf === 'finished' && latestFinish) {
        append({ kind: 'correction', targetEventIds: correctionTargets(latestFinish, prior), reason: 'Reader corrected the finish date',
          action: { kind: 'replace', replacement } }, isoDateTimeSchema.parse(after.finishedAt))
      } else append(replacement, isoDateTimeSchema.parse(after.finishedAt))
    } else if (after.shelf === 'reading' && before?.shelf !== 'reading') append({ kind: 'start', position })
    else if (after.shelf === 'dnf' && before?.shelf !== 'dnf') append({ kind: 'did-not-finish', position })
    else if (before?.shelf === 'reading') append({ kind: 'pause', position })
  }
  if (events.length) {
    const snapshotIds = catalog.progressSnapshots.filter((snapshot) => snapshot.editionId === edition.id).map(({ id }) => id)
    if (!snapshotIds.length) snapshotIds.push(progressSnapshotIdSchema.parse(`progress:manual:${edition.id}`))
    await appendReadingLedgerBatch(database, { events, snapshots: snapshotIds.map((id) => toProgressSnapshot(
      id, deriveReadingState(edition.id, [...prior, ...events]), recordedAt,
    )) })
  }
  // Preserve background edits to fields this action did not change.
  const changed = Object.fromEntries(Object.keys(after).filter((key) =>
    !before || JSON.stringify(after[key as keyof LibraryBook]) !== JSON.stringify(before[key as keyof LibraryBook]),
  ).map((key) => [key, after[key as keyof LibraryBook]]))
  await writeLibraryBook(database, libraryBookSchema.parse({ ...current, ...changed,
    readingEditionId: edition.id, manualReadingRevision: operation.id }))
}

// Replacing a replacement suppresses its ancestors too. Undoing the new correction then
// reactivates the previous correction, rather than counting both the original and new finish.
function correctionTargets(event: ReadingEvent, events: ReadingEvent[]): string[] {
  const ids = new Set<string>()
  const visit = (item: ReadingEvent) => {
    if (ids.has(item.id)) return
    ids.add(item.id)
    if (item.kind === 'correction') for (const id of item.targetEventIds) {
      const target = events.find((candidate) => candidate.id === id)
      if (target) visit(target)
    }
  }
  visit(event)
  return [...ids]
}

export function finishPayload(event: ReadingEvent) {
  if (event.kind === 'finish') return event
  if (event.kind === 'correction' && event.action.kind === 'replace' && event.action.replacement.kind === 'finish') return event.action.replacement
  return undefined
}

/** Reuse explicit associations and exact edition identifiers. Titles never establish identity. */
async function resolveReadingEdition(database: SqlDatabase, book: LibraryBook): Promise<Edition> {
  const catalog = await new CatalogRepository(database).read()
  if (book.readingEditionId) {
    const existing = catalog.editions.find(({ id }) => id === book.readingEditionId)
    if (!existing) throw new Error('The reading edition is missing. Restore or review this book before changing its history.')
    return existing
  }
  const linked = await database.query(`SELECT edition_id FROM epub_imports WHERE book_id = ?
    UNION SELECT edition_id FROM audiobook_imports WHERE book_id = ?`, [book.id, book.id])
  const nativeIds = new Set(linked.map((row) => readText(row, 'edition_id')))
  const native = catalog.editions.filter(({ id }) => nativeIds.has(id))
  if (native.length === 1) return native[0]!
  if (native.length > 1) {
    const medium = /audio/i.test(book.format ?? '') ? 'audiobook' : 'ebook'
    const selected = native.filter((edition) => edition.medium === medium)
    if (selected.length === 1) return selected[0]!
    throw new Error('Several attached editions match this book. Review its edition before changing reading history.')
  }
  const token = await tokenFor(book.id)
  const imported = await database.query(`SELECT DISTINCT e.entity_id AS edition_id FROM import_changes e
    JOIN import_changes b ON b.row_id = e.row_id
    WHERE e.entity_type = 'edition' AND b.entity_type = 'library-book' AND b.entity_id = ? AND e.undo_status != 'restored'`, [book.id])
  const knownIds = new Set([...linked, ...imported].map((item) => readText(item, 'edition_id')))
  knownIds.add(`edition:legacy:${token}`)
  knownIds.add(`edition:manual:${token}`)
  const associated = catalog.editions.filter(({ id }) => knownIds.has(id))
  if (associated.length > 1) throw new Error('Choose an edition before changing reading history for this book.')
  if (associated[0]) return associated[0]
  const isbns = new Set((book.identifiers ?? []).flatMap((value) => canonicalEditionIsbn(value) ?? []))
  const matches = new Set(catalog.identifiers.filter((identifier) => identifier.owner.type === 'edition'
    && identifier.scheme.startsWith('isbn-') && isbns.has(canonicalEditionIsbn(identifier.normalizedValue) ?? '')).map(({ owner }) => owner.id))
  if (matches.size > 1) throw new Error('Several editions match this book. Review its identity before changing reading history.')
  const match = catalog.editions.find(({ id }) => matches.has(id))
  if (match) return match
  const workId = `work:manual:${token}`
  const editionId = `edition:manual:${token}`
  const at = book.lastUpdatedAt
  const field = (type: 'work' | 'edition', id: string, name: 'work.title' | 'edition.title' | 'edition.language' | 'edition.pageCount', value: string | number) =>
    resolveMetadataField({ kind: 'local', target: { type, id } as Parameters<typeof resolveMetadataField>[0]['target'],
      field: name, value, recordedAt: isoDateTimeSchema.parse(at), method: 'legacy-migration' })
  await upsertImportableCatalogEntity(database, 'work', workSchema.parse({ id: workId, kind: 'single',
    title: field('work', workId, 'work.title', book.title), createdAt: at, updatedAt: at }))
  const medium = /audio/i.test(book.format ?? '') ? 'audiobook' : /ebook|epub|pdf/i.test(book.format ?? '') ? 'ebook' : 'print'
  const edition = editionSchema.parse({ id: editionId, workId, medium,
    ...(medium === 'print' ? { binding: 'other' } : {}), title: field('edition', editionId, 'edition.title', book.editionTitle ?? book.title),
    language: field('edition', editionId, 'edition.language', 'und'),
    ...(medium !== 'audiobook' && book.pageCount > 0 ? { pageCount: field('edition', editionId, 'edition.pageCount', book.pageCount) } : {}),
    createdAt: at, updatedAt: at })
  await upsertImportableCatalogEntity(database, 'edition', edition)
  return edition
}

async function tokenFor(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
