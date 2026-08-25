import { describe, expect, test } from 'bun:test'
import {
  applyIdentityOperation,
  conflictItemSchema,
  createDurableChoice,
  createEditionReassignmentOperation,
  createWorkMergeOperation,
  createWorkSplitOperation,
  DEFAULT_PRECEDENCE_RULES,
  editionIdSchema,
  evaluateConflict,
  sourceAdapterSchema,
  undoIdentityOperation,
  workIdSchema,
} from '../src/domain/catalog'
import { PROTOTYPE_CONFLICTS } from '../src/conflicts/prototypeFixtures'
import { fixtureIds, representativeCatalog } from './fixtures/catalog'

describe('source precedence and conflict review', () => {
  test('keeps a review fixture for every conflict inbox domain', () => {
    const domains = PROTOTYPE_CONFLICTS.map(({ item }) => item.domain).sort()

    expect(domains).toEqual([
      'deletion',
      'finish-state',
      'list-placement',
      'metadata',
      'progress',
      'work-identity',
    ])
    PROTOTYPE_CONFLICTS.forEach(({ item }) => {
      expect(conflictItemSchema.parse(item)).toEqual(item)
      expect(evaluateConflict(item).status).toBe('review')
    })
  })

  test('defines field-level trust for every initial adapter and first-party reader', () => {
    const coveredSources = new Set(DEFAULT_PRECEDENCE_RULES.map(({ source }) => source))

    sourceAdapterSchema.options.forEach((source) => expect(coveredSources.has(source), source).toBe(true))
  })

  test('does not let a newer low-trust observation replace first-party progress', () => {
    const subject = { type: 'reading-state', id: 'reading-state:newer-is-not-better' } as const
    const conflict = conflictItemSchema.parse({
      id: 'conflict:newer-is-not-better',
      domain: 'progress',
      subject,
      field: 'reading-state.normalizedProgress',
      reason: 'A later browser observation arrived after direct first-party reading.',
      candidates: [
        {
          id: 'conflict-candidate:first-party-older',
          subject,
          field: 'reading-state.normalizedProgress',
          value: 0.64,
          source: 'wovenleaf-epub-reader',
          evidence: 'authoritative',
          observedAt: '2026-08-20T10:00:00.000Z',
          confidence: 1,
          explanation: 'Direct EPUB locator.',
        },
        {
          id: 'conflict-candidate:libby-newer',
          subject,
          field: 'reading-state.normalizedProgress',
          value: 0.81,
          source: 'libby-web-capture',
          evidence: 'observed',
          observedAt: '2026-08-24T10:00:00.000Z',
          confidence: 0.72,
          explanation: 'Visible browser percentage.',
        },
      ],
    })

    expect(evaluateConflict(conflict)).toMatchObject({
      status: 'resolved',
      basis: 'precedence-rule',
      value: 0.64,
      selectedCandidateId: 'conflict-candidate:first-party-older',
    })
  })

  test('scopes a durable user choice to one subject field without blocking useful fields', () => {
    const titleConflict = PROTOTYPE_CONFLICTS.find(({ item }) => item.domain === 'metadata')!.item
    const titleChoice = createDurableChoice(
      titleConflict,
      'conflict-candidate:metadata-open-library',
      {
        id: 'durable-choice:dispossessed-title',
        decidedAt: '2026-08-25T09:00:00.000Z',
        note: 'Use the title printed in my edition.',
      },
    )

    expect(evaluateConflict(titleConflict, titleChoice)).toMatchObject({
      status: 'resolved',
      basis: 'durable-choice',
      value: 'The Dispossessed',
    })

    const publisherSubject = { type: 'edition', id: 'edition:dispossessed-epub' } as const
    const publisherConflict = conflictItemSchema.parse({
      id: 'conflict:dispossessed-publisher',
      domain: 'metadata',
      subject: publisherSubject,
      field: 'edition.publisher',
      reason: 'The imported file supplies a more edition-specific publisher.',
      candidates: [
        {
          id: 'conflict-candidate:publisher-file',
          subject: publisherSubject,
          field: 'edition.publisher',
          value: 'Harper Voyager',
          source: 'embedded-file',
          evidence: 'authoritative',
          observedAt: '2026-08-01T09:00:00.000Z',
          confidence: 0.98,
          explanation: 'Embedded in the selected EPUB.',
        },
        {
          id: 'conflict-candidate:publisher-google',
          subject: publisherSubject,
          field: 'edition.publisher',
          value: 'HarperCollins',
          source: 'google-books',
          evidence: 'observed',
          observedAt: '2026-08-24T09:00:00.000Z',
          confidence: 0.92,
          explanation: 'Provider-level publisher label.',
        },
      ],
    })

    expect(evaluateConflict(publisherConflict, titleChoice)).toMatchObject({
      status: 'resolved',
      basis: 'precedence-rule',
      value: 'Harper Voyager',
    })

    const workTitleFromFile = conflictItemSchema.parse({
      ...titleConflict,
      id: 'conflict:embedded-file-work-title-scope',
      candidates: [
        {
          ...titleConflict.candidates[0],
          id: 'conflict-candidate:file-work-title',
          source: 'embedded-file',
          evidence: 'authoritative',
        },
        titleConflict.candidates[1],
      ],
    })
    expect(evaluateConflict(workTitleFromFile).status).toBe('review')
  })
})

