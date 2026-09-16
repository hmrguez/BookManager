import { describe, expect, test } from 'bun:test'
import { catalogSearchDocuments } from '../src/search/documents'
import {
  LOCAL_SEARCH_INDEX_VERSION,
  LocalSearchIndex,
  type LocalSearchDocument,
} from '../src/search/local-search'
import { representativeCatalog } from './fixtures/catalog'

const documents: LocalSearchDocument[] = [
  {
    id: 'mistborn',
    title: 'Mistborn',
    alternateTitles: ['The Final Empire'],
    contributors: ['Brandon Sanderson'],
    series: ['Mistborn Saga'],
    identifiers: ['978-0-7653-5038-1'],
    tags: ['Epic fantasy'],
    listNames: ['Cosmere order'],
    notes: ['The metal-based magic system pays off beautifully.'],
    sourceNames: ['Open Library'],
    editions: [{ id: 'mistborn-paperback', title: 'Mass market edition', format: 'paperback' }],
    shelf: 'finished',
    rating: 5,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'mists-of-avalon',
    title: 'The Mists of Avalon',
    contributors: ['Marion Zimmer Bradley'],
    shelf: 'tbr',
    rating: 0,
    addedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'left-hand',
    title: 'The Left Hand of Darkness',
    contributors: ['Ursula K. Le Guin'],
    editions: [
      { id: 'left-hand-ebook', format: 'ebook' },
      { id: 'left-hand-audio', format: 'audiobook' },
    ],
    shelf: 'reading',
    rating: 4,
    addedAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  },
]

