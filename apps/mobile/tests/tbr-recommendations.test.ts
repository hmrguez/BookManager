import { describe, expect, test } from 'bun:test'
import { libraryBookSchema, type LibraryBook } from '../src/library-model'
import { buildUpNextSuggestions, createDefaultUpNextState, recommendationPreset, upNextStateSchema } from '../src/up-next-model'
import { RecommendationCache, nextRecommendationRefresh } from '../src/recommendations/cache'
import { buildSeriesContext, seriesMembership } from '../src/recommendations/series'

const now = new Date('2026-09-17T12:00:00.000Z')
const DAY = 86_400_000
function book(id: string, changes: Partial<LibraryBook> = {}): LibraryBook {
  return libraryBookSchema.parse({
    id, title: id, authors: ['A Reader'], shelf: 'tbr', pageCount: 320,
    progress: 0, currentPage: 0, rating: 0, notes: '', addedAt: now.toISOString(), lastUpdatedAt: now.toISOString(), ...changes,
  })
}

describe('automatic TBR picks', () => {
  test('works without setup, respects explicit opt-out and reads old preferences', () => {
    const state = createDefaultUpNextState(now.toISOString())
    expect(state).toMatchObject({ mode: 'assisted', preferences: { preset: 'balanced', seriesOrder: 'in-order' } })
    expect(buildUpNextSuggestions([book('ready')], state, now).suggestions).toHaveLength(1)
    expect(buildUpNextSuggestions([book('ready')], { ...state, mode: 'manual' }, now).suggestions).toHaveLength(0)
    const legacy = JSON.parse(JSON.stringify(state))
    delete legacy.preferences.preset
    delete legacy.preferences.seriesOrder
    delete legacy.preferences.useReadingTaste
    legacy.mode = 'manual'
    expect(upNextStateSchema.parse(legacy)).toMatchObject({ mode: 'manual', preferences: { preset: 'custom', seriesOrder: 'any', useReadingTaste: false } })
  })

  test('upgrades untouched pre-rollout defaults without losing queue order or new off choices', () => {
    const legacy = JSON.parse(JSON.stringify(createDefaultUpNextState(now.toISOString())))
    legacy.mode = 'manual'
    legacy.queueBookIds = ['second', 'first']
    legacy.pinnedBookId = 'first'
    legacy.preferences = {
      weights: { format: 0, length: 0, mood: 0, series: 0, 'loan-expiry': 2, recency: 1 },
      formats: [], maximumPages: null, moodTags: [], series: [], requiredCriteria: [], recencyDirection: 'long-waiting',
    }
    const upgraded = upNextStateSchema.parse(legacy)
    expect(upgraded).toMatchObject({ mode: 'assisted', queueBookIds: ['second', 'first'], pinnedBookId: 'first', preferences: { preset: 'balanced' } })
    expect(upNextStateSchema.parse({ ...upgraded, mode: 'manual' }).mode).toBe('manual')
    legacy.preferences.moodTags = ['Cozy']
    expect(upNextStateSchema.parse(legacy).mode).toBe('manual')
  })

  test('uses normalized tags from well-rated finished books without a remote service', () => {
    const state = createDefaultUpNextState()
    const library = [
      book('loved', { shelf: 'finished', rating: 5, tags: ['  COZY  '] }),
      book('disliked', { shelf: 'finished', rating: 2, tags: ['Dark'] }),
      book('A dark story', { tags: ['Dark'] }), book('Z cozy story', { tags: ['Cozy'] }),
    ]
    const result = buildUpNextSuggestions(library, state, now)
    expect(result.suggestions[0].book.id).toBe('Z cozy story')
    expect(result.suggestions[0].reasons.some(({ criterion }) => criterion === 'mood')).toBe(true)
    expect(result.suggestions[1].reasons.some(({ criterion }) => criterion === 'mood')).toBe(false)
  })

  test('pinning explanations never changes scores or ranking', () => {
    const state = createDefaultUpNextState()
    state.preferences = { ...recommendationPreset('balanced'), formats: ['eBook'], moodTags: ['Cozy'], weights: { format: 3, length: 3, mood: 1, series: 0, 'loan-expiry': 3, recency: 1 } }
    const candidate = book('many matches', { format: 'eBook', tags: ['Cozy'], loan: { provider: 'Library', dueAt: '2026-09-18T12:00:00.000Z' } })
    const before = buildUpNextSuggestions([candidate], state, now).suggestions[0]
    const after = buildUpNextSuggestions([candidate], { ...state, pinnedCriteria: ['mood'] }, now).suggestions[0]
    expect(before.reasons).toHaveLength(5)
    expect(after.reasons[0].criterion).toBe('mood')
    expect(after.score).toBe(before.score)
  })

  test('required matches remain required even if their contribution is dismissed', () => {
    const state = createDefaultUpNextState()
    state.preferences.moodTags = ['Cozy', 'Hopeful']
    state.preferences.requiredCriteria = ['mood', 'length']
    state.dismissedCriteria = ['mood']
    const result = buildUpNextSuggestions([book('matching', { tags: ['Hopeful'] }), book('no tag'), book('too long', { tags: ['Cozy'], pageCount: 900 })], state, now)
    expect(result.suggestions.map(({ book }) => book.id)).toEqual(['matching'])
  })

  test('expired and returned loans never receive urgency points; zero scores are not starred', () => {
    const state = createDefaultUpNextState()
    state.preferences.weights = { format: 0, length: 0, mood: 0, series: 0, 'loan-expiry': 2, recency: 0 }
    const candidates = [
      book('due now', { loan: { provider: 'Library', dueAt: now.toISOString() } }),
      book('returned', { loan: { provider: 'Library', dueAt: '2026-09-18T12:00:00.000Z', returnedAt: now.toISOString() } }),
      book('live', { loan: { provider: 'Library', dueAt: '2026-09-18T12:00:00.000Z' } }),
    ]
    expect(buildUpNextSuggestions(candidates, state, now).suggestions.map(({ book }) => book.id)).toEqual(['live'])
  })
})

