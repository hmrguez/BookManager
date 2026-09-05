import { libraryBookSchema, type LibraryBook } from '../library-model'
import { planLibraryBookCommit } from '../imports/commit-rules'
import { canonicalImportAdapterFor } from '../imports/canonical-adapters'
import { selectCsvParser } from '../imports/csv-parser'
import {
  IMPORT_STAGES,
  importPreviewSchema,
  importReviewDecisionSchema,
  importStoredValueSchema,
  type ImportBatchStatus,
  type ImportBatchSummary,
  type ImportCommitResult,
  type ImportPreview,
  type ImportProposal,
  type ImportReceipt,
  type ImportReviewDecision,
  type ImportStoredValue,
  type ImportUndoResult,
} from '../imports/model'
import { createImportPreview, GOODREADS_CSV_SOURCE, WOVENLEAF_CSV_SOURCE } from '../imports/pipeline'
import type { SqlDatabase, SqlRow } from './database'
import { readNumber, readText } from './database'
import { readLibraryBooks, writeLibraryBook } from './library-repository'
import {
  CatalogRepository,
  deleteImportableCatalogEntity,
  readImportableCatalogEntity,
  upsertImportableCatalogEntity,
  type ImportableCatalogEntityType,
} from './catalog-repository'

export type ImportRepositoryOptions = {
  readonly now?: () => Date
  readonly createId?: (kind: 'batch' | 'change' | 'checkpoint' | 'receipt') => string
}

type BatchRow = SqlRow & {
  readonly id: string
  readonly file_name: string
  readonly status: string
  readonly created_at: string
  readonly committed_at: string | null
  readonly undone_at: string | null
  readonly payload_json: string
}

type ChangeRow = SqlRow & {
  readonly id: string
  readonly row_id: string
  readonly entity_type: string
  readonly entity_id: string
  readonly field: string
  readonly before_json: string
  readonly after_json: string
}

export class ImportRepository {
  readonly #database: SqlDatabase
  readonly #now: () => Date
  readonly #createId: NonNullable<ImportRepositoryOptions['createId']>

  constructor(database: SqlDatabase, options: ImportRepositoryOptions = {}) {
    this.#database = database
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? ((kind) => `import-${kind}:${crypto.randomUUID()}`)
  }

