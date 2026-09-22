import { recordReadingAdvance } from '../widgets/activity'
import { isUntouchedStarterLibraryBook, libraryBookSchema, type LibraryBook } from '../library-model'
import { upNextStateSchema } from '../up-next-model'
import type { SqlDatabase } from './database'
import { readText } from './database'
import { writeUpNextState } from './up-next-repository'
import { checkLibraryCapacity } from '../purchases/capacity'

export class LibraryRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async list(): Promise<LibraryBook[]> {
    return readLibraryBooks(this.#database)
  }

  async retireUntouchedStarterBooks(): Promise<number> {
    const relationshipRows = await this.#database.query<{ readonly book_id: string }>(
      `SELECT book_id FROM custom_shelf_entries
       UNION
       SELECT book_id FROM library_book_tags`,
    )
    const touchedBookIds = new Set(relationshipRows.map(({ book_id }) => book_id))
    const [upNextRow] = await this.#database.query(
      'SELECT payload_json FROM up_next_state WHERE id = ?',
      ['primary'],
    )
    if (upNextRow) {
      const upNext = upNextStateSchema.parse(JSON.parse(readText(upNextRow, 'payload_json')))
      for (const bookId of upNext.queueBookIds) touchedBookIds.add(bookId)
      if (upNext.pinnedBookId) touchedBookIds.add(upNext.pinnedBookId)
      for (const { bookId } of upNext.dismissedSuggestions) touchedBookIds.add(bookId)
    }
    const retired = (await this.list()).filter((book) =>
      isUntouchedStarterLibraryBook(book) && !touchedBookIds.has(book.id),
    )
    for (const book of retired) await this.remove(book.id)
    return retired.length
  }

  async save(book: LibraryBook, recordProgress: boolean | 'page' | 'percent' = false, expectedUpdatedAt?: string): Promise<void> {
    await this.#database.transaction(async (database) => {
      const validated = libraryBookSchema.parse(book)
      if (recordProgress || expectedUpdatedAt !== undefined) {
        const [row] = await database.query('SELECT payload_json FROM library_books WHERE id = ?', [book.id])
        if (expectedUpdatedAt !== undefined && (!row || libraryBookSchema.parse(JSON.parse(readText(row, 'payload_json'))).lastUpdatedAt !== expectedUpdatedAt)) {
          throw new Error('This book changed. Close and reopen to use its latest progress.')
        }
        if (row && recordProgress) {
          const before = libraryBookSchema.parse(JSON.parse(readText(row, 'payload_json')))
          const byPage = recordProgress === 'page' || (recordProgress === true && before.pageCount === validated.pageCount && before.currentPage !== validated.currentPage)
          await recordReadingAdvance(database, {
            id: `reading-activity:${crypto.randomUUID()}`, bookId: book.id,
            occurredAt: validated.lastUpdatedAt, source: byPage ? 'manual-page' : 'manual-percent',
            before: byPage ? before.currentPage : before.progress,
            after: byPage ? validated.currentPage : validated.progress,
          })
        }
      }
      await writeLibraryBook(database, validated)
    })
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('wovenleaf-library-saved'))
  }

  async remove(id: string): Promise<void> {
    await this.#database.transaction(async (database) => {
      await database.run('DELETE FROM custom_shelf_entries WHERE book_id = ?', [id])
      await database.run('DELETE FROM library_book_tags WHERE book_id = ?', [id])
      const [upNextRow] = await database.query('SELECT payload_json FROM up_next_state WHERE id = ?', ['primary'])
      if (upNextRow) {
        const upNext = upNextStateSchema.parse(JSON.parse(readText(upNextRow, 'payload_json')))
        await writeUpNextState(database, {
          ...upNext,
          queueBookIds: upNext.queueBookIds.filter((bookId) => bookId !== id),
          pinnedBookId: upNext.pinnedBookId === id ? null : upNext.pinnedBookId,
          dismissedSuggestions: upNext.dismissedSuggestions.filter(({ bookId }) => bookId !== id),
          updatedAt: new Date().toISOString(),
        })
      }
      await database.run('DELETE FROM library_books WHERE id = ?', [id])
      await database.run(
        `DELETE FROM organization_tags
         WHERE NOT EXISTS (
           SELECT 1 FROM library_book_tags WHERE library_book_tags.tag_id = organization_tags.id
         )`,
      )
    })
  }

  async replace(books: readonly LibraryBook[]): Promise<void> {
    const validated = books.map((book) => libraryBookSchema.parse(book))
    await this.#database.transaction(async (database) => {
      await replaceLibraryBooks(database, validated)
    })
  }
}

export async function readLibraryBooks(database: SqlDatabase): Promise<LibraryBook[]> {
  const rows = await database.query(
    'SELECT payload_json FROM library_books ORDER BY position, id',
  )
  return rows.map((row) => libraryBookSchema.parse(JSON.parse(readText(row, 'payload_json'))))
}

export async function writeLibraryBook(database: SqlDatabase, book: LibraryBook, capacityChecked = false): Promise<void> {
  const validated = libraryBookSchema.parse(book)
  if (!capacityChecked) await checkLibraryCapacity(database, [validated.id])
  await database.run(
    `INSERT INTO library_books(
       id, position, shelf, title_sort, added_at, updated_at, payload_json
     ) VALUES (
       ?, COALESCE((SELECT MAX(position) + 1 FROM library_books), 0), ?, ?, ?, ?, ?
     )
     ON CONFLICT(id) DO UPDATE SET
       shelf = excluded.shelf,
       title_sort = excluded.title_sort,
       added_at = excluded.added_at,
       updated_at = excluded.updated_at,
       payload_json = excluded.payload_json`,
    [
      validated.id,
      validated.shelf,
      validated.title,
      validated.addedAt,
      validated.lastUpdatedAt,
      JSON.stringify(validated),
    ],
  )
}

export async function replaceLibraryBooks(
  database: SqlDatabase,
  books: readonly LibraryBook[],
  trustedRecoveryRollback = false,
): Promise<void> {
  const validated = books.map((book) => libraryBookSchema.parse(book))
  if (!trustedRecoveryRollback) await checkLibraryCapacity(database, validated.map(({ id }) => id), true)
  await database.run('DELETE FROM library_books')
  for (const book of validated) await writeLibraryBook(database, book, true)
}
