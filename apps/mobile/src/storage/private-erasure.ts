import { readReviewBackup, replaceReviewBackup, emptyReviewBackup } from '../reviews/backup'
import { reviewFingerprint } from '../reviews/updates'
import { type SqlDatabase, type SqlRow } from './database'
import { readLibraryBooks } from './library-repository'
import { CatalogRepository } from './catalog-repository'
import type { RecoveryService } from './recovery'

// These tables contain canonical membership/activity or dependent per-book state.
// Immutable schema/credential state is deliberately outside this boundary.
const scopedTables = ['works', 'editions', 'assets', 'identifiers', 'identifier_source_records', 'source_records',
  'metadata_overrides', 'ownerships', 'loans', 'access_grants', 'contributors', 'work_parts', 'list_entries',
  'reading_events', 'reading_event_references', 'progress_snapshots', 'library_books', 'custom_shelf_entries',
  'library_book_tags', 'epub_reader_preferences', 'epub_imports', 'epub_reader_checkpoints', 'epub_reader_navigation', 'epub_reader_annotations',
  'audiobook_playback_preferences', 'audiobook_imports', 'audiobook_files', 'audiobook_playback_checkpoints', 'audiobook_annotations', 'identity_operations', 'duplicate_pair_decisions'] as const
const privateCaches = ['import_row_receipts', 'import_changes', 'import_checkpoints', 'import_rows', 'import_batches', 'metadata_search_cache', 'legacy_library_migrations'] as const

type Row = { table: string; row: SqlRow; values: unknown }
export type ErasurePreview = { token: string; books: string[]; reviews: { year: number; quarter: number }[]; all: boolean }
export class PrivateErasureService {
  private previews = new Map<string, { preview: ErasurePreview; fingerprint: string; bookId?: string }>()
  private database: SqlDatabase
  private recovery: RecoveryService
  constructor(database: SqlDatabase, recovery: RecoveryService) { this.database = database; this.recovery = recovery }

  async preview(bookId?: string): Promise<ErasurePreview> {
    const plan = await this.database.transaction(db => this.plan(db, bookId))
    const preview = { token: crypto.randomUUID(), books: plan.books.map(b => b.title), reviews: plan.affected.map(r => ({ year: r.facts.quarter.year, quarter: r.facts.quarter.quarter })), all: !bookId }
    this.previews.clear()
    this.previews.set(preview.token, { preview, fingerprint: plan.fingerprint, bookId })
    return preview
  }

  async erase(token: string) {
    const approved = this.previews.get(token)
    if (!approved) throw new Error('Preview private erasure again.')
    await this.recovery.erasePrivateData(() => this.database.transaction(async db => {
      const plan = await this.plan(db, approved.bookId)
      if (plan.fingerprint !== approved.fingerprint) throw new Error('Your library changed. Preview private erasure again before continuing.')
      if ((await db.query('SELECT id FROM private_erasure_pending')).length) throw new Error('Retry the previous cleanup first.')
      // Deferral allows connected cycles to be removed together, checked again at commit.
      await db.query('PRAGMA secure_delete = ON')
      await db.query('PRAGMA defer_foreign_keys = ON')
      for (const { table, row } of plan.selected) await db.run(`DELETE FROM ${table} WHERE rowid = ?`, [row.erasure_rowid!])
      for (const table of privateCaches) await db.run(`DELETE FROM ${table}`)
      // Undo receipts and pending captures can retain erased snapshots. Clear local integration
      // state and queues; this neither revokes credentials nor writes to an external service.
      await db.run('DELETE FROM libby_state')
      await db.run('DELETE FROM up_next_state')
      if (!approved.bookId) {
        for (const table of ['lists', 'people', 'custom_shelves', 'organization_tags', 'smart_lists', 'integration_checkpoints']) await db.run(`DELETE FROM ${table}`)
      }
      const reviews = approved.bookId ? { ...plan.reviews, keepsakes: plan.reviews.keepsakes.filter(r => !plan.affected.includes(r)),
        suppressions: [...plan.reviews.suppressions.filter(s => !plan.affected.some(r => r.id === s.quarterId)),
          ...plan.affected.map(r => ({ quarterId: r.id, suppressedAt: new Date().toISOString() }))] } : emptyReviewBackup()
      await replaceReviewBackup(db, reviews)
      const voices = plan.selected.filter(r => r.table === 'audiobook_annotations').map(r => r.row.voice_relative_path).filter((p): p is string => typeof p === 'string')
      await db.run('INSERT INTO private_erasure_pending(id, payload_json) VALUES (1, ?)', [JSON.stringify({ version: 1, voices, bookIds: plan.books.map(b => b.id), queueIds: plan.selected.filter(r => r.table === 'audiobook_imports').map(r => JSON.parse(String(r.row.manifest_json)).queueId), all: !approved.bookId })])
      await new CatalogRepository(db).read()
    }))
    this.previews.delete(token)
  }

  private async plan(db: SqlDatabase, bookId?: string) {
    const books = await readLibraryBooks(db)
    if (bookId && !books.some(b => b.id === bookId)) throw new Error('Book is no longer in this library.')
    const catalog = await new CatalogRepository(db).read()
    const rows: Row[] = []
    for (const table of scopedTables) for (const row of await db.query(`SELECT rowid AS erasure_rowid, * FROM ${table}`)) {
      rows.push({ table, row, values: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key.endsWith('_json') && typeof value === 'string' ? JSON.parse(value) : value])) })
    }
    const links: { bookId: string; editionId: string }[] = []
    for (const row of rows) if (['epub_imports', 'audiobook_imports'].includes(row.table)) links.push({ bookId: String(row.row.book_id), editionId: String(row.row.edition_id) })
    for (const row of await db.query(`SELECT b.entity_id AS book_id, e.entity_id AS edition_id FROM import_changes e JOIN import_changes b ON b.row_id = e.row_id WHERE e.entity_type = 'edition' AND b.entity_type = 'library-book' AND e.undo_status != 'restored'`)) {
      links.push({ bookId: String(row.book_id), editionId: String(row.edition_id) })
    }
    for (const book of books) {
      if (book.readingEditionId) links.push({ bookId: book.id, editionId: book.readingEditionId })
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(book.id))
      const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
      for (const prefix of ['manual', 'legacy']) links.push({ bookId: book.id, editionId: `edition:${prefix}:${hash}` })
    }
    const ids = new Set<string>(bookId ? [bookId] : books.map(b => b.id))
    for (const edition of catalog.editions) if (links.some(link => link.bookId === bookId && link.editionId === edition.id)) ids.add(edition.workId)
    const selected = new Set<Row>()
    let changed = true
    while (changed) {
      changed = false
      for (const link of links) if (ids.has(link.editionId) && !ids.has(link.bookId)) { ids.add(link.bookId); changed = true }
      for (const row of rows) if (!selected.has(row) && (!bookId || references(row.values, ids))) {
        selected.add(row); changed = true
        if (typeof row.row.id === 'string') ids.add(row.row.id)
      }
    }
    const reviews = await readReviewBackup(db)
    const affected = reviews.keepsakes.filter(r => !bookId || references(r.facts, ids))
    return { selected: [...selected], reviews, affected, books: books.filter(b => !bookId || ids.has(b.id)),
      fingerprint: reviewFingerprint({ rows, reviews, links }) }
  }
}
function references(value: unknown, ids: Set<string>): boolean {
  if (typeof value === 'string') return ids.has(value)
  if (Array.isArray(value)) return value.some(v => references(v, ids))
  if (value && typeof value === 'object') return Object.values(value).some(v => references(v, ids))
  return false
}
