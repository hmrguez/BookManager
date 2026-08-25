import {
  applyIdentityOperation,
  catalogSchema,
  createWorkMergeOperation,
  identityOperationSchema,
  listEntrySchema,
  undoIdentityOperation,
  workIdSchema,
  type Catalog,
  type IdentityOperation,
  type ListEntry,
  type WorkId,
} from '../domain/catalog'
import {
  detectDuplicateWorks,
  duplicatePairDecisionSchema,
  duplicatePairKey,
  identityOperationJournalSchema,
  previewWorkMerge,
  type DuplicateDecisionAction,
  type DuplicateDetectionResult,
  type DuplicateMergePreview,
  type DuplicatePairDecision,
  type IdentityListMutation,
  type IdentityOperationJournal,
} from '../duplicates'
import { CatalogRepository } from './catalog-repository'
import type { SqlDatabase, SqlRow } from './database'
import { readText } from './database'

type RepositoryIdKind = 'decision' | 'operation'

export type DuplicateReviewRepositoryOptions = {
  readonly now?: () => Date
  readonly createId?: (kind: RepositoryIdKind) => string
}

export type RecordDuplicateDecisionInput = {
  readonly leftWorkId: WorkId
  readonly rightWorkId: WorkId
  readonly action: Exclude<DuplicateDecisionAction, 'merge'>
  readonly rationale?: string
}

export type MergeWorksInput = {
  readonly absorbedWorkId: WorkId
  readonly survivingWorkId: WorkId
  readonly rationale: string
}

export type MergeWorksResult = {
  readonly decision: DuplicatePairDecision
  readonly journal: IdentityOperationJournal
  readonly preview: DuplicateMergePreview
}

export class DuplicateReviewRepository {
  readonly #database: SqlDatabase
  readonly #now: () => Date
  readonly #createId: (kind: RepositoryIdKind) => string

  constructor(database: SqlDatabase, options: DuplicateReviewRepositoryOptions = {}) {
    this.#database = database
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? ((kind) =>
      kind === 'decision'
        ? `duplicate-decision:${crypto.randomUUID()}`
        : `identity-operation:${crypto.randomUUID()}`
    )
  }

  async scan(): Promise<DuplicateDetectionResult> {
    const [catalog, decisions] = await Promise.all([
      new CatalogRepository(this.#database).read(),
      this.listDecisions(),
    ])
    return detectDuplicateWorks(catalog, decisions)
  }

  async previewMerge(absorbedWorkId: WorkId, survivingWorkId: WorkId): Promise<DuplicateMergePreview> {
    return previewWorkMerge(
      await new CatalogRepository(this.#database).read(),
      workIdSchema.parse(absorbedWorkId),
      workIdSchema.parse(survivingWorkId),
    )
  }

  async recordDecision(input: RecordDuplicateDecisionInput): Promise<DuplicatePairDecision> {
    const decidedAt = this.#now().toISOString()
    const leftWorkId = workIdSchema.parse(input.leftWorkId)
    const rightWorkId = workIdSchema.parse(input.rightWorkId)
    const decision = duplicatePairDecisionSchema.parse({
      id: this.#createId('decision'),
      pairKey: duplicatePairKey(leftWorkId, rightWorkId),
      leftWorkId,
      rightWorkId,
      action: input.action,
      decidedAt,
      rationale: input.rationale,
    })
    await this.#database.transaction(async (database) => {
      await assertWorksExist(database, leftWorkId, rightWorkId)
      await replaceActiveDecision(database, decision, decidedAt)
    })
    return decision
  }

