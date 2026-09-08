import type { SqlDatabase } from '../storage/database'

type CapacityPolicy = (currentCount: number, resultingCount: number, newBookCount: number) => Promise<void>
const policies = new WeakMap<SqlDatabase, CapacityPolicy>()

/** Install after migration/recovery; all subsequent library writers share this boundary. */
export function setLibraryCapacityPolicy(database: SqlDatabase, policy: CapacityPolicy): void {
  policies.set(database, policy)
}

/** Call inside the same serialized transaction as the write. Existing entries remain editable. */
export async function checkLibraryCapacity(database: SqlDatabase, ids: readonly string[], replacing = false): Promise<void> {
  const policy = policies.get(database)
  if (!policy) return
  const rows = await database.query<{ id: string }>('SELECT id FROM library_books')
  const existing = new Set(rows.map(({ id }) => id))
  const incoming = new Set(ids)
  const added = [...incoming].filter((id) => !existing.has(id)).length
  await policy(existing.size, replacing ? incoming.size : existing.size + added, added)
}