  async previewCsv(fileName: string, content: string): Promise<ImportPreview> {
    const parser = selectCsvParser(fileName, content)
    const source = parser.id === 'goodreads-library-export' ? GOODREADS_CSV_SOURCE : WOVENLEAF_CSV_SOURCE
    let preview = await createImportPreview({
      id: this.#createId('batch'),
      fileName,
      content,
      createdAt: this.#now().toISOString(),
      parser,
      source,
      existingBooks: await readLibraryBooks(this.#database),
      receipts: await this.#listReceipts(),
    })
    const canonicalAdapter = canonicalImportAdapterFor(source.key)
    if (canonicalAdapter) {
      const catalog = await new CatalogRepository(this.#database).read()
      const proposals = await Promise.all(preview.proposals.map(async (proposal) => {
        if (
          !proposal.record
          || !proposal.targetId
          || proposal.kind === 'error'
          || proposal.duplicateOfBatchId
        ) return proposal
        const plan = await canonicalAdapter.plan({
          proposal,
          targetBookId: proposal.targetId,
          batchId: preview.id,
          timestamp: preview.createdAt,
          catalog,
        })
        const hasCanonicalChanges = plan.entities.some(({ action }) => action !== 'unchanged')
        return {
          ...proposal,
          kind: proposal.kind === 'skip' && hasCanonicalChanges ? 'update' as const : proposal.kind,
          reason: proposal.kind === 'skip' && hasCanonicalChanges
            ? 'The book is current; new Goodreads source or reading-history evidence will be added.'
            : proposal.reason,
          entities: plan.entities,
        }
      }))
      preview = importPreviewSchema.parse({ ...preview, proposals })
    }
    await this.#stage(preview)
    return preview
  }

  async readPreview(batchId: string): Promise<ImportPreview> {
    return readPreview(this.#database, batchId)
  }

  async commit(
    batchId: string,
    inputDecisions: readonly ImportReviewDecision[] = [],
  ): Promise<ImportCommitResult> {
    const decisions = inputDecisions.map((decision) => importReviewDecisionSchema.parse(decision))
    if (new Set(decisions.map(({ rowId }) => rowId)).size !== decisions.length) {
      throw new Error('An import row can have only one review decision')
    }
    const decisionByRow = new Map(decisions.map((decision) => [decision.rowId, decision]))
    const committedAt = this.#now().toISOString()

    return this.#database.transaction(async (database) => {
      const preview = await readPreview(database, batchId)
      const status = await readBatchStatus(database, batchId)
      if (status !== 'review') throw new Error(`Import batch ${batchId} is already ${status}`)
      const proposalIds = new Set(preview.proposals.map(({ id }) => id))
      decisions.forEach(({ rowId }) => {
        if (!proposalIds.has(rowId)) throw new Error(`Review decision references unknown row ${rowId}`)
      })

      const books = await readLibraryBooks(database)
      let appliedRows = 0
      let appliedChanges = 0
      let excludedRows = 0
      let skippedRows = 0
      let duplicateRows = 0
      let sequence = 0

      for (const proposal of preview.proposals) {
        const decision = decisionByRow.get(proposal.id)
        const included = decision?.included ?? proposal.defaultIncluded
        if (proposal.duplicateOfBatchId) {
          duplicateRows += 1
          await setRowDecision(database, proposal.id, 'duplicate', proposal.targetId)
          continue
        }
        if (!included) {
          excludedRows += 1
          await setRowDecision(database, proposal.id, 'excluded', decision?.targetId ?? proposal.targetId)
          continue
        }
        if (!proposal.record || proposal.kind === 'error') {
          await setRowDecision(database, proposal.id, 'error', decision?.targetId)
          throw new Error(`Row ${proposal.rowNumber} has validation errors and cannot be committed`)
        }

        const targetId = decision?.targetId ?? proposal.targetId
        if (!targetId) {
          throw new Error(`Row ${proposal.rowNumber} needs an explicit match or exclusion`)
        }
        const existing = books.find((book) => book.id === targetId)
        assertPreviewIsCurrent(proposal, decision, existing)
        const plan = planLibraryBookCommit(
          proposal.record,
          preview.source.key,
          preview.createdAt,
          existing,
        )
        if (plan.targetId !== targetId && !existing) {
          throw new Error(`Row ${proposal.rowNumber} cannot create an arbitrary target ID`)
        }

        const receiptId = this.#createId('receipt')
        const receipt = await database.run(
          `INSERT INTO import_row_receipts(
             id, source_key, external_key, row_hash, batch_id, row_id, target_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_key, external_key, row_hash) DO NOTHING`,
          [
            receiptId,
            preview.source.key,
            proposal.record.externalKey,
            proposal.rowHash,
            batchId,
            proposal.id,
            plan.targetId,
            committedAt,
          ],
        )
        if (receipt.changes === 0) {
          duplicateRows += 1
          await setRowDecision(database, proposal.id, 'duplicate', plan.targetId)
          continue
        }

        if (plan.changes.length) {
          await writeLibraryBook(database, plan.after)
          const bookIndex = books.findIndex(({ id }) => id === plan.targetId)
          if (bookIndex === -1) books.push(plan.after)
          else books[bookIndex] = plan.after

          for (const change of plan.changes) {
            sequence += 1
            await database.run(
              `INSERT INTO import_changes(
                 id, batch_id, row_id, sequence, entity_type, entity_id, field,
                 before_json, after_json, reason, applied_at
               ) VALUES (?, ?, ?, ?, 'library-book', ?, ?, ?, ?, ?, ?)`,
              [
                this.#createId('change'),
                batchId,
                proposal.id,
                sequence,
                plan.targetId,
                change.field,
                JSON.stringify(change.before),
                JSON.stringify(change.after),
                change.reason,
                committedAt,
              ],
            )
          }
        }
        let canonicalChangeCount = 0
        const canonicalAdapter = canonicalImportAdapterFor(preview.source.key)
        if (canonicalAdapter) {
          const catalog = await new CatalogRepository(database).read()
          const canonicalPlan = await canonicalAdapter.plan({
            proposal,
            targetBookId: plan.targetId,
            batchId,
            timestamp: preview.createdAt,
            catalog,
          })
          for (const change of canonicalPlan.changes) {
            await upsertImportableCatalogEntity(database, change.entityType, change.after)
            sequence += 1
            await database.run(
              `INSERT INTO import_changes(
                 id, batch_id, row_id, sequence, entity_type, entity_id, field,
                 before_json, after_json, reason, applied_at
               ) VALUES (?, ?, ?, ?, ?, ?, '$record', ?, ?, ?, ?)`,
              [
                this.#createId('change'),
                batchId,
                proposal.id,
                sequence,
                change.entityType,
                change.entityId,
                JSON.stringify(stored(change.before)),
                JSON.stringify(stored(change.after)),
                change.reason,
                committedAt,
              ],
            )
          }
          canonicalChangeCount = canonicalPlan.changes.length
        }
        const rowChangeCount = plan.changes.length + canonicalChangeCount
        appliedChanges += rowChangeCount
        if (!rowChangeCount) skippedRows += 1
        appliedRows += 1
        await setRowDecision(database, proposal.id, rowChangeCount ? 'included' : 'skipped', plan.targetId)
      }

      const previousRows = await database.query(
        `SELECT id FROM import_checkpoints
         WHERE source_key = ? ORDER BY committed_at DESC, id DESC LIMIT 1`,
        [preview.source.key],
      )
      const previousCheckpointId = previousRows[0] ? readText(previousRows[0], 'id') : null
      const checkpointId = this.#createId('checkpoint')
      const checkpointPayload = {
        batchId,
        sourceKey: preview.source.key,
        contentHash: preview.contentHash,
        completedStages: IMPORT_STAGES,
        appliedRows,
        appliedChanges,
        excludedRows,
        skippedRows,
        duplicateRows,
      }
      await database.run(
        `INSERT INTO import_checkpoints(
           id, batch_id, source_key, previous_checkpoint_id, content_hash, committed_at, payload_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          checkpointId,
          batchId,
          preview.source.key,
          previousCheckpointId,
          preview.contentHash,
          committedAt,
          JSON.stringify(checkpointPayload),
        ],
      )
      await database.run(
        `UPDATE import_batches SET status = 'committed', committed_at = ? WHERE id = ?`,
        [committedAt, batchId],
      )

      return { checkpointId, ...checkpointPayload }
    })
  }

  async undo(batchId: string): Promise<ImportUndoResult> {
    const undoneAt = this.#now().toISOString()
    return this.#database.transaction(async (database) => {
      const status = await readBatchStatus(database, batchId)
      if (status !== 'committed') throw new Error(`Import batch ${batchId} is ${status}, not committed`)
      const rows = await database.query<ChangeRow>(
        `SELECT id, row_id, entity_type, entity_id, field, before_json, after_json
         FROM import_changes WHERE batch_id = ? ORDER BY sequence DESC`,
        [batchId],
      )
      const books = new Map((await readLibraryBooks(database)).map((book) => [book.id, book]))
      const preservedRows = new Set<string>()
      let restoredChanges = 0
      let preservedChanges = 0
      let deletedEntities = 0

      for (const row of rows) {
        const changeId = readText(row, 'id')
        const rowId = readText(row, 'row_id')
        const entityType = readText(row, 'entity_type')
        const entityId = readText(row, 'entity_id')
        const field = readText(row, 'field')
        const before = importStoredValueSchema.parse(JSON.parse(readText(row, 'before_json')))
        const after = importStoredValueSchema.parse(JSON.parse(readText(row, 'after_json')))
        const current = entityType === 'library-book'
          ? books.get(entityId)
          : await readImportableCatalogEntity(
              database,
              entityType as ImportableCatalogEntityType,
              entityId,
            )
        let restored = false

        if (field === '$record') {
          const matchesCommittedValue = current && (
            sameStored(stored(current), after)
            || (
              entityType === 'library-book'
              && !before.present
              && matchesCoverEnrichedImport(current as LibraryBook, after)
            )
          )
          if (current && matchesCommittedValue) {
            if (before.present) {
              if (entityType === 'library-book') {
                const restoredBook = libraryBookSchema.parse(before.value)
                await writeLibraryBook(database, restoredBook)
                books.set(entityId, restoredBook)
              } else {
                await upsertImportableCatalogEntity(
                  database,
                  entityType as ImportableCatalogEntityType,
                  before.value,
                )
              }
              restored = true
            } else if (entityType === 'library-book') {
              await database.run('DELETE FROM library_books WHERE id = ?', [entityId])
              books.delete(entityId)
              restored = true
              deletedEntities += 1
            } else {
              restored = await deleteImportableCatalogEntity(
                database,
                entityType as ImportableCatalogEntityType,
                entityId,
              )
              if (restored) deletedEntities += 1
            }
          }
        } else if (entityType === 'library-book' && current && sameStored(storedField(current as LibraryBook, field), after)) {
          const restoredBook = restoreField(current as LibraryBook, field, before)
          await writeLibraryBook(database, restoredBook)
          books.set(entityId, restoredBook)
          restored = true
        }

        if (restored) restoredChanges += 1
        else {
          preservedChanges += 1
          preservedRows.add(rowId)
        }
        await database.run(
          `UPDATE import_changes SET undo_status = ?, undone_at = ? WHERE id = ?`,
          [restored ? 'restored' : 'preserved', undoneAt, changeId],
        )
      }

      const receiptRows = await database.query('SELECT row_id FROM import_row_receipts WHERE batch_id = ?', [batchId])
      for (const receipt of receiptRows) {
        const rowId = readText(receipt, 'row_id')
        if (!preservedRows.has(rowId)) {
          await database.run('DELETE FROM import_row_receipts WHERE batch_id = ? AND row_id = ?', [batchId, rowId])
        }
      }
      await database.run(
        `UPDATE import_batches SET status = 'undone', undone_at = ? WHERE id = ?`,
        [undoneAt, batchId],
      )
      return { batchId, restoredChanges, preservedChanges, deletedEntities }
    })
  }

  async listRecentBatches(limit = 10): Promise<ImportBatchSummary[]> {
    const rows = await this.#database.query(
      `SELECT
         batch.id,
         batch.file_name,
         batch.status,
         batch.created_at,
         batch.committed_at,
         batch.undone_at,
         batch.payload_json,
         COUNT(DISTINCT row.id) AS total_rows,
         COUNT(DISTINCT CASE WHEN row.decision IN ('included', 'skipped') THEN row.id END) AS applied_rows,
         COUNT(DISTINCT change.id) AS change_count
       FROM import_batches batch
       LEFT JOIN import_rows row ON row.batch_id = batch.id
       LEFT JOIN import_changes change ON change.batch_id = batch.id
       GROUP BY batch.id
       ORDER BY batch.created_at DESC, batch.id DESC
       LIMIT ?`,
      [limit],
    )
    return rows.map((row) => {
      const payload = JSON.parse(readText(row, 'payload_json')) as Pick<ImportPreview, 'source'>
      return {
        id: readText(row, 'id'),
        sourceName: payload.source.name,
        fileName: readText(row, 'file_name'),
        status: readText(row, 'status') as ImportBatchStatus,
        createdAt: readText(row, 'created_at'),
        committedAt: nullableText(row, 'committed_at'),
        undoneAt: nullableText(row, 'undone_at'),
        totalRows: readNumber(row, 'total_rows'),
        appliedRows: readNumber(row, 'applied_rows'),
        changeCount: readNumber(row, 'change_count'),
      }
    })
  }

  async #stage(preview: ImportPreview): Promise<void> {
    const { proposals: _proposals, ...batchPayload } = importPreviewSchema.parse(preview)
    await this.#database.transaction(async (database) => {
      await database.run(
        `INSERT INTO import_batches(
           id, source_key, parser_id, parser_version, file_name, content_hash,
           status, created_at, payload_json
         ) VALUES (?, ?, ?, ?, ?, ?, 'review', ?, ?)`,
        [
          preview.id,
          preview.source.key,
          preview.parser.id,
          preview.parser.version,
          preview.fileName,
          preview.contentHash,
          preview.createdAt,
          JSON.stringify(batchPayload),
        ],
      )
      for (const proposal of preview.proposals) {
        await database.run(
          `INSERT INTO import_rows(
             id, batch_id, row_number, external_key, row_hash, proposal_kind,
             decision, target_id, payload_json
           ) VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
          [
            proposal.id,
            preview.id,
            proposal.rowNumber,
            proposal.externalKey ?? null,
            proposal.rowHash,
            proposal.kind,
            proposal.targetId ?? null,
            JSON.stringify(proposal),
          ],
        )
      }
    })
  }

