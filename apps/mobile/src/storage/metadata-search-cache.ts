import {
  metadataSearchCacheEntrySchema,
  type MetadataProviderId,
  type MetadataSearchCacheEntry,
} from '../metadata/model'
import type { SqlDatabase } from './database'
import { readText } from './database'

export class MetadataSearchCacheRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async get(
    provider: MetadataProviderId,
    queryKey: string,
  ): Promise<MetadataSearchCacheEntry | undefined> {
    const rows = await this.#database.query<{ readonly payload_json: string }>(
      `SELECT payload_json FROM metadata_search_cache
       WHERE provider = ? AND query_key = ?
       LIMIT 1`,
      [provider, queryKey],
    )
    const row = rows[0]
    if (!row) return undefined

    try {
      return metadataSearchCacheEntrySchema.parse(JSON.parse(readText(row, 'payload_json')))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Invalid ${provider} metadata cache entry: ${message}`)
    }
  }

  async put(input: MetadataSearchCacheEntry): Promise<void> {
    const entry = metadataSearchCacheEntrySchema.parse(input)
    await this.#database.run(
      `INSERT INTO metadata_search_cache(
         provider, query_key, locale, observed_at, expires_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, query_key) DO UPDATE SET
         locale = excluded.locale,
         observed_at = excluded.observed_at,
         expires_at = excluded.expires_at,
         payload_json = excluded.payload_json`,
      [
        entry.provider,
        entry.queryKey,
        entry.locale,
        entry.observedAt,
        entry.expiresAt,
        JSON.stringify(entry),
      ],
    )
    await this.#database.persist()
  }

  async pruneExpired(before = new Date().toISOString()): Promise<number> {
    const result = await this.#database.run(
      'DELETE FROM metadata_search_cache WHERE expires_at < ?',
      [before],
    )
    if (result.changes > 0) await this.#database.persist()
    return result.changes
  }
}
