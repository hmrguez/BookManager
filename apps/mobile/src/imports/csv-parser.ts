import { normalizedLibraryBookSchema, type NormalizedLibraryBook } from './model'

export type ParsedImportRow = {
  readonly rowNumber: number
  readonly raw: Readonly<Record<string, string>>
  readonly errors: readonly string[]
}

export type NormalizedImportResult =
  | { readonly ok: true; readonly record: NormalizedLibraryBook }
  | { readonly ok: false; readonly errors: readonly string[] }

export interface ImportParser {
  readonly id: string
  readonly version: string
  accepts(fileName: string): boolean
  parse(content: string): readonly ParsedImportRow[]
  normalize(row: ParsedImportRow): NormalizedImportResult
}

const HEADER_ALIASES = {
  externalKey: ['external_id', 'external_key', 'id'],
  title: ['title'],
  authors: ['authors', 'author'],
  pageCount: ['page_count', 'pages'],
  shelf: ['shelf', 'status'],
  progress: ['progress', 'progress_percent'],
  currentPage: ['current_page', 'page'],
  rating: ['rating'],
  notes: ['notes', 'review'],
  addedAt: ['added_at', 'date_added'],
  startedAt: ['started_at', 'date_started'],
  finishedAt: ['finished_at', 'date_finished'],
} as const

export const wovenleafCsvParser: ImportParser = {
  id: 'wovenleaf-library-csv',
  version: '1',
  accepts(fileName) {
    return fileName.toLocaleLowerCase().endsWith('.csv')
  },
  parse(content) {
    const parsed = parseCsv(content.replace(/^\uFEFF/, ''))
    if (!parsed.rows.length) return []
    const headers = parsed.rows[0]!.map(normalizeHeader)
    const dataRows = parsed.rows.slice(1)

    return dataRows.flatMap((values, index) => {
      if (values.every((value) => !value.trim())) return []
      const errors: string[] = []
      if (parsed.unclosedQuote && index === dataRows.length - 1) {
        errors.push('The final quoted field is not closed')
      }
      if (values.length > headers.length) {
        errors.push(`Expected ${headers.length} columns but found ${values.length}`)
      }
      const raw = Object.fromEntries(headers.map((header, column) => [header, values[column]?.trim() ?? '']))
      return [{ rowNumber: index + 2, raw, errors }]
    })
  },
  normalize(row) {
    const errors = [...row.errors]
    const value = (field: keyof typeof HEADER_ALIASES) =>
      HEADER_ALIASES[field].map((header) => row.raw[header]).find((entry) => entry !== undefined)?.trim()

    const title = value('title') ?? ''
    const authors = (value('authors') ?? '')
      .split(/\s*;\s*/)
      .map((author) => author.trim())
      .filter(Boolean)
    if (!title) errors.push('Title is required')
    if (!authors.length) errors.push('At least one author is required')

    const externalKey = value('externalKey') || identityKey(title, authors)
    const pageCount = parseInteger(value('pageCount'), 'Page count', 0, undefined, errors)
    const progress = parseNumber(value('progress'), 'Progress', 0, 100, errors)
    const currentPage = parseInteger(value('currentPage'), 'Current page', 0, undefined, errors)
    const rating = parseInteger(value('rating'), 'Rating', 0, 5, errors)
    const shelf = parseShelf(value('shelf'), errors)
    const addedAt = parseDate(value('addedAt'), 'Added date', errors)
    const startedAt = parseDate(value('startedAt'), 'Started date', errors)
    const finishedAt = parseDate(value('finishedAt'), 'Finished date', errors)

    if (pageCount !== undefined && currentPage !== undefined && currentPage > pageCount) {
      errors.push('Current page cannot exceed page count')
    }
    if (errors.length) return { ok: false, errors }

    const parsed = normalizedLibraryBookSchema.safeParse({
      externalKey,
      title,
      authors,
      pageCount,
      shelf,
      progress,
      currentPage,
      rating,
      notes: optional(value('notes')),
      addedAt,
      startedAt,
      finishedAt,
    })
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map(({ message }) => message) }
    }
    return { ok: true, record: parsed.data }
  },
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s-]+/g, '_')
}

function identityKey(title: string, authors: readonly string[]): string {
  return [title, ...authors].map(normalizeIdentityPart).filter(Boolean).join('|') || 'missing-identity'
}

function normalizeIdentityPart(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function optional(value: string | undefined): string | undefined {
  return value ? value : undefined
}

function parseShelf(value: string | undefined, errors: string[]) {
  if (!value) return undefined
  const normalized = value.toLocaleLowerCase().replace(/[\s_-]+/g, '')
  const shelves = {
    tbr: 'tbr',
    wanttoread: 'tbr',
    next: 'next',
    upnext: 'next',
    reading: 'reading',
    currentlyreading: 'reading',
    finished: 'finished',
    read: 'finished',
  } as const
  const shelf = shelves[normalized as keyof typeof shelves]
  if (!shelf) errors.push(`Unknown shelf “${value}”`)
  return shelf
}

function parseInteger(
  value: string | undefined,
  label: string,
  minimum: number,
  maximum: number | undefined,
  errors: string[],
): number | undefined {
  if (!value) return undefined
  if (!/^-?\d+$/.test(value)) {
    errors.push(`${label} must be a whole number`)
    return undefined
  }
  return parseBoundedNumber(Number(value), label, minimum, maximum, errors)
}

function parseNumber(
  value: string | undefined,
  label: string,
  minimum: number,
  maximum: number,
  errors: string[],
): number | undefined {
  if (!value) return undefined
  const parsed = Number(value.replace(/%$/, ''))
  if (!Number.isFinite(parsed)) {
    errors.push(`${label} must be a number`)
    return undefined
  }
  return parseBoundedNumber(parsed, label, minimum, maximum, errors)
}

function parseBoundedNumber(
  value: number,
  label: string,
  minimum: number,
  maximum: number | undefined,
  errors: string[],
): number | undefined {
  if (value < minimum || (maximum !== undefined && value > maximum)) {
    errors.push(
      maximum === undefined
        ? `${label} must be at least ${minimum}`
        : `${label} must be between ${minimum} and ${maximum}`,
    )
    return undefined
  }
  return value
}

function parseDate(value: string | undefined, label: string, errors: string[]): string | undefined {
  if (!value) return undefined
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
    errors.push(`${label} must be an ISO 8601 date with a timezone`)
    return undefined
  }
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    errors.push(`${label} is not a valid date`)
    return undefined
  }
  return parsed.toISOString()
}

/** RFC 4180-compatible enough for exports: quotes, escaped quotes, commas, and embedded newlines. */
function parseCsv(content: string): { rows: string[][]; unclosedQuote: boolean } {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
      continue
    }
    if (character === '"' && field === '') {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && content[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return { rows, unclosedQuote: quoted }
}