  async mergeWorks(input: MergeWorksInput): Promise<MergeWorksResult> {
    const absorbedWorkId = workIdSchema.parse(input.absorbedWorkId)
    const survivingWorkId = workIdSchema.parse(input.survivingWorkId)
    const recordedAt = this.#now().toISOString()

    return this.#database.transaction(async (database) => {
      const catalog = await new CatalogRepository(database).read()
      const preview = previewWorkMerge(catalog, absorbedWorkId, survivingWorkId)
      const operation = createWorkMergeOperation(catalog.editions, absorbedWorkId, survivingWorkId, {
        id: this.#createId('operation'),
        recordedAt,
        rationale: input.rationale,
      })
      const listMutations = listMutationsFor(catalog, preview)
      const nextCatalog = catalogAfterOperation(catalog, operation, listMutations)
      await persistEditionAssignments(database, catalog, nextCatalog, operation)
      await applyListMutations(database, listMutations)

      const journal = identityOperationJournalSchema.parse({
        operation,
        status: 'applied',
        preview,
        listMutations,
      })
      await insertJournal(database, journal)

      const decision = duplicatePairDecisionSchema.parse({
        id: this.#createId('decision'),
        pairKey: duplicatePairKey(absorbedWorkId, survivingWorkId),
        leftWorkId: absorbedWorkId,
        rightWorkId: survivingWorkId,
        action: 'merge',
        survivorWorkId: survivingWorkId,
        operationId: operation.id,
        decidedAt: recordedAt,
        rationale: input.rationale,
      })
      await replaceActiveDecision(database, decision, recordedAt)
      return { decision, journal, preview }
    })
  }

  async applyOperation(input: IdentityOperation): Promise<IdentityOperationJournal> {
    const operation = identityOperationSchema.parse(input)
    return this.#database.transaction(async (database) => {
      const catalog = await new CatalogRepository(database).read()
      const nextCatalog = catalogAfterOperation(catalog, operation, [])
      await persistEditionAssignments(database, catalog, nextCatalog, operation)
      const journal = identityOperationJournalSchema.parse({
        operation,
        status: 'applied',
        listMutations: [],
      })
      await insertJournal(database, journal)
      return journal
    })
  }

  async undoOperation(operationId: string): Promise<IdentityOperationJournal> {
    const undoneAt = this.#now().toISOString()
    return this.#database.transaction(async (database) => {
      const journal = await readJournal(database, operationId)
      if (journal.status !== 'applied') throw new Error(`Identity operation ${operationId} is already undone`)
      const catalog = await new CatalogRepository(database).read()
      const restoredEditions = undoIdentityOperation(catalog.editions, journal.operation)
      const restoredListEntries = undoListEntries(catalog.listEntries, journal.listMutations)
      const restoredCatalog = catalogSchema.parse({
        ...catalog,
        editions: restoredEditions,
        listEntries: restoredListEntries,
      })
      await persistEditionAssignments(database, catalog, restoredCatalog, journal.operation)
      await undoListMutations(database, journal.listMutations)

      const undoneJournal = identityOperationJournalSchema.parse({
        ...journal,
        status: 'undone',
        undoneAt,
      })
      await database.run(
        `UPDATE identity_operations
         SET status = 'undone', undone_at = ?, payload_json = ?
         WHERE id = ? AND status = 'applied'`,
        [undoneAt, JSON.stringify(undoneJournal), operationId],
      )
      await undoMergeDecision(database, operationId, undoneAt)
      return undoneJournal
    })
  }

  async undoDecision(decisionId: string): Promise<DuplicatePairDecision> {
    const undoneAt = this.#now().toISOString()
    return this.#database.transaction(async (database) => {
      const rows = await database.query('SELECT payload_json FROM duplicate_pair_decisions WHERE id = ?', [decisionId])
      if (!rows[0]) throw new Error(`Missing duplicate decision ${decisionId}`)
      const decision = duplicatePairDecisionSchema.parse(JSON.parse(readText(rows[0], 'payload_json')))
      if (decision.action === 'merge') {
        throw new Error('Undo the merge operation to restore its identity and list changes together')
      }
      if (decision.undoneAt) throw new Error(`Duplicate decision ${decisionId} is already undone`)
      const undone = duplicatePairDecisionSchema.parse({ ...decision, undoneAt })
      await database.run(
        'UPDATE duplicate_pair_decisions SET undone_at = ?, payload_json = ? WHERE id = ?',
        [undoneAt, JSON.stringify(undone), decisionId],
      )
      return undone
    })
  }

  async listDecisions(): Promise<DuplicatePairDecision[]> {
    const rows = await this.#database.query(
      'SELECT payload_json FROM duplicate_pair_decisions ORDER BY decided_at, id',
    )
    return rows.map((row) =>
      duplicatePairDecisionSchema.parse(JSON.parse(readText(row, 'payload_json'))),
    )
  }

  async listOperations(): Promise<IdentityOperationJournal[]> {
    const rows = await this.#database.query(
      'SELECT payload_json FROM identity_operations ORDER BY recorded_at, id',
    )
    return rows.map((row) =>
      identityOperationJournalSchema.parse(JSON.parse(readText(row, 'payload_json'))),
    )
  }
}

function catalogAfterOperation(
  catalog: Catalog,
  operation: IdentityOperation,
  listMutations: readonly IdentityListMutation[],
): Catalog {
  return catalogSchema.parse({
    ...catalog,
    editions: applyIdentityOperation(catalog.editions, operation),
    listEntries: applyListEntries(catalog.listEntries, listMutations),
  })
}

