import { describe, expect, test } from 'bun:test'
import {
  fitCoverDimensions,
  ManualCoverError,
  prepareManualCover,
} from '../src/covers/manual-cover'
import { libraryBookSchema } from '../src/library-model'

const NOW = '2026-09-05T10:00:00.000Z'

describe('manual book covers', () => {
  test('fits a cover inside the storage edge without enlarging small images', () => {
    expect(fitCoverDimensions(2_000, 3_000, 1_400)).toEqual({ width: 933, height: 1_400 })
    expect(fitCoverDimensions(400, 600, 1_400)).toEqual({ width: 400, height: 600 })
  })

  test('rejects non-images before attempting browser decoding', async () => {
    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' })
    await expect(prepareManualCover(file)).rejects.toBeInstanceOf(ManualCoverError)
  })

  test('allows a local image data URL in a persisted book record', () => {
    const parsed = libraryBookSchema.parse({
      id: 'manual-cover-book',
      title: 'A Local Cover',
      authors: ['Reader'],
      thumbnail: 'data:image/jpeg;base64,Y292ZXI=',
      pageCount: 0,
      shelf: 'tbr',
      progress: 0,
      currentPage: 0,
      rating: 0,
      notes: '',
      addedAt: NOW,
      lastUpdatedAt: NOW,
    })

    expect(parsed.thumbnail).toStartWith('data:image/jpeg;base64,')
  })
})
