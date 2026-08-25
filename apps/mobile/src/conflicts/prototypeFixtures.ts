import {
  conflictItemSchema,
  type ConflictItem,
  type SourceAdapter,
} from '../domain/catalog'

export const SOURCE_LABELS: Record<SourceAdapter, string> = {
  'local-manual': 'Local choice',
  'legacy-migration': 'Legacy library',
  'isbn-scan': 'ISBN scan',
  'embedded-file': 'Embedded file metadata',
  'wovenleaf-epub-reader': 'Wovenleaf EPUB reader',
  'wovenleaf-audio-player': 'Wovenleaf audio player',
  'google-books': 'Google Books',
  'open-library': 'Open Library',
  'libby-timeline': 'Libby timeline export',
  'libby-tags': 'Libby tag export',
  'libby-web-capture': 'Libby Web observation',
  'overdrive-api': 'OverDrive API',
  audiobookshelf: 'Audiobookshelf',
  opds: 'OPDS catalog',
  'calibre-catalog': 'Calibre catalog',
  readwise: 'Readwise',
  'goodreads-csv': 'Goodreads export',
  'storygraph-csv': 'StoryGraph export',
  koreader: 'KOReader',
  'calibre-statistics': 'Calibre statistics',
  hardcover: 'Hardcover',
  bookwyrm: 'BookWyrm',
}

export interface ConflictPrototypeFixture {
  readonly item: ConflictItem
  readonly eyebrow: string
  readonly title: string
  readonly work: string
  readonly summary: string
  readonly consequence: string
  readonly recommendedCandidateId: string
  readonly displayValues: Readonly<Record<string, string>>
}

function candidate(
  id: string,
  subject: ConflictItem['subject'],
  field: string,
  value: ConflictItem['candidates'][number]['value'],
  source: SourceAdapter,
  evidence: ConflictItem['candidates'][number]['evidence'],
  observedAt: string,
  confidence: number,
  explanation: string,
) {
  return { id, subject, field, value, source, evidence, observedAt, confidence, explanation }
}

const identitySubject = { type: 'edition', id: 'edition:sea-around-us-scan' } as const
const metadataSubject = { type: 'work', id: 'work:dispossessed' } as const
const listSubject = { type: 'list-entry', id: 'list-entry:parables-up-next' } as const
const progressSubject = { type: 'reading-state', id: 'reading-state:left-hand-cross-format' } as const
const finishSubject = { type: 'reading-state', id: 'reading-state:kindred-finish' } as const
const deletionSubject = { type: 'catalog-record', id: 'annotation:braiding-sweetgrass-42' } as const