describe('reversible Work identity operations', () => {
  const absorbedWorkId = workIdSchema.parse('work:left-hand-duplicate')
  const splitWorkId = workIdSchema.parse('work:left-hand-audio-adaptation')
  const otherWorkId = workIdSchema.parse('work:left-hand-review-needed')
  const details = {
    id: 'identity-operation:left-hand-test',
    recordedAt: '2026-08-25T10:00:00.000Z',
    rationale: 'Fixture-backed identity review.',
  } as const

  test('merges every Edition and undoes to the exact previous assignments', () => {
    const editionsBefore = representativeCatalog.editions
      .filter(({ workId }) => workId === fixtureIds.works.leftHand)
      .map((edition) => ({ ...edition, workId: absorbedWorkId }))
    const operation = createWorkMergeOperation(
      editionsBefore,
      absorbedWorkId,
      fixtureIds.works.leftHand,
      details,
    )

    const merged = applyIdentityOperation(editionsBefore, operation)
    expect(merged.every(({ workId }) => workId === fixtureIds.works.leftHand)).toBe(true)
    expect(merged.map(({ id }) => id)).toEqual(editionsBefore.map(({ id }) => id))
    expect(undoIdentityOperation(merged, operation)).toEqual(editionsBefore)
  })

  test('splits a selected Edition and supports single-Edition reassignment', () => {
    const split = createWorkSplitOperation(
      [fixtureIds.editions.leftHandAudio],
      fixtureIds.works.leftHand,
      splitWorkId,
      { ...details, id: 'identity-operation:left-hand-split' },
    )
    const afterSplit = applyIdentityOperation(representativeCatalog.editions, split)

    expect(afterSplit.find(({ id }) => id === fixtureIds.editions.leftHandAudio)?.workId).toBe(splitWorkId)
    expect(afterSplit.find(({ id }) => id === fixtureIds.editions.leftHandEbook)?.workId).toBe(fixtureIds.works.leftHand)
    expect(undoIdentityOperation(afterSplit, split)).toEqual(representativeCatalog.editions)

    const reassignment = createEditionReassignmentOperation(
      editionIdSchema.parse(fixtureIds.editions.missingIsbn),
      fixtureIds.works.missingIsbn,
      otherWorkId,
      { ...details, id: 'identity-operation:single-reassignment' },
    )
    const reassigned = applyIdentityOperation(representativeCatalog.editions, reassignment)
    expect(reassigned.find(({ id }) => id === fixtureIds.editions.missingIsbn)?.workId).toBe(otherWorkId)
  })

  test('refuses undo when it would overwrite a later reassignment', () => {
    const split = createWorkSplitOperation(
      [fixtureIds.editions.leftHandAudio],
      fixtureIds.works.leftHand,
      splitWorkId,
      { ...details, id: 'identity-operation:protected-undo' },
    )
    const afterSplit = applyIdentityOperation(representativeCatalog.editions, split)
    const afterLaterEdit = afterSplit.map((edition) =>
      edition.id === fixtureIds.editions.leftHandAudio ? { ...edition, workId: otherWorkId } : edition,
    )

    expect(() => undoIdentityOperation(afterLaterEdit, split)).toThrow(
      'undo would overwrite later work',
    )
  })
})
