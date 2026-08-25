import {
  readingEventSchema,
  workSchema,
  type EditionId,
  type ReadingEvent,
  type Work,
} from '../domain/catalog'
import type { SqlDatabase, SqlRow } from './database'
import { readText } from './database'

export type QueryPlanStep = {
  readonly detail: string
}

export class CatalogQueryService {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async recentWorks(limit = 50): Promise<Work[]> {
    const rows = await this.#database.query(
      `SELECT payload_json
       FROM works
       ORDER BY updated_at DESC, id
       LIMIT ?`,
      [boundedLimit(limit)],
    )
    return rows.map((row) => workSchema.parse(JSON.parse(readText(row, 'payload_json'))))
  }

  async readingEventsForEdition(editionId: EditionId, limit = 500): Promise<ReadingEvent[]> {
    return this.#readingEvents(
      `SELECT payload_json
       FROM reading_events
       WHERE edition_id = ?
       ORDER BY effective_at, observed_at, recorded_at, id
       LIMIT ?`,
      [editionId, boundedLimit(limit)],
    )
  }

  async sessionsForEdition(editionId: EditionId, limit = 500): Promise<ReadingEvent[]> {
    return this.#readingEvents(
      `SELECT payload_json
       FROM reading_events
       WHERE edition_id = ? AND kind = 'session'
       ORDER BY effective_at, observed_at, recorded_at, id
       LIMIT ?`,
      [editionId, boundedLimit(limit)],
    )
  }

  async explainRecentWorks(): Promise<QueryPlanStep[]> {
    return explain(
      this.#database,
      `SELECT payload_json
       FROM works
       ORDER BY updated_at DESC, id
       LIMIT ?`,
      [50],
    )
  }

  async explainSessionsForEdition(editionId: EditionId): Promise<QueryPlanStep[]> {
    return explain(
      this.#database,
      `SELECT payload_json
       FROM reading_events
       WHERE edition_id = ? AND kind = 'session'
       ORDER BY effective_at, observed_at, recorded_at, id
       LIMIT ?`,
      [editionId, 500],
    )
  }

  async #readingEvents(statement: string, values: [EditionId, number]): Promise<ReadingEvent[]> {
    const rows = await this.#database.query(statement, values)
    return rows.map((row) => readingEventSchema.parse(JSON.parse(readText(row, 'payload_json'))))
  }
}

async function explain(
  database: SqlDatabase,
  statement: string,
  values: readonly (string | number)[],
): Promise<QueryPlanStep[]> {
  const rows = await database.query<SqlRow & { readonly detail: string }>(
    `EXPLAIN QUERY PLAN ${statement}`,
    values,
  )
  return rows.map((row) => ({ detail: readText(row, 'detail') }))
}

function boundedLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error('Query limit must be a positive integer')
  return Math.min(value, 10_000)
}