export const PROTOTYPE_CONFLICTS: readonly ConflictPrototypeFixture[] = [
  {
    eyebrow: 'Identity · possible duplicate',
    title: 'One scan, two possible works',
    work: 'The Sea Around Us · Rachel Carson',
    summary: 'The scanned ISBN names a 1951 edition, while OverDrive links the same loan to a later illustrated record.',
    consequence: 'Choosing the wrong work would group unrelated covers, editions, and reading history.',
    recommendedCandidateId: 'conflict-candidate:identity-isbn',
    displayValues: {
      'conflict-candidate:identity-isbn': 'The Sea Around Us (1951 work)',
      'conflict-candidate:identity-overdrive': 'The Sea Around Us: Illustrated Edition',
    },
    item: conflictItemSchema.parse({
      id: 'conflict:work-identity-sea-around-us',
      domain: 'work-identity',
      subject: identitySubject,
      field: 'edition.workId',
      reason: 'Identifiers support different Work assignments; title similarity is not enough to merge.',
      candidates: [
        candidate(
          'conflict-candidate:identity-isbn', identitySubject, 'edition.workId', 'work:sea-around-us-1951',
          'isbn-scan', 'observed', '2026-08-17T09:12:00.000Z', 0.96,
          'The physical barcode directly identifies this Edition, but Work grouping still needs a person.',
        ),
        candidate(
          'conflict-candidate:identity-overdrive', identitySubject, 'edition.workId', 'work:sea-around-us-illustrated',
          'overdrive-api', 'observed', '2026-08-24T18:20:00.000Z', 0.83,
          'OverDrive supplied a source-local edition match from the reader’s current loan.',
        ),
      ],
    }),
  },
  {
    eyebrow: 'Metadata · title',
    title: 'Providers disagree on the subtitle',
    work: 'The Dispossessed · Ursula K. Le Guin',
    summary: 'Both providers are useful observations. The newer response is not automatically the better title.',
    consequence: 'This changes the title shown throughout the library, but not identifiers or other fields.',
    recommendedCandidateId: 'conflict-candidate:metadata-open-library',
    displayValues: {
      'conflict-candidate:metadata-google': 'The Dispossessed: A Novel',
      'conflict-candidate:metadata-open-library': 'The Dispossessed',
    },
    item: conflictItemSchema.parse({
      id: 'conflict:metadata-dispossessed-title',
      domain: 'metadata',
      subject: metadataSubject,
      field: 'work.title',
      reason: 'Peer metadata providers have equal field-level trust and different values.',
      candidates: [
        candidate(
          'conflict-candidate:metadata-google', metadataSubject, 'work.title', 'The Dispossessed: A Novel',
          'google-books', 'observed', '2026-08-24T10:00:00.000Z', 0.91,
          'A recent Google Books response includes marketing copy in the main title.',
        ),
        candidate(
          'conflict-candidate:metadata-open-library', metadataSubject, 'work.title', 'The Dispossessed',
          'open-library', 'observed', '2026-07-12T08:30:00.000Z', 0.88,
          'Open Library reports the shorter title used by the selected publication.',
        ),
      ],
    }),
  },
  {
    eyebrow: 'Lists · placement',
    title: 'Keep this book Up Next?',
    work: 'Parable of the Sower · Octavia E. Butler',
    summary: 'A Libby tag export says this is next, while an older migration snapshot places it in the general TBR.',
    consequence: 'Only this list membership changes. Notes, custom order, and the Work remain untouched.',
    recommendedCandidateId: 'conflict-candidate:list-libby',
    displayValues: {
      'conflict-candidate:list-libby': 'Up Next',
      'conflict-candidate:list-goodreads': 'To Be Read',
    },
    item: conflictItemSchema.parse({
      id: 'conflict:list-parable-placement',
      domain: 'list-placement',
      subject: listSubject,
      field: 'list-entry.listId',
      reason: 'Two source-managed shelves map to different local lists.',
      candidates: [
        candidate(
          'conflict-candidate:list-libby', listSubject, 'list-entry.listId', 'list:up-next',
          'libby-tags', 'observed', '2026-08-23T16:00:00.000Z', 0.9,
          'The latest explicit Libby tag snapshot includes the title in the mapped Up Next list.',
        ),
        candidate(
          'conflict-candidate:list-goodreads', listSubject, 'list-entry.listId', 'list:tbr',
          'goodreads-csv', 'observed', '2026-06-02T11:00:00.000Z', 0.82,
          'The migration export preserves the title on the Goodreads to-read shelf.',
        ),
      ],
    }),
  },
  {
    eyebrow: 'Progress · cross-format',
    title: 'Two honest places in one story',
    work: 'The Left Hand of Darkness · Ursula K. Le Guin',
    summary: 'Wovenleaf recorded the EPUB at 64% and the audiobook at 71%. Cross-format positions are not interchangeable.',
    consequence: 'The choice sets the Work-level Continue shortcut; each Edition keeps its own native location.',
    recommendedCandidateId: 'conflict-candidate:progress-epub',
    displayValues: {
      'conflict-candidate:progress-epub': 'EPUB · chapter 13 · 64%',
      'conflict-candidate:progress-audio': 'Audiobook · 7h 42m · 71%',
    },
    item: conflictItemSchema.parse({
      id: 'conflict:progress-left-hand-cross-format',
      domain: 'progress',
      subject: progressSubject,
      field: 'reading-state.continueFrom',
      reason: 'Both first-party readers are authoritative for different Editions.',
      candidates: [
        candidate(
          'conflict-candidate:progress-epub', progressSubject, 'reading-state.continueFrom',
          { editionId: 'edition:left-hand-ebook', normalizedProgress: 0.64 },
          'wovenleaf-epub-reader', 'authoritative', '2026-08-24T21:10:00.000Z', 1,
          'A direct EPUB locator exists and remains resumable on this device.',
        ),
        candidate(
          'conflict-candidate:progress-audio', progressSubject, 'reading-state.continueFrom',
          { editionId: 'edition:left-hand-audio', normalizedProgress: 0.71 },
          'wovenleaf-audio-player', 'authoritative', '2026-08-24T20:48:00.000Z', 1,
          'A direct audio timestamp exists and remains resumable on this device.',
        ),
      ],
    }),
  },
  {
    eyebrow: 'Reading state · finish',
    title: 'Finished, or still reading?',
    work: 'Kindred · Octavia E. Butler',
    summary: 'StoryGraph records a finish date, while a Goodreads snapshot still says currently reading.',
    consequence: 'A finish decision adds a reading event. Neither migration row is deleted.',
    recommendedCandidateId: 'conflict-candidate:finish-storygraph',
    displayValues: {
      'conflict-candidate:finish-storygraph': 'Finished · 18 August 2026',
      'conflict-candidate:finish-goodreads': 'Currently reading',
    },
    item: conflictItemSchema.parse({
      id: 'conflict:finish-kindred',
      domain: 'finish-state',
      subject: finishSubject,
      field: 'reading-state.status',
      reason: 'Migration sources disagree and neither may overwrite the event ledger silently.',
      candidates: [
        candidate(
          'conflict-candidate:finish-storygraph', finishSubject, 'reading-state.status', 'finished',
          'storygraph-csv', 'observed', '2026-08-20T09:00:00.000Z', 0.9,
          'The export includes an explicit finish date and a completed reading period.',
        ),
        candidate(
          'conflict-candidate:finish-goodreads', finishSubject, 'reading-state.status', 'reading',
          'goodreads-csv', 'observed', '2026-08-21T09:00:00.000Z', 0.86,
          'The later export still reports currently reading, but has no event explaining the reversal.',
        ),
      ],
    }),
  },
  {
    eyebrow: 'Deletion · annotation',
    title: 'Remove this highlight?',
    work: 'Braiding Sweetgrass · Robin Wall Kimmerer',
    summary: 'Readwise deleted its copy, but the same highlight has a newer local note that the source never saw.',
    consequence: 'Deleting removes the local annotation after a recoverable tombstone; keeping detaches it from source deletion.',
    recommendedCandidateId: 'conflict-candidate:deletion-keep',
    displayValues: {
      'conflict-candidate:deletion-readwise': 'Delete the local highlight',
      'conflict-candidate:deletion-keep': 'Keep it with the local note',
    },
    item: conflictItemSchema.parse({
      id: 'conflict:deletion-readwise-highlight',
      domain: 'deletion',
      subject: deletionSubject,
      field: 'catalog-record.deleted',
      reason: 'A source tombstone conflicts with later data outside that source’s managed scope.',
      candidates: [
        candidate(
          'conflict-candidate:deletion-readwise', deletionSubject, 'catalog-record.deleted', true,
          'readwise', 'observed', '2026-08-24T12:00:00.000Z', 0.98,
          'Readwise explicitly tombstoned the source highlight during incremental sync.',
        ),
        candidate(
          'conflict-candidate:deletion-keep', deletionSubject, 'catalog-record.deleted', false,
          'embedded-file', 'observed', '2026-08-24T13:25:00.000Z', 1,
          'A local note was added after import and is outside Readwise deletion ownership.',
        ),
      ],
    }),
  },
] as const
