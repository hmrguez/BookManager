import { describe, expect, test } from 'bun:test'
import { createStarterLibrary } from '../src/library-model'
import {
  buildWorkDetailModel,
  createIdentityImpact,
} from '../src/work-detail/model'

const starterBooks = createStarterLibrary('2026-08-26T10:00:00.000+02:00')

describe('work and edition detail model', () => {
  test('keeps print, EPUB, audiobook, and a Libby loan under one Work history', () => {
    const book = starterBooks.find(({ id }) => id === 'starter-tainted-cup')
    if (!book) throw new Error('Expected dense Work detail fixture')

    const detail = buildWorkDetailModel(book)

    expect(detail.editions.map(({ kind }) => kind)).toEqual([
      'print',
      'epub',
      'audiobook',
      'loan',
    ])
    expect(new Set(detail.sessions.map(({ id }) => id)).size).toBe(detail.sessions.length)
    expect(detail.sessions.every(({ editionId }) =>
      detail.editions.some(({ id }) => id === editionId),
    )).toBe(true)
    expect(detail.overallProgressLabel).toContain('one reading history')
  })

  test('scopes length, narrator, identifiers, assets, and loans to an Edition', () => {
    const book = starterBooks.find(({ id }) => id === 'starter-tainted-cup')
    if (!book) throw new Error('Expected dense Work detail fixture')

    const detail = buildWorkDetailModel(book)
    const print = detail.editions.find(({ kind }) => kind === 'print')
    const audio = detail.editions.find(({ kind }) => kind === 'audiobook')
    const loan = detail.editions.find(({ kind }) => kind === 'loan')

    expect('pageCount' in detail).toBe(false)
    expect(print?.facts).toContainEqual(expect.objectContaining({ label: 'ISBN-13' }))
    expect(audio?.facts).toContainEqual(expect.objectContaining({ label: 'Narrator' }))
    expect(audio?.facts).not.toContainEqual(expect.objectContaining({ label: 'ISBN-13' }))
    expect(loan?.loan).toMatchObject({ provider: 'Libby · Central Library' })
    expect(loan?.availabilityTone).toBe('remote')
  })

  test('keeps a sparse record explicit without inventing activity or an asset', () => {
    const book = starterBooks.find(({ id }) => id === 'starter-mistborn')
    if (!book) throw new Error('Expected sparse Work detail fixture')

    const detail = buildWorkDetailModel(book)

    expect(detail.editions).toHaveLength(1)
    expect(detail.editions[0]).toMatchObject({
      kind: 'print',
      accessLabel: 'Catalog record',
    })
    expect(detail.editions[0]?.asset).toBeUndefined()
    expect(detail.sessions).toEqual([])
    expect(detail.annotations).toEqual([])
    expect(detail.history).toHaveLength(1)
  })

  test('previews identity impact before split and preserves an explicit undo promise', () => {
    const book = starterBooks.find(({ id }) => id === 'starter-tainted-cup')
    if (!book) throw new Error('Expected dense Work detail fixture')
    const detail = buildWorkDetailModel(book)
    const audio = detail.editions.find(({ kind }) => kind === 'audiobook')
    if (!audio) throw new Error('Expected audiobook Edition')

    const preview = createIdentityImpact(detail, 'split', audio.id)

    expect(preview.title).toContain('Split Unabridged audio')
    expect(preview.counts).toContainEqual({
      label: 'Attached sessions',
      before: '1',
      after: '1 move intact',
    })
    expect(preview.assurances.join(' ')).toContain('Undo restores the exact Edition → Work assignment')
  })
})
