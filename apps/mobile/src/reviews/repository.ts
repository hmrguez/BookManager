import { calculateStats, type StatsRequest } from '../stats/model'
import { z } from 'zod'
import { AudiobookControlsRepository } from '../playback/controls'
import { EpubReaderRepository } from '../reader/repository'
import { CatalogRepository } from '../storage/catalog-repository'
import { readText, type SqlDatabase } from '../storage/database'
import { readLibraryBooks } from '../storage/library-repository'
import { calculateQuarterlyReview, type ReviewEvidence, type ReviewRequest } from './evidence'

const embeddedPayload = z.object({ provenance: z.object({ subjects: z.array(z.string().min(1)).optional() }) })

/** A read-only, consistent snapshot. Saving/replaying keepsakes is a separate consumer. */
export class QuarterlyReviewRepository {
  readonly #database: SqlDatabase
  readonly #voiceExists: (relativePath: string) => Promise<boolean>

  constructor(database: SqlDatabase, options: { voiceExists?: (relativePath: string) => Promise<boolean> } = {}) {
    this.#database = database
    this.#voiceExists = options.voiceExists ?? (async () => false)
  }

  async calculate(request: ReviewRequest) {
    return this.#database.transaction(database => this.calculateInTransaction(database, request))
  }

  /** The caller owns the transaction, including any keepsake write from this snapshot. */
  async calculateInTransaction(database: SqlDatabase, request: ReviewRequest) {
    return calculateQuarterlyReview(await this.readEvidence(database), request)
  }

  async stats(request: StatsRequest) {
    return this.#database.transaction(async database => calculateStats(await this.readEvidence(database), request))
  }

  private async readEvidence(database: SqlDatabase): Promise<ReviewEvidence> {
    const catalog = await new CatalogRepository(database).read()
    const books = await readLibraryBooks(database)
    const reader = new EpubReaderRepository(database)
    const audioAnnotations = await new AudiobookControlsRepository(database).allAnnotations()
    const imports = await database.query(`SELECT book_id, edition_id, source_record_id, imported_at, payload_json FROM epub_imports ORDER BY imported_at, id`)
    const links = await database.query(`SELECT book_id, edition_id FROM epub_imports
      UNION SELECT book_id, edition_id FROM audiobook_imports
      UNION SELECT b.entity_id AS book_id, e.entity_id AS edition_id FROM import_changes e
        JOIN import_changes b ON b.row_id = e.row_id
        WHERE e.entity_type = 'edition' AND b.entity_type = 'library-book' AND e.undo_status != 'restored'`)
    const bookEditions = links.map(row => ({ bookId: readText(row, 'book_id'), editionId: readText(row, 'edition_id') }))
    for (const book of books) {
      if (book.readingEditionId) bookEditions.push({ bookId: book.id, editionId: book.readingEditionId })
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(book.id))
      const token = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)
      for (const prefix of ['legacy', 'manual']) {
        const editionId = `edition:${prefix}:${token}`
        if (catalog.editions.some(edition => edition.id === editionId)) bookEditions.push({ bookId: book.id, editionId })
      }
    }
    const embeddedSubjects: NonNullable<ReviewEvidence['embeddedSubjects']>[number][] = []
    // A replacement publication supersedes the earlier file's subject claim for that edition.
    const latest = new Map(imports.map(row => [readText(row, 'edition_id'), row]))
    for (const row of latest.values()) {
      const parsed = embeddedPayload.safeParse(JSON.parse(readText(row, 'payload_json')))
      if (!parsed.success || !parsed.data.provenance.subjects?.length) continue
      embeddedSubjects.push({ provider: 'embedded-epub', scope: 'edition',
        sourceKey: readText(row, 'source_record_id'), editionId: readText(row, 'edition_id'),
        observedAt: readText(row, 'imported_at'), values: parsed.data.provenance.subjects })
    }
    const survivingVoiceNoteIds: string[] = []
    for (const annotation of audioAnnotations) {
      if (annotation.kind === 'voice-note' && annotation.voiceRelativePath
        && await this.#voiceExists(annotation.voiceRelativePath).catch(() => false)) survivingVoiceNoteIds.push(annotation.id)
    }
    return { catalog, books, bookEditions, embeddedSubjects, audioAnnotations, survivingVoiceNoteIds,
      readerAnnotations: await reader.allAnnotationStates(), readerNavigation: await reader.allNavigationStates() }
  }
}