describe('conservative local series rules', () => {
  test('recognizes explicit series labels, prefers recorded order and ignores ambiguous numbers', () => {
    expect(seriesMembership(book('A title (Earthsea, #2)'))).toMatchObject({ name: 'Earthsea', position: 2 })
    expect(seriesMembership(book('Title', { series: ['Earthsea Book 2'] }))).toMatchObject({ name: 'Earthsea', position: 2 })
    expect(seriesMembership(book('Title', { series: ['(Earthsea, #2)'] }))).toMatchObject({ name: 'Earthsea', position: 2 })
    expect(seriesMembership(book('A title (Earthsea, #2)', { series: ['Earthsea'], seriesPosition: 3 }))).toMatchObject({ name: 'Earthsea', position: 3 })
    expect(seriesMembership(book('1984'))).toBeUndefined()
    expect(seriesMembership(book('Book 2', { series: ['Earthsea'] }))?.position).toBeUndefined()
    expect(seriesMembership(book('A title (Different series, #2)', { series: ['Earthsea'] }))?.position).toBeUndefined()
  })

  test('holds back sequels until every predecessor is finished, including known novellas', () => {
    const first = book('Book one', { series: ['Earthsea'], seriesPosition: 1 })
    const second = book('Book two', { series: ['Earthsea'], seriesPosition: 2 })
    const third = book('Book three', { series: ['Earthsea'], seriesPosition: 3 })
    expect(buildSeriesContext([first, second, third]).canReadNext(second)).toBe(false)
    expect(buildSeriesContext([second]).canReadNext(second)).toBe(false)
    const finished = { ...first, shelf: 'finished' as const }
    expect(buildSeriesContext([finished, second, third]).canReadNext(second)).toBe(true)
    expect(buildSeriesContext([finished, second, third]).canReadNext(third)).toBe(false)
    const novella = book('Novella', { series: ['Earthsea'], seriesPosition: 1.5 })
    expect(buildSeriesContext([finished, novella, second]).canReadNext(second)).toBe(false)
    expect(buildSeriesContext([finished, { ...novella, shelf: 'finished' }, second]).canReadNext(second)).toBe(true)
    expect(buildSeriesContext([{ ...first, shelf: 'dnf' }, second]).canReadNext(second)).toBe(false)
  })

  test('does not mix series with the same name by different authors', () => {
    const first = book('First', { series: ['Saga'], seriesPosition: 1, shelf: 'finished', authors: ['Someone else'] })
    const second = book('Second', { series: ['Saga'], seriesPosition: 2 })
    expect(buildSeriesContext([first, second]).canReadNext(second)).toBe(false)
  })

  test('first-books mode only recommends known starts; any-order is an explicit escape hatch', () => {
    const state = createDefaultUpNextState()
    const candidates = [book('First', { series: ['Saga'], seriesPosition: 1 }), book('Second', { series: ['Saga'], seriesPosition: 2 }), book('Unknown', { series: ['Saga'] }), book('Standalone')]
    state.preferences.seriesOrder = 'first'
    expect(buildUpNextSuggestions(candidates, state, now).suggestions.map(({ book }) => book.id)).toEqual(['First'])
    state.preferences.seriesOrder = 'any'
    expect(buildUpNextSuggestions(candidates, state, now, 10).suggestions).toHaveLength(4)
  })

  test('finishing a predecessor makes the next installment eligible and scores continuation', () => {
    const state = createDefaultUpNextState()
    state.preferences = recommendationPreset('series')
    const first = book('First', { series: ['Saga'], seriesPosition: 1, shelf: 'finished' })
    const second = book('Second', { series: ['Saga'], seriesPosition: 2 })
    const result = buildUpNextSuggestions([first, second], state, now).suggestions[0]
    expect(result.reasons.find(({ criterion }) => criterion === 'series')).toMatchObject({ label: 'Continue Saga', contribution: 60 })
  })
})

