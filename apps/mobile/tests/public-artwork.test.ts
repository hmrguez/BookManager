import { expect, test } from 'bun:test'
import { pathwayArtworkSource, reviewArtwork } from '../src/reviews/presentation'

test('known retired artwork resolves to original licensed vectors without altering saved references', () => {
  for (const prefix of ['concepts', 'ink-v1']) {
    const saved = { version: 'original-ink-v1', finishedStill: `/reviews/${prefix}/02-mystery-artwork.png`, animation: null }
    expect(pathwayArtworkSource(saved)).toBe('/reviews/vector-v2/02-mystery-artwork.svg')
    expect(saved.finishedStill).toBe(`/reviews/${prefix}/02-mystery-artwork.png`)
  }
  expect(pathwayArtworkSource({ version: 'fantasy-preview-v1', finishedStill: '/reviews/fantasy-preview-v1/00.webp', animation: null }))
    .toBe('/reviews/vector-v2/01-fantasy-artwork.svg')
  expect(Object.values(reviewArtwork.pathways).every(art => art.version === 'original-vector-v2')).toBe(true)
})