function listMutationsFor(
  catalog: Catalog,
  preview: DuplicateMergePreview,
): IdentityListMutation[] {
  const entries = new Map<string, ListEntry>(catalog.listEntries.map((entry) => [entry.id, entry]))
  return preview.listChanges.map((change) => {
    const before = entries.get(change.entryId)
    if (!before) throw new Error(`Missing ListEntry ${change.entryId}`)
    if (change.kind === 'consolidate') {
      return {
        kind: 'consolidate',
        entryId: before.id,
        destinationEntryId: change.destinationEntryId,
        beforePayload: JSON.stringify(before),
      }
    }
    const after = listEntrySchema.parse({ ...before, workId: change.toWorkId })
    return {
      kind: 'move',
      entryId: before.id,
      beforePayload: JSON.stringify(before),
      afterPayload: JSON.stringify(after),
    }
  })
}

function applyListEntries(
  entries: readonly ListEntry[],
  mutations: readonly IdentityListMutation[],
): ListEntry[] {
  const mutationById = new Map(mutations.map((mutation) => [mutation.entryId, mutation]))
  return entries.flatMap((entry) => {
    const mutation = mutationById.get(entry.id)
    if (!mutation) return [entry]
    if (mutation.kind === 'consolidate') return []
    if (JSON.stringify(entry) !== mutation.beforePayload) {
      throw new Error(`ListEntry ${entry.id} changed after merge preview; review is required`)
    }
    return [listEntrySchema.parse(JSON.parse(mutation.afterPayload))]
  })
}

function undoListEntries(
  entries: readonly ListEntry[],
  mutations: readonly IdentityListMutation[],
): ListEntry[] {
  const restored = [...entries]
  for (const mutation of [...mutations].reverse()) {
    const before = listEntrySchema.parse(JSON.parse(mutation.beforePayload))
    const currentIndex = restored.findIndex(({ id }) => id === mutation.entryId)
    if (mutation.kind === 'move') {
      if (currentIndex === -1) throw new Error(`ListEntry ${mutation.entryId} is missing; undo cannot restore it`)
      if (JSON.stringify(restored[currentIndex]) !== mutation.afterPayload) {
        throw new Error(`ListEntry ${mutation.entryId} changed after merge; undo would overwrite later work`)
      }
      restored[currentIndex] = before
    } else {
      if (currentIndex !== -1) throw new Error(`ListEntry ${mutation.entryId} was recreated after merge`)
      if (!restored.some(({ id }) => id === mutation.destinationEntryId)) {
        throw new Error(`Destination ListEntry ${mutation.destinationEntryId} is missing; undo needs review`)
      }
      restored.push(before)
    }
  }
  return restored
}

async function persistEditionAssignments(
  database: SqlDatabase,
  before: Catalog,
  after: Catalog,
  operation: IdentityOperation,
): Promise<void> {
  const beforeById = new Map(before.editions.map((edition) => [edition.id, edition]))
  const afterById = new Map(after.editions.map((edition) => [edition.id, edition]))
  for (const editionId of operation.editionIds) {
    const previous = beforeById.get(editionId)
    const next = afterById.get(editionId)
    if (!previous || !next) throw new Error(`Missing Edition ${editionId}`)
    const result = await database.run(
      `UPDATE editions SET work_id = ?, payload_json = ?
       WHERE id = ? AND work_id = ?`,
      [next.workId, JSON.stringify(next), editionId, previous.workId],
    )
    if (result.changes !== 1) {
      throw new Error(`Edition ${editionId} changed concurrently; identity operation was not applied`)
    }
  }
}

async function applyListMutations(
  database: SqlDatabase,
  mutations: readonly IdentityListMutation[],
): Promise<void> {
  for (const mutation of mutations) {
    if (mutation.kind === 'move') {
      const before = listEntrySchema.parse(JSON.parse(mutation.beforePayload))
      const after = listEntrySchema.parse(JSON.parse(mutation.afterPayload))
      const result = await database.run(
        'UPDATE list_entries SET work_id = ?, payload_json = ? WHERE id = ? AND work_id = ?',
        [after.workId, mutation.afterPayload, mutation.entryId, before.workId],
      )
      if (result.changes !== 1) throw new Error(`ListEntry ${mutation.entryId} changed concurrently`)
    } else {
      const result = await database.run('DELETE FROM list_entries WHERE id = ?', [mutation.entryId])
      if (result.changes !== 1) throw new Error(`ListEntry ${mutation.entryId} changed concurrently`)
    }
  }
}

