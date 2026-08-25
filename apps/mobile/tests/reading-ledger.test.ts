import { describe, expect, test } from 'bun:test'
import {
  READING_EVENT_KINDS,
  deriveReadingState,
  progressSnapshotIdSchema,
  readingEventPrivacyPolicy,
  readingPositionSchema,
  toProgressSnapshot,
} from '../src/domain/catalog'
import {
  readingLedgerFixtureIds,
  representativeReadingLedger,
} from './fixtures/reading-ledger'

describe('reading event, session, and provenance ledger', () => {
  test('derives current state deterministically regardless of event array order', () => {
    const expected = deriveReadingState(
      readingLedgerFixtureIds.edition,
      representativeReadingLedger.events,
    )
    const reversed = deriveReadingState(
      readingLedgerFixtureIds.edition,
      [...representativeReadingLedger.events].reverse(),
    )

    expect(reversed).toEqual(expected)
    expect(expected).toMatchObject({
      status: 'reading',
      currentPosition: {
        locator: { kind: 'page', page: 45 },
        normalizedProgress: 0.45,
      },
      rating: { value: 4 },
      notes: [{ text: 'The structure clicks into place here.' }],
      sessions: [
        {
          id: readingLedgerFixtureIds.session,
          activeDurationMs: 1_500_000,
          endPosition: { normalizedProgress: 0.1 },
        },
      ],
    })
  })

  test('inserts late offline facts by effective time instead of arrival time', () => {
    const beforeLateUpload = deriveReadingState(
      readingLedgerFixtureIds.edition,
      representativeReadingLedger.events,
      { knownAt: '2026-01-05T23:59:59.999Z' },
    )
    const complete = deriveReadingState(
      readingLedgerFixtureIds.edition,
      representativeReadingLedger.events,
    )

    expect(beforeLateUpload.currentPosition?.normalizedProgress).toBe(0.9)
    expect(complete.currentPosition?.normalizedProgress).toBe(0.45)
    expect(complete.appliedEventIds).toContain(readingLedgerFixtureIds.events.lateOfflineLocation)
    expect(complete.currentPositionEventId).toBe(
      readingLedgerFixtureIds.events.progressCorrection,
    )
  })

  test('supersedes bad imported progress without deleting its evidence', () => {
    const state = deriveReadingState(
      readingLedgerFixtureIds.edition,
      representativeReadingLedger.events,
    )
    const badImport = representativeReadingLedger.events.find(
      ({ id }) => id === readingLedgerFixtureIds.events.badImportedLocation,
    )

    expect(badImport).toMatchObject({
      kind: 'location',
      position: { normalizedProgress: 0.9 },
      source: { kind: 'integration', integrationKey: 'goodreads-csv' },
    })
    expect(state.appliedEventIds).not.toContain(
      readingLedgerFixtureIds.events.badImportedLocation,
    )
    expect(state.appliedEventIds).toContain(readingLedgerFixtureIds.events.progressCorrection)
    expect(state.currentPosition?.normalizedProgress).toBe(0.45)
  })

  test('tombstones a bad note while retaining both ledger records', () => {
    const state = deriveReadingState(
      readingLedgerFixtureIds.edition,
      representativeReadingLedger.events,
    )

    expect(representativeReadingLedger.events.map(({ id }) => id)).toContain(
      readingLedgerFixtureIds.events.badNote,
    )
    expect(representativeReadingLedger.events.map(({ id }) => id)).toContain(
      readingLedgerFixtureIds.events.noteTombstone,
    )
    expect(state.notes.map(({ text }) => text)).toEqual([
      'The structure clicks into place here.',
    ])
  })

  test('materializes a progress snapshot from the derived read model', () => {
    const state = deriveReadingState(
      readingLedgerFixtureIds.edition,
      representativeReadingLedger.events,
    )
    const snapshot = toProgressSnapshot(
      progressSnapshotIdSchema.parse('progress:ledger-fixture'),
      state,
      '2026-01-08T12:00:02.000Z',
    )

    expect(snapshot).toMatchObject({
      status: 'reading',
      normalizedProgress: 0.45,
      position: { locator: { kind: 'page', page: 45 } },
      sourceEventId: readingLedgerFixtureIds.events.progressCorrection,
    })
  })

  test('normalizes page, percent, EPUB, audio-time, and chapter locators with confidence', () => {
    const positions = [
      {
        locator: { kind: 'page', page: 25 },
        normalizedProgress: 0.25,
        normalization: { kind: 'edition-page-count', totalPages: 100, confidence: 1 },
      },
      {
        locator: { kind: 'percent', fraction: 0.4 },
        normalizedProgress: 0.4,
        normalization: { kind: 'reported-percent', confidence: 0.7 },
      },
      {
        locator: {
          kind: 'epub',
          href: 'chapter.xhtml',
          locator: 'epubcfi(/6/4)',
          progression: 0.5,
        },
        normalizedProgress: 0.5,
        normalization: { kind: 'epub-progression', confidence: 0.9 },
      },
      {
        locator: { kind: 'audio-time', positionMs: 30_000 },
        normalizedProgress: 0.5,
        normalization: { kind: 'edition-duration', durationMs: 60_000, confidence: 1 },
      },
      {
        locator: { kind: 'chapter', chapterKey: 'chapter-3', chapterIndex: 2, progression: 0.5 },
        normalizedProgress: 0.5,
        normalization: { kind: 'chapter-map', chapterCount: 5, confidence: 0.6 },
      },
    ]

    expect(positions.map((position) => readingPositionSchema.parse(position))).toHaveLength(5)
    expect(() =>
      readingPositionSchema.parse({
        ...positions[0],
        normalizedProgress: 0.75,
      }),
    ).toThrow('Normalized progress does not match')
  })

  test('defines privacy and export behavior for every event kind', () => {
    expect(Object.keys(readingEventPrivacyPolicy).sort()).toEqual(
      [...READING_EVENT_KINDS].sort(),
    )
    expect(readingEventPrivacyPolicy.note).toEqual({
      classification: 'private-content',
      fullBackup: 'include',
      portableExport: 'include',
      shareSafeExport: 'redact',
    })
    expect(readingEventPrivacyPolicy.sync.portableExport).toBe('exclude')
  })
})
