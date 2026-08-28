import { describe, expect, test } from 'bun:test'
import { libraryBookSchema } from '../src/library-model'
import { EMPTY_LIBRARY_ORGANIZATION } from '../src/organization-model'
import {
  createSmartListDocuments,
  parseSmartListDefinition,
  querySmartList,
  savedSmartListSchema,
  SMART_LIST_RULE_SCHEMA_VERSION,
  SMART_LIST_TEMPLATES,
  smartListDefinitionSchema,
  type SmartListCondition,
  type SmartListDefinition,
  type SmartListDocument,
  type SmartListRule,
} from '../src/smart-lists'
import { migrateStorage } from '../src/storage/migrations'
import { createPortableArchive, inspectPortableArchive } from '../src/storage/portable-archive'
import { SmartListRepository } from '../src/storage/smart-list-repository'
import { createDefaultUpNextState } from '../src/up-next-model'
import { fixtureIds, representativeCatalog } from './fixtures/catalog'
import { BunSqliteDatabase } from './storage-test-database'

const now = '2026-08-26T10:00:00.000Z'

describe('versioned explainable smart lists', () => {
  test('exports a versioned schema and ships valid useful templates', () => {
    expect(SMART_LIST_RULE_SCHEMA_VERSION).toBe(1)
    expect(SMART_LIST_TEMPLATES.map(({ id }) => id)).toEqual([
      'expiring-soon',
      'stalled',
      'short-audiobook',
      'unread-owned-epub',
      'libby-returns',
    ])
    for (const template of SMART_LIST_TEMPLATES) {
      expect(parseSmartListDefinition(template.definition).issues).toEqual([])
      expect(template.definition.schemaVersion).toBe(SMART_LIST_RULE_SCHEMA_VERSION)
    }
  })

  test('composes every supported library dimension and explains every matching rule', () => {
    const document = completeDocument()
    const definition = makeDefinition('all', [
      rule('status', 'is', 'reading'),
      rule('format', 'is', 'epub'),
      rule('source', 'contains', 'Libby'),
      rule('tag', 'is', 'Short'),
      rule('author', 'contains', 'Le Guin'),
      rule('series', 'is', 'Hainish Cycle'),
      rule('dateAdded', 'within-last-days', 300),
      rule('dateStarted', 'after', '2026-06-01T00:00:00.000Z'),
      rule('dateFinished', 'is-missing'),
      rule('dateUpdated', 'within-last-days', 30),
      rule('progress', 'between', [1, 99]),
      rule('rating', 'at-least', 4),
      rule('ownership', 'is', 'owned'),
      rule('loanDueAt', 'within-next-days', 14),
      rule('availability', 'is', 'available'),
      rule('durationMinutes', 'at-most', 480),
    ], 'status')

    const result = querySmartList(definition, [document], { now })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected valid smart-list result')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].reasons).toHaveLength(16)
    expect(result.items[0].reasons).toContain('Status is Reading')
    expect(result.items[0].reasons).toContain('Ownership is owned')
    expect(result.groups).toEqual([expect.objectContaining({ label: 'Reading' })])
    expect(result.explanation).toContain('All of:')
  })

  test('supports nested any/all groups, negation, deterministic sorting, and grouping', () => {
    const quiet = completeDocument()
    const finished = { ...completeDocument(), id: 'book:finished', title: 'A Finished Book', status: 'finished' as const, tags: ['Classic'] }
    const nested: SmartListRule = {
      id: 'group:nested',
      kind: 'group',
      combinator: 'any',
      negate: false,
      rules: [rule('tag', 'is', 'Short'), rule('status', 'is', 'finished')],
    }
    const definition = makeDefinition('all', [nested], 'status')

    const result = querySmartList(definition, [quiet, finished], { now })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected valid smart-list result')
    expect(result.items.map(({ document }) => document.id)).toEqual(['book:finished', 'book:complete'])
    expect(result.groups.map(({ label }) => label)).toEqual(['Finished', 'Reading'])
  })

  test('enriches format, ownership, availability, duration, source, and loan dates from the canonical catalog', () => {
    const books = [
      libraryBookSchema.parse({
        id: fixtureIds.works.leftHand,
        title: 'The Left Hand of Darkness',
        authors: ['Ursula K. Le Guin'],
        pageCount: 304,
        shelf: 'tbr',
        progress: 0,
        currentPage: 0,
        rating: 0,
        notes: '',
        addedAt: now,
        lastUpdatedAt: now,
      }),
      libraryBookSchema.parse({
        id: fixtureIds.works.libby,
        title: 'Cloud Cuckoo Land',
        authors: ['Anthony Doerr'],
        pageCount: 0,
        shelf: 'reading',
        progress: 20,
        currentPage: 0,
        rating: 0,
        notes: '',
        addedAt: now,
        startedAt: now,
        lastUpdatedAt: now,
      }),
    ]

    const documents = createSmartListDocuments(
      books,
      EMPTY_LIBRARY_ORGANIZATION,
      representativeCatalog,
      now,
    )
    const owned = documents.find(({ id }) => id === fixtureIds.works.leftHand)!
    const libby = documents.find(({ id }) => id === fixtureIds.works.libby)!

    expect(owned.formats).toEqual(expect.arrayContaining(['ebook', 'epub', 'audiobook']))
    expect(owned.ownerships).toContain('owned')
    expect(owned.availability).toBe('available')
    expect(owned.durationMinutes).toBe(597)
    expect(libby.formats).toContain('audiobook')
    expect(libby.sources).toContain('Libby timeline export')
    expect(libby.loanDueAt).toBe('2026-09-01T10:00:00.000Z')
    expect(libby.availability).toBe('expiring-soon')

    const returns = querySmartList(
      SMART_LIST_TEMPLATES.find(({ id }) => id === 'libby-returns')!.definition,
      documents,
      { now },
    )
    expect(returns.ok && returns.items.map(({ document }) => document.id)).toEqual([fixtureIds.works.libby])
  })

  test('keeps invalid or unsupported configuration visible and stored losslessly', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const repository = new SmartListRepository(database)
    const unsupported = savedSmartListSchema.parse({
      id: 'smart-list:future',
      name: 'Future rules',
      description: 'Created by a newer Wovenleaf version.',
      pinned: false,
      archived: false,
      position: 1_024,
      definition: {
        schemaVersion: 99,
        root: { kind: 'group', id: 'future:root', combinator: 'all', negate: false, rules: [{
          kind: 'condition', id: 'future:rule', field: 'mood', operator: 'is', value: 'quiet', negate: false,
        }] },
        sort: { field: 'title', direction: 'ascending' },
        groupBy: 'none',
      },
      createdAt: now,
      updatedAt: now,
    })

    await repository.save(unsupported)

    const [stored] = await repository.read()
    const result = querySmartList(stored.definition, [completeDocument()], { now })
    expect(stored.definition).toEqual(unsupported.definition)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected unsupported definition to fail visibly')
    expect(result.issues.some(({ path }) => path.includes('schemaVersion'))).toBe(true)
    expect(await repository.read()).toHaveLength(1)
    await database.close()
  })

  test('exports and restores saved rule configuration without evaluating or rewriting it', async () => {
    const futureDefinition = { schemaVersion: 42, root: { kind: 'future-rule', value: 'kept' } }
    const saved = savedSmartListSchema.parse({
      id: 'smart-list:portable', name: 'Portable rules', description: '', pinned: false,
      archived: false, position: 1_024, definition: futureDefinition, createdAt: now, updatedAt: now,
    })

    const bundle = await createPortableArchive(
      representativeCatalog,
      [],
      { createdAt: now },
      EMPTY_LIBRARY_ORGANIZATION,
      createDefaultUpNextState(now),
      [saved],
    )
    const inspected = await inspectPortableArchive(bundle.archive)

    expect(inspected.manifest.schemaVersion).toBe(5)
    expect(inspected.manifest.entries.some(({ path }) => path === 'data/smart-lists.json')).toBe(true)
    expect(inspected.smartLists).toEqual([saved])
    expect(inspected.smartLists[0].definition).toEqual(futureDefinition)

    const schemaThree = JSON.parse(bundle.archive) as {
      manifest: { schemaVersion: number; entries: Array<{ path: string }> }
      entries: Record<string, string>
    }
    schemaThree.manifest.schemaVersion = 3
    schemaThree.manifest.entries = schemaThree.manifest.entries.filter(
      ({ path }) => path !== 'data/smart-lists.json',
    )
    delete schemaThree.entries['data/smart-lists.json']
    expect((await inspectPortableArchive(JSON.stringify(schemaThree))).smartLists).toEqual([])
  })

  test('persists and indexes saved rules while keeping a 10,000-book query inside budget', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const repository = new SmartListRepository(database)
    const definition = makeDefinition('all', [
      rule('status', 'is', 'reading'),
      rule('progress', 'greater-than', 20),
      rule('rating', 'at-least', 4),
      rule('format', 'contains', 'epub'),
      rule('dateUpdated', 'within-last-days', 90),
    ])
    await repository.save(savedSmartListSchema.parse({
      id: 'smart-list:performance', name: 'Active favorites', description: '', pinned: true,
      archived: false, position: 1_024, definition, createdAt: now, updatedAt: now,
    }))

    const plan = await database.query<{ readonly detail: string }>(
      `EXPLAIN QUERY PLAN SELECT payload_json FROM smart_lists
       WHERE archived = 0 ORDER BY pinned DESC, position, name, id`,
    )
    expect(plan.map(({ detail }) => detail).join('\n')).toContain('USING INDEX idx_smart_lists_visible')

    const documents = Array.from({ length: 10_000 }, (_, index): SmartListDocument => ({
      ...completeDocument(),
      id: `book:${String(index).padStart(5, '0')}`,
      title: `Library Book ${index}`,
      rating: index % 5,
      progress: index % 100,
      dateUpdated: `2026-08-${String((index % 25) + 1).padStart(2, '0')}T10:00:00.000Z`,
    }))
    querySmartList(definition, documents, { now })
    const durations = Array.from({ length: 8 }, () => querySmartList(definition, documents, { now }).durationMs)
      .sort((left, right) => left - right)
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]

    // Reference target: <= 50 ms p95. The wider automated ceiling absorbs shared-CI variance.
    expect(p95).toBeLessThan(100)
    await database.close()
  })
})