async function undoListMutations(
  database: SqlDatabase,
  mutations: readonly IdentityListMutation[],
): Promise<void> {
  for (const mutation of [...mutations].reverse()) {
    const before = listEntrySchema.parse(JSON.parse(mutation.beforePayload))
    if (mutation.kind === 'move') {
      const after = listEntrySchema.parse(JSON.parse(mutation.afterPayload))
      const result = await database.run(
        'UPDATE list_entries SET work_id = ?, payload_json = ? WHERE id = ? AND work_id = ?',
        [before.workId, mutation.beforePayload, mutation.entryId, after.workId],
      )
      if (result.changes !== 1) throw new Error(`ListEntry ${mutation.entryId} changed; undo needs review`)
    } else {
      await insertListEntry(database, before)
    }
  }
}

async function insertListEntry(database: SqlDatabase, entry: ListEntry): Promise<void> {
  await database.run(
    `INSERT INTO list_entries(id, list_id, work_id, position, created_at, updated_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [entry.id, entry.listId, entry.workId, entry.position, entry.createdAt, entry.updatedAt, JSON.stringify(entry)],
  )
}

async function insertJournal(database: SqlDatabase, journal: IdentityOperationJournal): Promise<void> {
  const { operation } = journal
  await database.run(
    `INSERT INTO identity_operations(
       id, kind, from_work_id, to_work_id, status, recorded_at, payload_json
     ) VALUES (?, ?, ?, ?, 'applied', ?, ?)`,
    [
      operation.id,
      operation.kind,
      operation.fromWorkId,
      operation.toWorkId,
      operation.recordedAt,
      JSON.stringify(journal),
    ],
  )
}

async function assertWorksExist(
  database: SqlDatabase,
  leftWorkId: WorkId,
  rightWorkId: WorkId,
): Promise<void> {
  const rows = await database.query(
    'SELECT id FROM works WHERE id = ? OR id = ?',
    [leftWorkId, rightWorkId],
  )
  const ids = new Set(rows.map((row) => readText(row, 'id')))
  if (!ids.has(leftWorkId)) throw new Error(`Missing Work ${leftWorkId}`)
  if (!ids.has(rightWorkId)) throw new Error(`Missing Work ${rightWorkId}`)
}

async function readJournal(database: SqlDatabase, operationId: string): Promise<IdentityOperationJournal> {
  const rows = await database.query('SELECT payload_json FROM identity_operations WHERE id = ?', [operationId])
  if (!rows[0]) throw new Error(`Missing identity operation ${operationId}`)
  return identityOperationJournalSchema.parse(JSON.parse(readText(rows[0], 'payload_json')))
}

async function replaceActiveDecision(
  database: SqlDatabase,
  decision: DuplicatePairDecision,
  supersededAt: string,
): Promise<void> {
  const rows = await database.query<SqlRow & { readonly id: string; readonly payload_json: string }>(
    `SELECT id, payload_json FROM duplicate_pair_decisions
     WHERE pair_key = ? AND undone_at IS NULL`,
    [decision.pairKey],
  )
  for (const row of rows) {
    const previous = duplicatePairDecisionSchema.parse(JSON.parse(readText(row, 'payload_json')))
    const superseded = duplicatePairDecisionSchema.parse({ ...previous, undoneAt: supersededAt })
    await database.run(
      'UPDATE duplicate_pair_decisions SET undone_at = ?, payload_json = ? WHERE id = ?',
      [supersededAt, JSON.stringify(superseded), readText(row, 'id')],
    )
  }
  await database.run(
    `INSERT INTO duplicate_pair_decisions(
       id, pair_key, left_work_id, right_work_id, action, survivor_work_id,
       operation_id, decided_at, undone_at, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      decision.id,
      decision.pairKey,
      decision.leftWorkId,
      decision.rightWorkId,
      decision.action,
      decision.survivorWorkId ?? null,
      decision.operationId ?? null,
      decision.decidedAt,
      JSON.stringify(decision),
    ],
  )
}

async function undoMergeDecision(
  database: SqlDatabase,
  operationId: string,
  undoneAt: string,
): Promise<void> {
  const rows = await database.query(
    `SELECT id, payload_json FROM duplicate_pair_decisions
     WHERE operation_id = ? AND undone_at IS NULL`,
    [operationId],
  )
  for (const row of rows) {
    const decision = duplicatePairDecisionSchema.parse(JSON.parse(readText(row, 'payload_json')))
    const undone = duplicatePairDecisionSchema.parse({ ...decision, undoneAt })
    await database.run(
      'UPDATE duplicate_pair_decisions SET undone_at = ?, payload_json = ? WHERE id = ?',
      [undoneAt, JSON.stringify(undone), decision.id],
    )
  }
}
