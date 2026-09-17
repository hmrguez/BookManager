import type { LibraryBook } from '../library-model'

export type SeriesMembership = {
  name: string
  key: string
  position?: number
}

const numberedSeries = /^(.+?)\s*(?:,\s*|[-–:]\s*)?(?:#|book\s+|volume\s+|vol\.?\s+)(\d+(?:\.\d+)?)$/i
const titleSeries = /[([]([^()[\]]+)[)\]]\s*$/
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

/** Only explicit order markers count. Never infer a sequence from a bare title number. */
export function seriesMembership(book: LibraryBook): SeriesMembership | undefined {
  const declared = book.series?.[0]?.trim().replace(/^[([]|[)\]]$/g, '').trim()
  const titleAnnotation = book.title.match(titleSeries)?.[1]
  const numbered = declared?.match(numberedSeries)
    ?? titleAnnotation?.match(numberedSeries)
  const name = declared?.match(numberedSeries)?.[1]?.trim() ?? declared ?? numbered?.[1]?.trim()
  if (!name) return undefined
  // A title annotation for a different series must not supply the declared series' order.
  const annotationMatches = numbered && normalized(numbered[1]) === normalized(name)
  const position = book.seriesPosition ?? (annotationMatches ? Number(numbered[2]) : undefined)
  return {
    name,
    key: `${normalized(name)}\0${book.authors.map(normalized).sort().join('|')}`,
    ...(position && position <= 1000 ? { position } : {}),
  }
}

type SeriesProgress = { finished: Set<number>; unfinished: Set<number>; firstMissing: number; firstUnfinished: number }

/** Build once per comparison; eligibility lookups do not scan the library again. */
export function buildSeriesContext(books: readonly LibraryBook[]) {
  const memberships = new Map<string, SeriesMembership>()
  const progress = new Map<string, SeriesProgress>()
  for (const book of books) {
    const membership = seriesMembership(book)
    if (!membership) continue
    memberships.set(book.id, membership)
    if (membership.position === undefined) continue
    const entry = progress.get(membership.key) ?? { finished: new Set<number>(), unfinished: new Set<number>(), firstMissing: 1, firstUnfinished: Infinity }
    entry[book.shelf === 'finished' ? 'finished' : 'unfinished'].add(membership.position)
    progress.set(membership.key, entry)
  }
  for (const entry of progress.values()) {
    while (entry.finished.has(entry.firstMissing)) entry.firstMissing++
    for (const position of entry.unfinished) {
      if (!entry.finished.has(position)) entry.firstUnfinished = Math.min(entry.firstUnfinished, position)
    }
  }
  return {
    membership: (book: LibraryBook) => memberships.get(book.id),
    canReadNext(book: LibraryBook): boolean {
      const membership = memberships.get(book.id)
      const position = membership?.position
      if (!membership || position === undefined || position <= 1) return true
      const entry = progress.get(membership.key)!
      // Unknown/missing predecessors are not assumed finished. Fractional entries
      // only block when actually recorded, so we never invent a missing novella.
      return position <= entry.firstMissing && position <= entry.firstUnfinished
    },
  }
}

export type SeriesContext = ReturnType<typeof buildSeriesContext>
