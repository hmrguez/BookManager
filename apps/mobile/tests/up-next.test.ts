import { describe, expect, test } from 'bun:test'
import { libraryBookSchema, type LibraryBook } from '../src/library-model'
import {
  buildUpNextSuggestions,
  createDefaultUpNextState,
  orderedUpNextBooks,
  upNextStateSchema,
} from '../src/up-next-model'
import { migrateStorage } from '../src/storage/migrations'
import { UpNextRepository } from '../src/storage/up-next-repository'
import { BunSqliteDatabase } from './storage-test-database'

const now = new Date('2026-08-26T12:00:00.000Z')

function book(
  id: string,
  shelf: LibraryBook['shelf'],
  changes: Partial<LibraryBook> = {},
): LibraryBook {
  return libraryBookSchema.parse({
    id,
    title: id.replaceAll('-', ' '),
    authors: ['Reader Fixture'],
    pageCount: 320,
    shelf,
    progress: 0,
    currentPage: 0,
    rating: 0,
    notes: '',
    addedAt: '2026-01-01T12:00:00.000Z',
    lastUpdatedAt: '2026-08-01T12:00:00.000Z',
    ...changes,
  })
}

describe('explainable Up Next', () => {
  test('keeps manual mode entirely free of ranking', () => {
    const state = createDefaultUpNextState(now.toISOString())
    state.mode = 'manual'
    const result = buildUpNextSuggestions([book('candidate', 'tbr')], state, now)

    expect(result).toMatchObject({
      suggestions: [],
      certainty: 'none',
      guidance: 'Manual mode is on. Nothing is ranked.',
    })
  })

  test('surfaces an expiring Libby loan without changing the manual queue order', () => {
    const pinned = book('chosen-first', 'next')
    const second = book('chosen-second', 'next')
    const expiring = book('expiring-loan', 'tbr', {
      loan: {
        provider: 'Libby',
        borrowedAt: '2026-08-12T12:00:00.000Z',
        dueAt: '2026-08-28T12:00:00.000Z',
      },
    })
    const ordinary = book('ordinary-option', 'tbr')
    const state = upNextStateSchema.parse({
      ...createDefaultUpNextState(now.toISOString()),
      mode: 'assisted',
      queueBookIds: [second.id, pinned.id],
      pinnedBookId: pinned.id,
    })

    expect(orderedUpNextBooks([second, pinned], state).map(({ id }) => id)).toEqual([
      second.id,
      pinned.id,
    ])
    const result = buildUpNextSuggestions([pinned, second, ordinary, expiring], state, now)
    expect(result.suggestions[0].book.id).toBe(expiring.id)
    expect(result.suggestions[0].reasons[0]).toMatchObject({
      criterion: 'loan-expiry',
      label: 'Libby loan due in 2 days',
    })
  })

  test('never scores a dismissed reason and keeps pinned reasons visible first', () => {
    const candidate = book('matched-book', 'tbr', {
      format: 'eBook',
      tags: ['Hopeful'],
    })
    const state = upNextStateSchema.parse({
      ...createDefaultUpNextState(now.toISOString()),
      mode: 'assisted',
      pinnedCriteria: ['mood'],
      dismissedCriteria: ['recency'],
      preferences: {
        ...createDefaultUpNextState(now.toISOString()).preferences,
        formats: ['eBook'],
        moodTags: ['Hopeful'],
        weights: {
          ...createDefaultUpNextState(now.toISOString()).preferences.weights,
          format: 3,
          length: 0,
          mood: 1,
          recency: 3,
        },
      },
    })

    const [suggestion] = buildUpNextSuggestions([candidate], state, now).suggestions

    expect(suggestion.reasons.map(({ criterion }) => criterion)).toEqual(['mood', 'format'])
    expect(suggestion.score).toBe(40)
  })

  test('scores all matching signals and explains every contribution', () => {
    const candidate = book('many-matches', 'tbr', {
      format: 'eBook',
      pageCount: 280,
      tags: ['Hopeful'],
      series: ['A Series'],
      loan: { provider: 'Libby', dueAt: '2026-08-29T12:00:00.000Z' },
    })
    const defaults = createDefaultUpNextState(now.toISOString())
    const state = upNextStateSchema.parse({
      ...defaults,
      mode: 'assisted',
      preferences: {
        ...defaults.preferences,
        formats: ['eBook'],
        maximumPages: 300,
        moodTags: ['Hopeful'],
        series: ['A Series'],
        weights: Object.fromEntries(UP_NEXT_CRITERIA_FOR_TEST.map((criterion) => [criterion, 1])),
      },
    })

    const [suggestion] = buildUpNextSuggestions([candidate], state, now).suggestions

    expect(suggestion.reasons).toHaveLength(6)
    expect(suggestion.score).toBe(
      suggestion.reasons.reduce((total, reason) => total + reason.contribution, 0),
    )
  })

  test('uses honest language for sparse libraries', () => {
    const state = upNextStateSchema.parse({
      ...createDefaultUpNextState(now.toISOString()),
      mode: 'assisted',
    })

    const result = buildUpNextSuggestions([book('only-option', 'tbr')], state, now)

    expect(result.certainty).toBe('limited')
    expect(result.guidance).toContain('not a confident best pick')
  })

  test('persists queue order, weights, pins, and dismissals offline', async () => {
    const database = new BunSqliteDatabase()
    const backups = new Map<string, string>()
    await migrateStorage(database, { backupStore: { save: async (key, snapshot) => {
      backups.set(key, snapshot)
      return key
    } } })
    const repository = new UpNextRepository(database)
    const state = upNextStateSchema.parse({
      ...createDefaultUpNextState(now.toISOString()),
      mode: 'assisted',
      queueBookIds: ['second', 'first'],
      pinnedBookId: 'first',
      pinnedCriteria: ['loan-expiry'],
      dismissedCriteria: ['recency'],
      dismissedSuggestions: [{ bookId: 'not-now', dismissedAt: now.toISOString() }],
    })

    await repository.save(state)

    expect(await repository.read()).toEqual(state)
    await database.close()
  })
})

const UP_NEXT_CRITERIA_FOR_TEST = [
  'format',
  'length',
  'mood',
  'series',
  'loan-expiry',
  'recency',
] as const
