import type { LibraryBook } from '../library-model'
import { bookSubjectEvidence } from '../metadata/subjects'

export const REVIEW_GENRES = ['fantasy', 'mystery', 'romance', 'science-fiction', 'history', 'literary-fiction', 'nonfiction', 'horror'] as const
export type ReviewGenre = typeof REVIEW_GENRES[number]
export type SubjectClaim = {
  provider: string; sourceKey: string; scope: 'work' | 'edition'; observedAt: string
  values: readonly string[]
}
export type GenreEvidence = { override?: readonly string[] | null; claims: readonly SubjectClaim[] }
export type GenreClassification = {
  status: 'resolved' | 'unknown' | 'unresolved'
  families: ReviewGenre[]
  evidence: GenreEvidence
}
const normalize = (value: string) => value.toLowerCase().trim().replace(/\s+/g, ' ')

// Whole labels only. Keep qualifiers intact; new aliases require evidence review.
const aliases: Record<ReviewGenre, readonly string[]> = {
  fantasy: ['fantasy', 'fantasy fiction', 'fiction, fantasy, general'],
  mystery: ['mystery', 'mystery fiction', 'detective fiction', 'crime fiction', 'thrillers', 'thriller fiction',
    'mystery & detective - hard-boiled', 'mystery & detective - series', 'fiction - mystery/ detective'],
  romance: ['romance', 'romance fiction', 'fiction, romance, general', 'fiction, romance, historical, general'],
  'science-fiction': ['science fiction', 'fiction, science fiction, general'],
  history: ['nonfiction history', 'nonfiction / history', 'history (nonfiction)'],
  'literary-fiction': ['literary fiction', 'fiction, literary', 'fiction / literary'],
  nonfiction: ['nonfiction', 'non-fiction', 'nonfiction / education', 'nonfiction / biography', 'nonfiction / memoir',
    'nonfiction / essays', 'nonfiction / science', 'nonfiction / self-help'],
  horror: ['horror', 'horror fiction', 'horror tales', 'ghost stories'],
}
const fiction = new Set<ReviewGenre>(['fantasy', 'mystery', 'romance', 'science-fiction', 'literary-fiction', 'horror'])

function classifyLabels(raw: readonly string[]) {
  const labels = new Set(raw.map(normalize))
  const families = REVIEW_GENRES.filter(family => aliases[family].some(alias => labels.has(alias)))
  if (families.includes('nonfiction') && labels.has('history')) families.push('history')
  const criticism = ['criticism and interpretation', 'history and criticism', 'literary criticism'].some(label => labels.has(label))
  const fictional = families.some(f => fiction.has(f)) || ['fiction', 'historical fiction', 'fiction, historical, general'].some(label => labels.has(label))
  const contradictory = fictional && (families.includes('history') || families.includes('nonfiction'))
  if (contradictory || (criticism && families.some(f => fiction.has(f)))) return { families: [], conflict: true }
  return { families: REVIEW_GENRES.filter(f => families.includes(f) && !(f === 'nonfiction' && families.includes('history'))), conflict: false }
}

export function classifyGenres(evidence: GenreEvidence): GenreClassification {
  evidence = { ...(evidence.override !== undefined ? { override: evidence.override === null ? null : [...evidence.override].sort() } : {}),
    claims: evidence.claims.map(claim => ({ ...claim, values: [...claim.values].sort() })).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))) }
  const classifications = evidence.override !== undefined
    ? [classifyLabels(evidence.override ?? [])]
    : evidence.claims.map(claim => classifyLabels(claim.values))
  const usable = classifications.filter(value => value.families.length)
  // A multi-genre label set is valid. Independent peers reporting different sets are not
  // evidence of a multi-genre work; neither provider nor embedded metadata wins by recency.
  const conflict = classifications.some(value => value.conflict)
    || evidence.override === undefined && classifyLabels(evidence.claims.flatMap(claim => claim.values)).conflict
    || usable.some(value => value.families.join(',') !== usable[0]!.families.join(','))
  return { status: conflict ? 'unresolved' : usable.length ? 'resolved' : 'unknown',
    families: conflict ? [] : usable[0]?.families ?? [], evidence: structuredClone(evidence) }
}

export function genresForBooks(books: readonly LibraryBook[], embedded: readonly SubjectClaim[] = []): GenreClassification {
  books = [...books].sort((a, b) => a.id.localeCompare(b.id))
  const all = books.map(bookSubjectEvidence)
  const correctedBooks = books.filter(book => book.subjectOverride !== undefined)
  const overrides = correctedBooks.map(book => book.subjectOverride!)
  if (overrides.length) {
    const resolved = overrides.map(override => classifyGenres({ override, claims: [] }))
    if (resolved.some(r => r.status === 'unresolved' || r.families.join(',') !== resolved[0]!.families.join(','))) {
      return { status: 'unresolved', families: [], evidence: { claims: overrides.map((values, i) => ({
        provider: 'reader', scope: 'work', sourceKey: correctedBooks[i]!.id, observedAt: correctedBooks[i]!.lastUpdatedAt, values: values ?? [],
      })) } }
    }
    return classifyGenres({ override: overrides[0], claims: [] })
  }
  return classifyGenres({ claims: [...all.flatMap(e => e.claims), ...embedded] })
}

export function suggestGenre(finishes: readonly { workId: string; classification: GenreClassification }[]) {
  const unique = new Map(finishes.map(finish => [finish.workId, finish.classification]))
  const counts = Object.fromEntries(REVIEW_GENRES.map(family => [family, 0])) as Record<ReviewGenre, number>
  let classified = 0
  for (const value of unique.values()) {
    if (value.status !== 'resolved' || !value.families.length) continue
    classified++
    for (const family of new Set(value.families)) counts[family]++
  }
  const total = unique.size
  const unknown = total - classified
  const ranked = [...REVIEW_GENRES].sort((a, b) => counts[b] - counts[a] || REVIEW_GENRES.indexOf(a) - REVIEW_GENRES.indexOf(b))
  const leaders = ranked.filter(f => counts[f] > 0 && counts[f] === counts[ranked[0]!])
  const suggested = total > 0 && classified * 100 >= total * 51 && leaders.length === 1
    && counts[ranked[0]!] - counts[ranked[1]!] > unknown ? leaders[0] : undefined
  return { total, classified, unknown, counts, suggested: suggested ?? null,
    wording: suggested ? 'inspired-by-your-reading' : 'choose-your-pathway',
    choices: leaders.length > 1 ? [...leaders, ...REVIEW_GENRES.filter(f => !leaders.includes(f))] : [...REVIEW_GENRES],
    // Choice/skip belongs to keepsake state, never to this evidence calculation.
    classifications: [...unique].sort(([a], [b]) => a.localeCompare(b)).map(([workId, classification]) => ({ workId, ...classification })),
  }
}