  async #listReceipts(): Promise<ImportReceipt[]> {
    const rows = await this.#database.query(
      `SELECT source_key, external_key, row_hash, batch_id, target_id FROM import_row_receipts`,
    )
    return rows.map((row) => ({
      sourceKey: readText(row, 'source_key'),
      externalKey: readText(row, 'external_key'),
      rowHash: readText(row, 'row_hash'),
      batchId: readText(row, 'batch_id'),
      targetId: readText(row, 'target_id'),
    }))
  }
}

async function readPreview(database: SqlDatabase, batchId: string): Promise<ImportPreview> {
  const batches = await database.query<BatchRow>(
    `SELECT id, file_name, status, created_at, committed_at, undone_at, payload_json
     FROM import_batches WHERE id = ?`,
    [batchId],
  )
  const batch = batches[0]
  if (!batch) throw new Error(`Missing import batch ${batchId}`)
  const payload = JSON.parse(readText(batch, 'payload_json')) as Omit<ImportPreview, 'proposals'>
  const rows = await database.query(
    'SELECT payload_json FROM import_rows WHERE batch_id = ? ORDER BY row_number, id',
    [batchId],
  )
  return importPreviewSchema.parse({
    ...payload,
    status: 'review',
    proposals: rows.map((row) => JSON.parse(readText(row, 'payload_json'))),
  })
}

