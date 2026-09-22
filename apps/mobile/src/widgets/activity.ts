import type { SqlDatabase } from '../storage/database'

// Separate from edition locators: manual library entries need activity evidence too.
// These are durable facts, never inferred from metadata timestamps or rounded percentages.
export const READING_ACTIVITY_SCHEMA = `
CREATE TABLE reading_activity_events (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
  occurred_at TEXT NOT NULL,
  local_day TEXT NOT NULL,
  source TEXT NOT NULL,
  previous_position REAL NOT NULL,
  position REAL NOT NULL,
  CHECK(position > previous_position)
);
CREATE INDEX idx_reading_activity_day ON reading_activity_events(local_day, book_id);
`

export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function readingStreak(days: readonly string[], now = new Date()): { count: number; readToday: boolean } {
  const recorded = new Set(days)
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  const readToday = recorded.has(localDay(cursor))
  if (!readToday) cursor.setDate(cursor.getDate() - 1)
  let count = 0
  while (recorded.has(localDay(cursor))) {
    count += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return { count, readToday }
}

export async function recordReadingAdvance(database: SqlDatabase, event: {
  id: string; bookId: string; occurredAt: string; source: string; before: number; after: number
}): Promise<void> {
  if (!Number.isFinite(event.before) || !Number.isFinite(event.after) || event.after <= event.before) return
  const date = new Date(event.occurredAt)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid reading activity date')
  await database.run(
    `INSERT OR IGNORE INTO reading_activity_events
     (id, book_id, occurred_at, local_day, source, previous_position, position)
     SELECT ?, id, ?, ?, ?, ?, ? FROM library_books WHERE id = ?`,
    [event.id, date.toISOString(), localDay(date), event.source, event.before, event.after, event.bookId],
  )
}

export async function readActivity(database: SqlDatabase) {
  const days = await database.query<{ local_day: string }>('SELECT DISTINCT local_day FROM reading_activity_events ORDER BY local_day')
  const recent = await database.query<{ book_id: string; occurred_at: string; source: string }>(
    `SELECT book_id, occurred_at, source FROM (
      SELECT book_id, occurred_at, source, ROW_NUMBER() OVER (PARTITION BY book_id ORDER BY occurred_at DESC, id DESC) AS rank
      FROM reading_activity_events
    ) WHERE rank = 1`,
  )
  return { days: days.map((row) => row.local_day), recent: new Map(recent.map((row) => [row.book_id, row.occurred_at])),
    sources: new Map(recent.map((row) => [row.book_id, row.source])) }

}
