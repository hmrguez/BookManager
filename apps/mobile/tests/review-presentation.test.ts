import { expect, test } from 'bun:test'
import { badgePhase, shouldAdvanceBadge } from '../src/reviews/playback'
import { metricFact, quarterLabel, pathways, reviewArtwork } from '../src/reviews/presentation'
import { REVIEW_BADGES } from '../src/reviews/catalogue'
import { REVIEW_GENRES } from '../src/reviews/genres'

test('approved pacing, manual pause and final-badge boundary', () => {
  expect(badgePhase(599)).toBe('introduction')
  expect(badgePhase(600)).toBe('stamp')
  expect(badgePhase(1000)).toBe('settled')
  expect(shouldAdvanceBadge(4999, false, false)).toBe(false)
  expect(shouldAdvanceBadge(5000, false, false)).toBe(true)
  expect(shouldAdvanceBadge(9000, true, false)).toBe(false)
  expect(shouldAdvanceBadge(9000, false, true)).toBe(false)
})
test('every earned badge has a caption and factual qualifiers survive presentation', () => {
  for (const badge of REVIEW_BADGES) {
    const caption = metricFact(badge.id, 1250)
    expect(caption).toContain('1,250')
    expect(caption.length).toBeGreaterThan(8)
    expect(caption).not.toContain(badge.fact)
  }
  expect(metricFact('02', 680)).toBe('680 pages across the books you finished')
  expect(metricFact('09', 60)).toBe('60 minutes of recorded listening')
  expect(metricFact('25', 3)).toBe('3 passages saved this quarter now with your notes')
  expect(quarterLabel({ year: 2026, quarter: 2 })).toBe('April–June 2026')
})
test('all eight original identity names have independent offline stills', async () => {
  expect(pathways.mystery.title).toBe('The Pattern Seeker')
  for (const genre of REVIEW_GENRES) {
    expect(await Bun.file(`public${reviewArtwork.pathways[genre].finishedStill}`).exists()).toBe(true)
  }
  for (const genre of REVIEW_GENRES) expect(reviewArtwork.pathways[genre].animation).toBeNull()
})

test('badge captions use singular grammar without changing quantitative qualifiers', () => {
  expect(metricFact('01', 1, '', 'en-US')).toBe('1 distinct book marked finished')
  expect(metricFact('01', 1, '', 'es-ES')).toBe('1 libro distinto marcado como terminado')
  expect(metricFact('10', 1, '', 'fr-FR')).toBe('1 jour avec au moins cinq minutes d’écoute enregistrées')
  expect(metricFact('10', 2, '', 'fr-FR')).not.toBe(metricFact('10', 1, '', 'fr-FR'))
})