async function readBatchStatus(database: SqlDatabase, batchId: string): Promise<ImportBatchStatus> {
  const rows = await database.query('SELECT status FROM import_batches WHERE id = ?', [batchId])
  if (!rows[0]) throw new Error(`Missing import batch ${batchId}`)
  return readText(rows[0], 'status') as ImportBatchStatus
}

async function setRowDecision(
  database: SqlDatabase,
  rowId: string,
  decision: 'included' | 'excluded' | 'skipped' | 'duplicate' | 'error',
  targetId?: string,
): Promise<void> {
  await database.run(
    'UPDATE import_rows SET decision = ?, target_id = ? WHERE id = ?',
    [decision, targetId ?? null, rowId],
  )
}

function assertPreviewIsCurrent(
  proposal: ImportProposal,
  decision: ImportReviewDecision | undefined,
  current: LibraryBook | undefined,
): void {
  if (decision?.targetId && decision.targetId !== proposal.targetId) {
    if (current && decision.targetUpdatedAt !== current.lastUpdatedAt) {
      throw new Error(
        `Row ${proposal.rowNumber} was remapped to a book that changed after review; review it again`,
      )
    }
    if (!current && decision.targetUpdatedAt !== undefined) {
      throw new Error(`Row ${proposal.rowNumber} was remapped to a book that no longer exists`)
    }
    return
  }
  if (proposal.kind === 'add' && current) {
    throw new Error(`Row ${proposal.rowNumber} now matches a record created after preview; review it again`)
  }
  if (!proposal.targetId || !current) return
  for (const change of proposal.changes) {
    if (change.field === '$record' || change.field === 'lastUpdatedAt') continue
    if (!sameStored(storedField(current, change.field), change.before)) {
      throw new Error(
        `Row ${proposal.rowNumber} is stale because ${change.field} changed after preview; review it again`,
      )
    }
  }
}