function completeDocument(): SmartListDocument {
  return {
    id: 'book:complete',
    title: 'The Quiet Atlas',
    authors: ['Ursula K. Le Guin'],
    series: ['Hainish Cycle'],
    formats: ['epub', 'audiobook'],
    sources: ['Libby'],
    tags: ['Short'],
    status: 'reading',
    dateAdded: '2026-01-02T10:00:00.000Z',
    dateStarted: '2026-07-01T10:00:00.000Z',
    dateUpdated: '2026-08-20T10:00:00.000Z',
    progress: 42,
    rating: 4,
    ownerships: ['owned', 'borrowed'],
    loanDueAt: '2026-09-01T10:00:00.000Z',
    availability: 'expiring-soon',
    durationMinutes: 360,
  }
}

function rule(
  field: SmartListCondition['field'],
  operator: SmartListCondition['operator'],
  value?: unknown,
): SmartListCondition {
  return { id: `rule:${field}:${operator}`, kind: 'condition', field, operator, value, negate: false }
}

function makeDefinition(
  combinator: 'all' | 'any',
  rules: readonly SmartListRule[],
  groupBy: SmartListDefinition['groupBy'] = 'none',
): SmartListDefinition {
  return smartListDefinitionSchema.parse({
    schemaVersion: SMART_LIST_RULE_SCHEMA_VERSION,
    root: { id: 'group:root', kind: 'group', combinator, rules, negate: false },
    sort: { field: 'title', direction: 'ascending' },
    groupBy,
  })
}
