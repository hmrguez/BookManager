import type { SqlDatabase } from '../storage/database'
import { readLibraryBooks, writeLibraryBook } from '../storage/library-repository'

export async function applyEmbeddedCover(
  database: SqlDatabase,
  bookId: string,
  cover: { readonly bytes: Uint8Array; readonly mediaType: string } | undefined,
  overwrite = false,
): Promise<void> {
  if (!cover) return
  const book = (await readLibraryBooks(database)).find(({ id }) => id === bookId)
  if (!book || (book.thumbnail && !overwrite)) return
  const chunks: string[] = []
  for (let offset = 0; offset < cover.bytes.length; offset += 32_768) {
    chunks.push(String.fromCharCode(...cover.bytes.subarray(offset, offset + 32_768)))
  }
  await writeLibraryBook(database, {
    ...book,
    thumbnail: `data:${cover.mediaType};base64,${btoa(chunks.join(''))}`,
    lastUpdatedAt: new Date().toISOString(),
  })
}