describe('local fuzzy library search', () => {
  test('ranks typo-tolerant, prefix, identifier, and diacritic-insensitive matches deterministically', () => {
    const index = new LocalSearchIndex()
    index.replace(documents)

    expect(index.search('mitsborn').map(({ document }) => document.id)).toEqual(['mistborn'])
    expect(index.search('bran sand').map(({ document }) => document.id)).toEqual(['mistborn'])
    expect(index.search('97807653').map(({ document }) => document.id)).toEqual(['mistborn'])
    expect(index.search('ursula guin').map(({ document }) => document.id)).toEqual(['left-hand'])
    expect(index.search('final empire')[0]?.document.id).toBe('mistborn')
    expect(index.search('mistborn saga')[0]?.document.id).toBe('mistborn')
    expect(index.search('epic fantasy')[0]?.document.id).toBe('mistborn')
    expect(index.search('cosmere order')[0]?.document.id).toBe('mistborn')
    expect(index.search('open libr')[0]?.document.id).toBe('mistborn')
    expect(index.search('paperb')[0]?.document.id).toBe('mistborn')
    expect(index.search('mist').map(({ document }) => document.id)).toEqual([
      'mistborn',
      'mists-of-avalon',
    ])
  })

  test('returns source ranges for exact and fuzzy highlighted matches', () => {
    const index = new LocalSearchIndex()
    index.replace(documents)

    const [prefix] = index.search('bran')
    expect(prefix.highlights).toContainEqual({
      field: 'contributor',
      value: 'Brandon Sanderson',
      ranges: [{ start: 0, end: 4 }],
    })

    const [typo] = index.search('mitsborn')
    expect(typo.highlights).toContainEqual({
      field: 'title',
      value: 'Mistborn',
      ranges: [{ start: 0, end: 8 }],
    })
  })

  test('keeps private notes out of results until explicitly enabled', () => {
    const index = new LocalSearchIndex()
    index.replace(documents)

    expect(index.search('metal-based')).toEqual([])
    expect(index.search('metal-based', { includeNotes: true }).map(({ document }) => document.id))
      .toEqual(['mistborn'])
  })

  test('combines shelf, format, rating, and deterministic sort controls', () => {
    const index = new LocalSearchIndex()
    index.replace(documents)

    expect(index.search('', { shelves: ['reading'] }).map(({ document }) => document.id))
      .toEqual(['left-hand'])
    expect(index.search('', { formats: ['audiobook'] }).map(({ document }) => document.id))
      .toEqual(['left-hand'])
    expect(index.search('', { minimumRating: 5 }).map(({ document }) => document.id))
      .toEqual(['mistborn'])
    expect(index.search('', { sort: 'updated' }).map(({ document }) => document.id))
      .toEqual(['left-hand', 'mistborn', 'mists-of-avalon'])
  })

  test('resumes an interrupted cooperative rebuild and restarts stale index versions', async () => {
    const index = new LocalSearchIndex()
    let continueBuild = true
    const partial = await index.rebuild(documents, {
      chunkSize: 1,
      sourceKey: 'fixture-v1',
      shouldContinue: () => continueBuild,
      yieldControl: async () => {
        continueBuild = false
      },
    })

    expect(partial).toEqual({
      version: LOCAL_SEARCH_INDEX_VERSION,
      sourceKey: 'fixture-v1',
      nextDocument: 1,
      totalDocuments: 3,
      complete: false,
    })
    expect(index.size).toBe(1)

    const complete = await index.rebuild(documents, {
      checkpoint: partial,
      chunkSize: 1,
      sourceKey: 'fixture-v1',
      yieldControl: async () => {},
    })
    expect(complete.complete).toBe(true)
    expect(index.size).toBe(3)

    const rebuilt = await index.rebuild(documents, {
      checkpoint: { ...complete, version: LOCAL_SEARCH_INDEX_VERSION - 1 },
      chunkSize: 3,
      sourceKey: 'fixture-v1',
    })
    expect(rebuilt.complete).toBe(true)
    expect(index.size).toBe(3)

    const derivedIndex = new LocalSearchIndex()
    const derivedCheckpoint = await derivedIndex.rebuild(documents, { chunkSize: 3 })
    const changedDocuments = documents.map((document) => document.id === 'mistborn'
      ? { ...document, tags: ['Allomancy'] }
      : document)
    await derivedIndex.rebuild(changedDocuments, {
      checkpoint: derivedCheckpoint,
      chunkSize: 3,
    })
    expect(derivedIndex.search('allomancy')[0]?.document.id).toBe('mistborn')
  })

  test('adapts canonical works, contributors, editions, identifiers, and sources', () => {
    const index = new LocalSearchIndex()
    index.replace(catalogSearchDocuments(representativeCatalog))

    const [identifierResult] = index.search('9780441478125')
    expect(identifierResult.document.title).toBe('The Left Hand of Darkness')
    expect(identifierResult.document.editions?.map(({ format }) => format)).toEqual([
      'ebook',
      'audiobook',
    ])
    expect(index.search('ursula guin')[0]?.document.title).toBe('The Left Hand of Darkness')
  })

  test('keeps a representative 10,000-work query inside the documented core budget', () => {
    const fixture = Array.from({ length: 10_000 }, (_, index): LocalSearchDocument => ({
      id: `work:${index.toString().padStart(5, '0')}`,
      title: index === 7_321 ? 'The Cartographer of Quiet Stars' : `Library Work ${index}`,
      alternateTitles: [`Alternate Chronicle ${index}`],
      contributors: [`Reader Author ${index % 137}`],
      identifiers: [`978${index.toString().padStart(10, '0')}`],
      tags: [`Theme ${index % 31}`],
      listNames: [`Shelf ${index % 17}`],
      sourceNames: ['Scale fixture'],
      editions: [{ format: index % 2 ? 'ebook' : 'print' }],
      updatedAt: `2026-08-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    }))
    const index = new LocalSearchIndex()
    index.replace(fixture)
    index.search('cartografer quiet')

    const durations = Array.from({ length: 12 }, () => {
      const startedAt = performance.now()
      const result = index.search('cartografer quiet')
      expect(result[0]?.document.id).toBe('work:07321')
      return performance.now() - startedAt
    }).sort((left, right) => left - right)
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]

    // Reference target: <= 50 ms p95. The wider automated ceiling absorbs shared-CI variance.
    expect(p95).toBeLessThan(150)
  })
})

describe('incremental library indexing', () => {
  test('updates postings, filters, and deletions without changing an earlier snapshot', () => {
    const original = new LocalSearchIndex()
    original.replace([
      { id: 'changed', title: 'Old constellation', shelf: 'tbr', notes: ['Private original'] },
      { id: 'kept', title: 'Shared constellation', shelf: 'tbr' },
      { id: 'removed', title: 'Deleted atlas' },
    ])
    const next = original.withChanges([
      { id: 'changed', title: 'New star chart', shelf: 'next', tags: ['Astronomy'], rating: 5 },
      { id: 'added', title: 'Fresh atlas', shelf: 'reading' },
    ], ['removed'])
    expect(next.size).toBe(3)
    expect(next.search('constellation').map(({ document }) => document.id)).toEqual(['kept'])
    expect(next.search('astronomy', { shelves: ['next'], minimumRating: 5 }).map(({ document }) => document.id)).toEqual(['changed'])
    expect(next.search('private', { includeNotes: true })).toEqual([])
    expect(next.search('deleted')).toEqual([])
    expect(next.search('fresh')[0].document.id).toBe('added')
    expect(original.search('old')[0].document.id).toBe('changed')
    expect(original.search('deleted')[0].document.id).toBe('removed')
    expect(original.search('fresh')).toEqual([])
    expect(next.search('shared')[0].document).toBe(original.search('shared')[0].document)
    expect(next.checkpoint).toBeUndefined()

    const last = next.withChanges([], ['changed', 'added'])
    expect(last.size).toBe(1)
    expect(last.search('star')).toEqual([])
    expect(next.search('star')[0].document.id).toBe('changed')
  })
})