describe('local recommendation cache', () => {
  function memoryStorage() {
    const data = new Map<string, string>()
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, data }
  }

  test('survives reload, rehydrates current covers/notes, and leaves the cached comparison intact', () => {
    const storage = memoryStorage()
    const state = createDefaultUpNextState()
    const cache = new RecommendationCache(storage)
    const original = book('Book')
    const result = cache.get([original], state, now)
    cache.persist()
    const stored = [...storage.data.values()][0]
    const fresh = { ...original, notes: 'Private note', thumbnail: 'https://example.test/new.jpg', progress: 50 }
    const reloaded = new RecommendationCache(storage)
    expect(reloaded.get([fresh], { ...state, queueBookIds: ['other'], updatedAt: '2026-09-17T13:00:00.000Z' }, new Date(now.getTime() + 1000))).toEqual({ ...result, suggestions: [{ ...result.suggestions[0], book: fresh }] })
    reloaded.persist()
    expect(JSON.parse([...storage.data.values()][0])).toEqual(JSON.parse(stored))
    expect(stored).not.toContain('Private note')
  })

  test('invalidates on tags, ratings, metadata, imports, shelf moves and preference changes', () => {
    const storage = memoryStorage()
    const cache = new RecommendationCache(storage)
    const state = createDefaultUpNextState()
    const original = book('Book')
    cache.get([original], state, now); cache.persist()
    const baseline = [...storage.data.values()][0]
    for (const change of [{ tags: ['Cozy'] }, { rating: 5 }, { pageCount: 100 }, { series: ['Saga'], seriesPosition: 2 }, { shelf: 'reading' as const }]) {
      cache.get([{ ...original, ...change }], state, now); cache.persist()
      expect([...storage.data.values()][0]).not.toBe(baseline)
    }
    expect(cache.get([original, book('Imported')], state, now).eligibleCount).toBe(2)
    expect(cache.get([original], { ...state, mode: 'manual' }, now).suggestions).toHaveLength(0)
  })

  test('refreshes at day and loan boundaries, including resume after expiry', () => {
    const candidate = book('Borrowed', { loan: { provider: 'Library', dueAt: '2026-09-17T14:00:00.000Z' } })
    expect(nextRecommendationRefresh([candidate], now.getTime())).toBe(Date.parse(candidate.loan!.dueAt))
    expect(nextRecommendationRefresh([], now.getTime())).toBe(Date.parse('2026-09-18T00:00:00.000Z'))
    const state = createDefaultUpNextState()
    const cache = new RecommendationCache()
    const before = cache.get([candidate], state, now).suggestions[0]
    const after = cache.get([candidate], state, new Date(now.getTime() + DAY)).suggestions[0]
    expect(before.reasons.some(({ criterion }) => criterion === 'loan-expiry')).toBe(true)
    expect(after.reasons.some(({ criterion }) => criterion === 'loan-expiry')).toBe(false)
  })

  test('falls back safely for invalid caches and unavailable storage', () => {
    const cache = new RecommendationCache({ getItem: () => '{broken', setItem: () => { throw new Error('Quota exceeded') } })
    expect(cache.get([book('Book')], createDefaultUpNextState(), now).suggestions).toHaveLength(1)
    expect(() => cache.persist()).not.toThrow()
  })
})
