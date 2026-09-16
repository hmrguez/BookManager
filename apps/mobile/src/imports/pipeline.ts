import type { LibraryBook } from '../library-model'
import { canonicalEditionIsbn } from '../metadata/model'
import { planLibraryBookCommit, importedLibraryBookId } from './commit-rules'
import type { ImportParser } from './csv-parser'
import {
  importPreviewSchema,
  type ImportMatchCandidate,
  type ImportPreview,
  type ImportProposal,
  type ImportReceipt,
  type ImportSource,
  type NormalizedLibraryBook,
} from './model'

const MAX_IMPORT_BYTES = 10 * 1024 * 1024
const MAX_IMPORT_ROWS = 50_000

export const WOVENLEAF_CSV_SOURCE: ImportSource = {
  key: 'wovenleaf-csv',
  name: 'Wovenleaf library CSV',
  permissions: [
    {
      scope: 'local-file:read',
      access: 'read',
      required: true,
      label: 'Read the selected file',
      explanation: 'The picker grants access to this CSV only; its rows stay on this device.',
    },
    {
      scope: 'library:write',
      access: 'write',
      required: true,
      label: 'Write reviewed library fields',
      explanation: 'Only included rows and the fields listed in their change preview can be changed.',
    },
    {
      scope: 'network:none',
      access: 'none',
      required: false,
      label: 'No network access',
      explanation: 'Parsing, matching, review, commit, checkpoints, and undo all run locally.',
    },
  ],
}

export const GOODREADS_CSV_SOURCE: ImportSource = {
  key: 'goodreads-csv',
  name: 'Goodreads library export',
  permissions: [
    {
      scope: 'local-file:read',
      access: 'read',
      required: true,
      label: 'Read this export only',
      explanation: 'Wovenleaf receives the file you choose or share; it cannot browse your Downloads folder.',
    },
    {
      scope: 'library:write',
      access: 'write',
      required: true,
      label: 'Add the library you review',
      explanation: 'Books, shelves, ratings, notes, and reading dates are written together after confirmation.',
    },
    {
      scope: 'network:none',
      access: 'none',
      required: false,
      label: 'No account connection',
      explanation: 'The export is recognized, parsed, matched, and committed entirely on this device.',
    },
  ],
}

export type CreateImportPreviewInput = {
  readonly id: string
  readonly fileName: string
  readonly content: string
  readonly createdAt: string
  readonly parser: ImportParser
  readonly source?: ImportSource
  readonly existingBooks: readonly LibraryBook[]
  readonly receipts?: readonly ImportReceipt[]
  readonly onProgress?: (preview: ImportPreview, total: number) => void | Promise<void>
}

