import { libraryBookSchema, type LibraryBook } from '../library-model'
import { readText, type SqlDatabase } from '../storage/database'
import { readLibraryBooks, writeLibraryBook } from '../storage/library-repository'
import { emptyLibbyState, libbyKey, libbyStateSchema, parseLibbySnapshot, type LibbyItem, type LibbyState } from './model'

export const LIBBY_SCHEMA_SQL = `CREATE TABLE libby_state (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'primary'),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);`

/** Progress and its undo receipt are committed together. No provider credentials are accepted. */
export class LibbyRepository {
  private readonly database: SqlDatabase
  private readonly clock: () => Date

  constructor(database: SqlDatabase, clock = () => new Date()) {
    this.database = database
    this.clock = clock
  }

  async read(db = this.database): Promise<LibbyState> {
    const [row] = await db.query('SELECT payload_json FROM libby_state WHERE id = ?', ['primary'])
    return row ? libbyStateSchema.parse(JSON.parse(readText(row, 'payload_json'))) : emptyLibbyState()
  }

  private async write(db: SqlDatabase, state: LibbyState) {
    await db.run('INSERT INTO libby_state (id, payload_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json', ['primary', JSON.stringify(libbyStateSchema.parse(state))])
  }

  async configure(enabled: boolean, automatic: boolean): Promise<LibbyState> {
    return this.database.transaction(async (db) => {
      const state = enabled ? { ...await this.read(db), enabled, automatic } : emptyLibbyState()
      await this.write(db, state)
      return state
    })
  }

  async ingest(text: string): Promise<LibbyState> {
    const now = this.clock()
    const snapshot = parseLibbySnapshot(text, now.getTime())
    return this.database.transaction(async (db) => {
      const state = await this.read(db)
      if (!state.enabled) throw new Error('Enable Libby in Settings before receiving progress.')
      if (state.seen.includes(snapshot.id)) return state
      const books = await readLibraryBooks(db)
      for (const observation of snapshot.observations) {
        const key = libbyKey(observation)
        const previous = state.items.find((item) => item.key === key)
        const mapping = state.mappings.find((entry) => entry.key === key)
        const latest = Math.max(Date.parse(previous?.capturedAt ?? '') || 0, Date.parse(mapping?.observedAt ?? '') || 0)
        if (Date.parse(snapshot.capturedAt) <= latest) continue
        const book = books.find((entry) => entry.id === mapping?.bookId)
        const item: LibbyItem = { key, observation, snapshotId: snapshot.id, capturedAt: snapshot.capturedAt, status: 'pending', reason: 'Choose the matching book once.' }
        if (mapping) mapping.observedAt = snapshot.capturedAt
        if (book && mapping) {
          if (book.shelf !== 'reading') item.reason = 'Move this book to Reading before applying progress.'
          else if (mapping.paused) item.reason = 'Automatic updates are paused after Undo. Review to resume.'
          else if (book.lastUpdatedAt !== mapping.baseline) item.reason = 'This book changed in Wovenleaf. Review before replacing its progress.'
          else if (observation.percent < book.progress) item.reason = 'Libby shows an earlier position. Review this change.'
          else if (now.getTime() - Date.parse(snapshot.capturedAt) > 86_400_000) item.reason = 'This capture is more than a day old. Review its position.'
          else if (observation.percent === book.progress) { item.status = 'applied'; item.reason = 'Already up to date.' }
          else if (state.automatic) await this.applyProgress(db, state, item, book)
          else item.reason = 'Ready to apply. Automatic updates are off.'
        }
        state.items = state.items.filter((entry) => entry.key !== key)
        if (state.items.length >= 100) {
          const removable = state.items.findIndex((entry) => entry.status !== 'pending')
          if (removable < 0) throw new Error('Review or dismiss some Libby updates before receiving more.')
          state.items.splice(removable, 1)
        }
        state.items.push(item)
      }
      state.seen = [...state.seen, snapshot.id].slice(-200)
      state.lastReceivedAt = now.toISOString()
      await this.write(db, state)
      return state
    })
  }

