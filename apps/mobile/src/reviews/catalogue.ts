export const REVIEW_RULE_VERSION = 'quarterly-evidence-v1'
export const REVIEW_SELECTION_VERSION = 'strongest-five-v1'
export type BadgeFamily = 'completion' | 'discovery' | 'time' | 'rhythm' | 'reflection' | 'progress'
export type BadgeDefinition = {
  id: string; name: string; family: BadgeFamily; unit: string; thresholds: readonly number[]
  /** A semantic caption key; localization must preserve this qualification. */
  fact: string
}
const badge = (id: string, name: string, family: BadgeFamily, unit: string, thresholds: number[], fact: string): BadgeDefinition =>
  ({ id, name, family, unit, thresholds, fact })

export const REVIEW_BADGES: readonly BadgeDefinition[] = [
  badge('01', 'Chapters Closed', 'completion', 'books', [1, 3, 6, 12, 24, 32], 'distinct-works-marked-finished'),
  badge('02', 'A Shelf of Stories', 'completion', 'pages', [100, 500, 1500, 3000, 6000, 7800], 'pages-across-books-finished'),
  badge('03', 'The Long Journey', 'completion', 'pages', [200, 350, 500, 750, 1000, 1300], 'pages-in-a-finished-book'),
  badge('04', 'Many Voices', 'discovery', 'authors', [1, 3, 5, 8, 12], 'authors-of-finished-works'),
  badge('05', 'A Familiar Voice', 'discovery', 'books', [2, 3, 4, 6, 8], 'finished-works-by-one-author'),
  badge('06', 'Another Chapter Together', 'discovery', 'books', [2, 3, 4, 6, 8], 'finished-works-in-one-series'),
  badge('07', 'Small Wonders', 'completion', 'books', [1, 3, 5, 8, 12], 'shorter-finished-books'),
  badge('08', 'Worth Remembering', 'completion', 'books', [1, 3, 5, 8, 12], 'finished-books-currently-rated-four-or-five'),
  badge('09', 'In Good Company', 'time', 'minutes', [60, 300, 900, 1800, 3600], 'recorded-listening-time'),
  badge('10', 'A Listening Ritual', 'rhythm', 'days', [3, 7, 15, 30, 60], 'recorded-listening-days'),
  badge('11', 'Room for Reading', 'rhythm', 'days', [3, 7, 15, 30, 60], 'recorded-active-days'),
  badge('12', 'Week by Week', 'rhythm', 'weeks', [2, 4, 6, 9, 12], 'weeks-with-recorded-active-days'),
  badge('13', 'A Steady Rhythm', 'rhythm', 'weeks', [1, 3, 5, 8, 12], 'weeks-with-three-recorded-active-days'),
  badge('14', 'Time Set Aside', 'rhythm', 'days', [1, 5, 10, 20, 40], 'days-with-twenty-recorded-minutes'),
  badge('15', 'Back to the Story', 'rhythm', 'days', [3, 5, 10, 20, 30], 'recorded-active-days-with-one-work'),
  badge('16', 'Longer Visits', 'time', 'visits', [1, 3, 6, 12, 24], 'visits-with-thirty-active-minutes'),
  badge('17', 'Open Worlds', 'discovery', 'books', [1, 3, 6, 10, 15], 'works-with-ten-recorded-minutes'),
  badge('18', 'Many Ways to Read', 'discovery', 'weeks', [1, 2, 4, 6, 10], 'weeks-with-ten-text-and-ten-audio-minutes'),
  badge('19', 'Across Languages', 'discovery', 'languages', [2, 3, 4, 5, 6], 'languages-of-editions-with-qualifying-activity'),
  badge('20', 'Places to Return To', 'reflection', 'bookmarks', [1, 3, 8, 15, 30], 'reader-bookmarks-kept'),
  badge('21', 'Moments to Replay', 'reflection', 'bookmarks', [1, 3, 8, 15, 30], 'audio-bookmarks-kept'),
  badge('22', 'Lines Worth Keeping', 'reflection', 'passages', [3, 10, 25, 50, 100], 'passages-kept'),
  badge('23', 'An Annotated Shelf', 'reflection', 'books', [1, 3, 5, 8, 12], 'works-with-passages-kept'),
  badge('24', 'Days of Reflection', 'reflection', 'days', [2, 5, 10, 20, 30], 'creation-days-of-passages-kept'),
  badge('25', 'Thoughts Between the Lines', 'reflection', 'passages', [3, 8, 15, 30, 60], 'passages-saved-this-quarter-now-with-notes'),
  badge('26', 'Listening Notebook', 'reflection', 'notes', [1, 3, 8, 15, 30], 'audio-text-notes-kept'),
  badge('27', 'Thoughts Aloud', 'reflection', 'notes', [1, 3, 6, 12, 24], 'audio-voice-notes-kept'),
  badge('28', 'Quiet Hours', 'time', 'minutes', [60, 300, 900, 1800, 3600], 'recorded-text-reading-time'),
  badge('29', 'Page by Page', 'progress', 'pages', [50, 250, 750, 1500, 3000], 'pages-consumed'),
  badge('30', 'Chapter by Chapter', 'progress', 'chapters', [3, 10, 25, 50, 100], 'chapters-consumed'),
]

export function badgeDevelopment(value: number | undefined, thresholds: readonly number[]) {
  if (value === undefined || !Number.isFinite(value) || value < 0 || !thresholds.length
    || thresholds.some((n, i) => !Number.isFinite(n) || n <= (thresholds[i - 1] ?? 0))) return undefined
  const tier = thresholds.filter(n => value >= n).length
  if (!tier) return undefined
  const lower = thresholds[tier - 1]!
  const upper = thresholds[tier]
  return { tier, development: 20 * (tier + (upper === undefined ? 0 : (value - lower) / (upper - lower))) }
}

export type RankedBadge = { id: string; family: BadgeFamily; development: number; personalBest: boolean; workIds: readonly string[] }
export function selectBadges<T extends RankedBadge>(earned: readonly T[]): { featured: T[]; reveal: T[] } {
  const ranked = [...earned].sort((a, b) => Math.floor(b.development / 5) - Math.floor(a.development / 5)
    || Number(b.personalBest) - Number(a.personalBest) || b.development - a.development || a.id.localeCompare(b.id))
  const groups = [['10', '11', '12', '13', '14'], ['22', '23', '24', '25'], ['02', '29']]
  const featured: T[] = []
  for (const candidate of ranked) {
    if (featured.length === 5) break
    if (featured.filter(b => b.family === candidate.family).length === 2) continue
    if (groups.some(group => group.includes(candidate.id) && featured.some(b => group.includes(b.id)))) continue
    const otherVoice = featured.find(b => [b.id, candidate.id].sort().join(',') === '04,05')
    if (otherVoice && candidate.workIds.length === otherVoice.workIds.length
      && candidate.workIds.every(id => otherVoice.workIds.includes(id))) continue
    featured.push(candidate)
  }
  return { featured, reveal: [...featured].sort((a, b) => a.development - b.development || a.id.localeCompare(b.id)) }
}