function restoreField(book: LibraryBook, field: string, before: ImportStoredValue): LibraryBook {
  const candidate: Record<string, unknown> = { ...book }
  if (before.present) candidate[field] = before.value
  else delete candidate[field]
  return libraryBookSchema.parse(candidate)
}

function storedField(book: LibraryBook, field: string): ImportStoredValue {
  const value = (book as unknown as Record<string, unknown>)[field]
  return value === undefined ? { present: false } : stored(value)
}

function stored(value: unknown): ImportStoredValue {
  return value === undefined
    ? { present: false }
    : {
        present: true,
        value: JSON.parse(JSON.stringify(value)) as NonNullable<ImportStoredValue['value']>,
      }
}

function sameStored(left: ImportStoredValue, right: ImportStoredValue): boolean {
  return left.present === right.present && JSON.stringify(left.value) === JSON.stringify(right.value)
}

function matchesCoverEnrichedImport(current: LibraryBook, imported: ImportStoredValue): boolean {
  if (!imported.present) return false
  const parsed = libraryBookSchema.safeParse(imported.value)
  if (!parsed.success || !current.thumbnail || parsed.data.thumbnail) return false
  return sameStored(stored({
    ...current,
    thumbnail: undefined,
    lastUpdatedAt: parsed.data.lastUpdatedAt,
  }), imported)
}

function nullableText(row: SqlRow, column: string): string | undefined {
  const value = row[column]
  if (value === null) return undefined
  return readText(row, column)
}
