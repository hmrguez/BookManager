import type { ReviewArtworkManifest, ReviewPeriod, SavedReviewFacts } from './keepsake-model'
import { REVIEW_GENRES, type ReviewGenre } from './genres'

export const pathways: Record<ReviewGenre, { title: string; label: string; file: string }> = {
  fantasy: { title: 'The Worldwanderer', label: 'Fantasy', file: '01-fantasy' },
  mystery: { title: 'The Pattern Seeker', label: 'Mystery', file: '02-mystery' },
  romance: { title: 'The Heartkeeper', label: 'Romance', file: '03-romance' },
  'science-fiction': { title: 'The Stargazer', label: 'Science fiction', file: '04-science-fiction' },
  history: { title: 'The Timekeeper', label: 'History', file: '05-history' },
  'literary-fiction': { title: 'The Meaning Maker', label: 'Literary fiction', file: '06-literary-fiction' },
  nonfiction: { title: 'The Curious Mind', label: 'Nonfiction', file: '07-nonfiction' },
  horror: { title: 'The Night Reader', label: 'Horror', file: '08-horror' },
}
export const reviewArtwork: ReviewArtworkManifest = {
  achievementVersion: 'temporary-engraved-seals-v1',
  pathways: Object.fromEntries(REVIEW_GENRES.map(genre => [genre, {
    version: 'original-ink-v1',
    finishedStill: `/reviews/ink-v1/${pathways[genre].file}-artwork.png`,
    animation: null,
  }])) as ReviewArtworkManifest['pathways'],
}
export function quarterLabel(period: ReviewPeriod) {
  const month = (index: number) => new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(period.year, index, 1)))
  return `${month((period.quarter - 1) * 3)}–${month(period.quarter * 3 - 1)} ${period.year}`
}
const captions: Record<string, string> = {
  '01': '{n} distinct books marked finished', '02': '{n} pages across the books you finished',
  '03': '{n} pages in a finished book', '04': '{n} authors across your finished books',
  '05': '{n} finished books by one author', '06': '{n} finished books in one series',
  '07': '{n} shorter books finished', '08': '{n} finished books currently rated four or five stars',
  '09': '{n} minutes of recorded listening', '10': '{n} days with at least five recorded listening minutes',
  '11': '{n} days with at least five recorded reading or listening minutes',
  '12': '{n} weeks with recorded active days', '13': '{n} weeks with at least three recorded active days',
  '14': '{n} days with at least twenty recorded minutes', '15': '{n} recorded active days with one book',
  '16': '{n} visits with at least thirty active minutes', '17': '{n} books with at least ten recorded minutes',
  '18': '{n} weeks with at least ten reading and ten listening minutes',
  '19': '{n} edition languages across books with qualifying activity',
  '20': '{n} reader bookmarks kept from this quarter', '21': '{n} audio bookmarks kept from this quarter',
  '22': '{n} passages kept from this quarter', '23': '{n} books with passages kept from this quarter',
  '24': '{n} days on which you saved passages still kept', '25': '{n} passages saved this quarter now with your notes',
  '26': '{n} audio text notes kept from this quarter', '27': '{n} audio voice notes kept from this quarter',
  '28': '{n} minutes of recorded reading', '29': '{n} pages consumed', '30': '{n} chapters consumed',
}
export function badgeFact(badge: SavedReviewFacts['earned'][number]) {
  return metricFact(badge.id, badge.value, badge.unit)
}
export function metricFact(id: string, value: number, unit = '') {
  return (captions[id] ?? '{n} ' + unit).replace('{n}', new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value))
}
