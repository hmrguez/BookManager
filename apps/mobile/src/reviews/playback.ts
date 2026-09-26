/** Elapsed foreground time only. The final badge never advances into the optional identity. */
export const BADGE_INTRO_MS = 600
export const BADGE_STAMP_MS = 400
export const BADGE_READING_MS = 4000
export const BADGE_SETTLED_MS = BADGE_INTRO_MS + BADGE_STAMP_MS
export const BADGE_TOTAL_MS = BADGE_SETTLED_MS + BADGE_READING_MS
export function badgePhase(elapsed: number) {
  return elapsed < BADGE_INTRO_MS ? 'introduction' : elapsed < BADGE_SETTLED_MS ? 'stamp' : 'settled'
}
export function shouldAdvanceBadge(elapsed: number, paused: boolean, last: boolean) {
  return !paused && !last && elapsed >= BADGE_TOTAL_MS
}