  async apply(key: string, snapshotId: string, bookId: string | null, expectedUpdatedAt?: string): Promise<LibbyState> {
    return this.database.transaction(async (db) => {
      const state = await this.read(db)
      if (!state.enabled) throw new Error('Libby is disconnected.')
      const item = state.items.find((entry) => entry.key === key && entry.snapshotId === snapshotId && entry.status === 'pending')
      if (!item) throw new Error('This capture changed. Review the latest update.')
      const books = await readLibraryBooks(db)
      let book = books.find((entry) => entry.id === bookId)
      if (bookId && (!book || book.lastUpdatedAt !== expectedUpdatedAt)) throw new Error('This book changed. Choose it again to review its current progress.')
      if (!bookId) {
        const at = this.clock().toISOString()
        book = libraryBookSchema.parse({ id: `book:${crypto.randomUUID()}`, title: item.observation.title,
          authors: item.observation.author ? [item.observation.author] : [], format: item.observation.format === 'audiobook' ? 'AUDIOBOOK' : 'EBOOK',
          sourceNames: ['Libby'], pageCount: 0, shelf: 'reading', progress: 0, currentPage: 0,
          rating: 0, notes: '', addedAt: at, lastUpdatedAt: at })
      }
      if (!book || book.shelf !== 'reading') throw new Error('Choose a book on your Reading shelf.')
      if (state.mappings.some((mapping) => mapping.bookId === book.id && mapping.key !== key)) throw new Error('This book is already linked to another Libby title. Unlink it first.')
      if (state.mappings.length >= 500 && !state.mappings.some((mapping) => mapping.key === key)) throw new Error('Unlink an old title before linking another.')
      await this.applyProgress(db, state, item, book)
      await this.write(db, state)
      return state
    })
  }

  private async applyProgress(db: SqlDatabase, state: LibbyState, item: LibbyItem, book: LibraryBook) {
    const progress = item.observation.percent
    // A shelf percentage is not a page checkpoint. Retain the existing page marker.
    const lastUpdatedAt = new Date(Math.max(this.clock().getTime(), Date.parse(book.lastUpdatedAt) + 1)).toISOString()
    const updated = { ...book, progress, lastUpdatedAt }
    await writeLibraryBook(db, updated)
    state.mappings = state.mappings.filter((entry) => entry.key !== item.key)
    state.mappings.push({ key: item.key, bookId: book.id, baseline: lastUpdatedAt, paused: false, observedAt: item.capturedAt })
    state.receipts = [...state.receipts, { id: crypto.randomUUID(), key: item.key, bookId: book.id, title: book.title,
      at: lastUpdatedAt, before: { progress: book.progress, currentPage: book.currentPage },
      after: { progress, currentPage: book.currentPage, lastUpdatedAt }, undone: false }].slice(-50)
    item.status = 'applied'
    item.reason = 'Progress updated.'
  }

  async dismiss(key: string, snapshotId: string): Promise<LibbyState> {
    return this.database.transaction(async (db) => {
      const state = await this.read(db)
      const item = state.items.find((entry) => entry.key === key && entry.snapshotId === snapshotId)
      if (item) item.status = 'ignored'
      await this.write(db, state)
      return state
    })
  }

  async unlink(key: string): Promise<LibbyState> {
    return this.database.transaction(async (db) => {
      const state = await this.read(db)
      state.mappings = state.mappings.filter((entry) => entry.key !== key)
      await this.write(db, state)
      return state
    })
  }

  async undo(id: string): Promise<LibbyState> {
    return this.database.transaction(async (db) => {
      const state = await this.read(db)
      const receipt = state.receipts.find((entry) => entry.id === id && !entry.undone)
      if (!receipt) throw new Error('This update is no longer available to undo.')
      const book = (await readLibraryBooks(db)).find((entry) => entry.id === receipt.bookId)
      if (!book || book.lastUpdatedAt !== receipt.after.lastUpdatedAt || book.progress !== receipt.after.progress || book.currentPage !== receipt.after.currentPage) throw new Error('This book changed after the Libby update. Its newer progress has been kept.')
      const lastUpdatedAt = new Date(Math.max(this.clock().getTime(), Date.parse(book.lastUpdatedAt) + 1)).toISOString()
      await writeLibraryBook(db, { ...book, ...receipt.before, lastUpdatedAt })
      receipt.undone = true
      const mapping = state.mappings.find((entry) => entry.key === receipt.key)
      if (mapping) { mapping.baseline = lastUpdatedAt; mapping.paused = true }
      const item = state.items.find(entry => entry.key === receipt.key && entry.status === 'pending')
      if (item) item.reason = 'Automatic updates are paused after Undo. Review to resume.'
      await this.write(db, state)
      return state
    })
  }
}