export async function createImportPreview(input: CreateImportPreviewInput): Promise<ImportPreview> {
  const source = input.source ?? WOVENLEAF_CSV_SOURCE
  if (!input.parser.accepts(input.fileName, input.content)) {
    throw new Error(`${input.parser.id} cannot parse ${input.fileName}`)
  }
  const byteLength = new TextEncoder().encode(input.content).byteLength
  if (byteLength > MAX_IMPORT_BYTES) {
    throw new Error('Import files are limited to 10 MB so review remains responsive')
  }
  const rows = input.parser.parse(input.content)
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import files are limited to ${MAX_IMPORT_ROWS.toLocaleString()} data rows`)
  }
  const receipts = new Map(
    (input.receipts ?? [])
      .filter((receipt) => receipt.sourceKey === source.key)
      .map((receipt) => [receiptKey(receipt.externalKey, receipt.rowHash), receipt]),
  )
  const proposals: ImportProposal[] = []
  const firstRowByExternalKey = new Map<string, number>()
  const contentHash = await sha256(input.content)
  const partialPreview = (): ImportPreview => ({
    id: input.id, source, parser: { id: input.parser.id, version: input.parser.version },
    fileName: input.fileName, contentHash, createdAt: input.createdAt, status: 'review',
    completedStages: ['parse', 'normalize', 'match', 'propose', 'review'], proposals: [...proposals],
  })
  const prepareRow = async (row: (typeof rows)[number]) => {
    const normalized = input.parser.normalize(row)
    return { normalized, rowHash: await sha256(stableJson(normalized.ok ? normalized.record : row.raw)) }
  }
  let chunk: Awaited<ReturnType<typeof prepareRow>>[] = []

  for (const [index, row] of rows.entries()) {
    if (index % 100 === 0) {
      await input.onProgress?.(partialPreview(), rows.length)
      chunk = await Promise.all(rows.slice(index, index + 100).map(prepareRow))
    }
    const { normalized, rowHash } = chunk[index % 100]!
    const id = `${input.id}:row:${row.rowNumber}`
    if (!normalized.ok) {
      proposals.push({
        id,
        rowNumber: row.rowNumber,
        raw: row.raw,
        rowHash,
        kind: 'error',
        match: {
          confidence: 'none',
          candidates: [],
          reasons: ['The row could not become a normalized import record.'],
        },
        changes: [],
        entities: [],
        reason: 'Fix the source row or exclude it before committing.',
        validationErrors: [...normalized.errors],
        defaultIncluded: false,
      })
      continue
    }

    const firstRow = firstRowByExternalKey.get(normalized.record.externalKey)
    if (firstRow !== undefined) {
      proposals.push({
        id,
        rowNumber: row.rowNumber,
        raw: row.raw,
        externalKey: normalized.record.externalKey,
        rowHash,
        kind: 'error',
        record: normalized.record,
        match: {
          confidence: 'none',
          candidates: [],
          reasons: [`The source-local identity already appears on row ${firstRow}.`],
        },
        changes: [],
        entities: [],
        reason: 'Repeated source identities are quarantined instead of being merged by row order.',
        validationErrors: [`External key “${normalized.record.externalKey}” repeats row ${firstRow}`],
        defaultIncluded: false,
      })
      continue
    }
    firstRowByExternalKey.set(normalized.record.externalKey, row.rowNumber)

    const receipt = receipts.get(receiptKey(normalized.record.externalKey, rowHash))
    if (receipt) {
      proposals.push({
        id,
        rowNumber: row.rowNumber,
        raw: row.raw,
        externalKey: normalized.record.externalKey,
        rowHash,
        kind: 'skip',
        record: normalized.record,
        targetId: receipt.targetId,
        match: {
          confidence: 'exact',
          targetId: receipt.targetId,
          candidates: [],
          reasons: ['This exact source row already has a committed receipt.'],
        },
        changes: [],
        entities: [],
        reason: 'Already imported; repeating it creates zero changes.',
        validationErrors: [],
        defaultIncluded: false,
        duplicateOfBatchId: receipt.batchId,
      })
      continue
    }

    proposals.push(proposeRow({
      id,
      rowNumber: row.rowNumber,
      rowHash,
      raw: row.raw,
      record: normalized.record,
      source,
      existingBooks: input.existingBooks,
      timestamp: input.createdAt,
    }))
  }

  await input.onProgress?.(partialPreview(), rows.length)
  return importPreviewSchema.parse(partialPreview())
}

function proposeRow(input: {
  id: string
  rowNumber: number
  rowHash: string
  raw: Readonly<Record<string, string>>
  record: NormalizedLibraryBook
  source: ImportSource
  existingBooks: readonly LibraryBook[]
  timestamp: string
}): ImportProposal {
  const exactIds = new Set([
    input.record.externalKey,
    importedLibraryBookId(input.source.key, input.record.externalKey),
  ])
  const exact = input.existingBooks.find(({ id }) => exactIds.has(id))
  if (exact) {
    const plan = planLibraryBookCommit(input.record, input.source.key, input.timestamp, exact)
    return {
      id: input.id,
      rowNumber: input.rowNumber,
      raw: input.raw,
      externalKey: input.record.externalKey,
      rowHash: input.rowHash,
      kind: plan.changes.length ? 'update' : 'skip',
      record: input.record,
      targetId: exact.id,
      match: {
        confidence: 'exact',
        targetId: exact.id,
        candidates: [candidate(exact, 1, ['The source-local identifier matches exactly.'])],
        reasons: ['The source-local identifier matches exactly.'],
      },
      changes: [...plan.changes],
      entities: [],
      reason: plan.changes.length
        ? `Update ${plan.changes.length} reviewed field${plan.changes.length === 1 ? '' : 's'} on the exact match.`
        : 'The canonical record already has every proposed value.',
      validationErrors: [],
      defaultIncluded: true,
    }
  }

  const importedIdentifiers = new Set(
    (input.record.identifiers ?? []).flatMap((identifier) => canonicalEditionIsbn(identifier) ?? []),
  )
  const identifierMatches = importedIdentifiers.size
    ? input.existingBooks.filter((book) => book.identifiers?.some((identifier) => {
        const canonical = canonicalEditionIsbn(identifier)
        return canonical ? importedIdentifiers.has(canonical) : false
      }))
    : []
  if (identifierMatches.length === 1) {
    const [book] = identifierMatches
    const plan = planLibraryBookCommit(input.record, input.source.key, input.timestamp, book)
    return {
      id: input.id,
      rowNumber: input.rowNumber,
      raw: input.raw,
      externalKey: input.record.externalKey,
      rowHash: input.rowHash,
      kind: plan.changes.length ? 'update' : 'skip',
      record: input.record,
      targetId: book.id,
      match: {
        confidence: 'high',
        targetId: book.id,
        candidates: [candidate(book, 0.98, ['An edition ISBN matches exactly.'])],
        reasons: ['An edition ISBN matches exactly.'],
      },
      changes: [...plan.changes],
      entities: [],
      reason: 'The exported edition identifier matches one book already in this library.',
      validationErrors: [],
      defaultIncluded: true,
    }
  }
  if (identifierMatches.length > 1) {
    return {
      id: input.id,
      rowNumber: input.rowNumber,
      raw: input.raw,
      externalKey: input.record.externalKey,
      rowHash: input.rowHash,
      kind: 'conflict',
      record: input.record,
      match: {
        confidence: 'high',
        candidates: identifierMatches.map((book) => candidate(book, 0.98, ['An edition ISBN matches exactly.'])),
        reasons: ['The same edition ISBN appears on more than one local record.'],
      },
      changes: [],
      entities: [],
      reason: 'Choose which local record owns this Goodreads row; Wovenleaf will not merge duplicates silently.',
      validationErrors: [],
      defaultIncluded: false,
    }
  }

  const similar = input.existingBooks
    .map((book) => ({ book, ...similarity(input.record, book) }))
    .filter(({ score }) => score >= 0.72)
    .sort((left, right) => right.score - left.score || left.book.id.localeCompare(right.book.id))

  if (similar.length === 1) {
    const match = similar[0]!
    const plan = planLibraryBookCommit(input.record, input.source.key, input.timestamp, match.book)
    return {
      id: input.id,
      rowNumber: input.rowNumber,
      raw: input.raw,
      externalKey: input.record.externalKey,
      rowHash: input.rowHash,
      kind: 'update',
      record: input.record,
      targetId: match.book.id,
      match: {
        confidence: 'low',
        targetId: match.book.id,
        candidates: [candidate(match.book, match.score, match.reasons)],
        reasons: match.reasons,
      },
      changes: [...plan.changes],
      entities: [],
      reason: 'Title and author suggest one match, but no stable identifier proves it.',
      validationErrors: [],
      defaultIncluded: false,
    }
  }

  if (similar.length > 1) {
    return {
      id: input.id,
      rowNumber: input.rowNumber,
      raw: input.raw,
      externalKey: input.record.externalKey,
      rowHash: input.rowHash,
      kind: 'conflict',
      record: input.record,
      match: {
        confidence: 'low',
        candidates: similar.map(({ book, score, reasons }) => candidate(book, score, reasons)),
        reasons: ['More than one library record has comparable title and author evidence.'],
      },
      changes: [],
      entities: [],
      reason: 'Choose the intended book or create a new record; Wovenleaf will not guess.',
      validationErrors: [],
      defaultIncluded: false,
    }
  }

  const plan = planLibraryBookCommit(input.record, input.source.key, input.timestamp)
  return {
    id: input.id,
    rowNumber: input.rowNumber,
    raw: input.raw,
    externalKey: input.record.externalKey,
    rowHash: input.rowHash,
    kind: 'add',
    record: input.record,
    targetId: plan.targetId,
    match: {
      confidence: 'none',
      candidates: [],
      reasons: ['No stable identifier or strong title-and-author match exists in this library.'],
    },
    changes: [...plan.changes],
    entities: [],
    reason: 'Create a new library record with a stable source-local identity.',
    validationErrors: [],
    defaultIncluded: true,
  }
}

function similarity(record: NormalizedLibraryBook, book: LibraryBook) {
  const titleMatches = normalizeText(record.title) === normalizeText(book.title)
  const importedAuthors = new Set(record.authors.map(normalizeText))
  const authorsMatch = book.authors.some((author) => importedAuthors.has(normalizeText(author)))
  const score = (titleMatches ? 0.58 : 0) + (authorsMatch ? 0.28 : 0)
  const reasons = [
    titleMatches ? 'Normalized titles are identical.' : 'Titles differ.',
    authorsMatch ? 'At least one normalized author is identical.' : 'Authors differ.',
  ]
  return { score, reasons }
}

function candidate(
  book: LibraryBook,
  score: number,
  reasons: readonly string[],
): ImportMatchCandidate {
  return { targetId: book.id, title: book.title, authors: book.authors, score, reasons: [...reasons] }
}

function normalizeText(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function receiptKey(externalKey: string, rowHash: string): string {
  return `${externalKey}\u0000${rowHash}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
