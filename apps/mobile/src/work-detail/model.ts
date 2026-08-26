import type { LibraryBook } from '../library-model'

export type WorkDetailSection = 'overview' | 'reading' | 'notes' | 'library'
export type EditionKind = 'print' | 'epub' | 'audiobook' | 'loan'
export type AvailabilityTone = 'local' | 'remote' | 'record-only' | 'unavailable'

export type EditionFact = {
  readonly label: string
  readonly value: string
  readonly source: string
}

export type EditionAsset = {
  readonly name: string
  readonly format: string
  readonly location: string
  readonly detail: string
}

export type EditionLoan = {
  readonly provider: string
  readonly due: string
  readonly detail: string
}

export type WorkEditionDetail = {
  readonly id: string
  readonly kind: EditionKind
  readonly label: string
  readonly shortLabel: string
  readonly medium: string
  readonly accessLabel: string
  readonly accessDetail: string
  readonly availabilityTone: AvailabilityTone
  readonly progress: number
  readonly progressLabel: string
  readonly facts: readonly EditionFact[]
  readonly sources: readonly string[]
  readonly asset?: EditionAsset
  readonly loan?: EditionLoan
}

export type ReadingSessionDetail = {
  readonly id: string
  readonly editionId: string
  readonly when: string
  readonly duration: string
  readonly change: string
}

export type AnnotationDetail = {
  readonly id: string
  readonly editionId: string
  readonly kind: 'Highlight' | 'Note' | 'Bookmark'
  readonly locator: string
  readonly excerpt: string
}

export type WorkHistoryDetail = {
  readonly id: string
  readonly when: string
  readonly title: string
  readonly detail: string
}

export type WorkDetailModel = {
  readonly id: string
  readonly title: string
  readonly authors: readonly string[]
  readonly identitySource: string
  readonly summary: string
  readonly overallProgress: number
  readonly overallProgressLabel: string
  readonly editions: readonly WorkEditionDetail[]
  readonly initialEditionId: string
  readonly sessions: readonly ReadingSessionDetail[]
  readonly annotations: readonly AnnotationDetail[]
  readonly history: readonly WorkHistoryDetail[]
}

export type IdentityActionKind = 'preferred' | 'split' | 'merge'

export type IdentityImpact = {
  readonly kind: IdentityActionKind
  readonly eyebrow: string
  readonly title: string
  readonly explanation: string
  readonly confirmLabel: string
  readonly counts: readonly {
    readonly label: string
    readonly before: string
    readonly after: string
  }[]
  readonly assurances: readonly string[]
}

export function buildWorkDetailModel(book: LibraryBook): WorkDetailModel {
  if (book.id === 'starter-tainted-cup') return denseTaintedCupModel(book)

  const editionId = `${book.id}:print`
  const source = book.sourceNames?.join(' · ') || 'Local library entry'
  const hasReading = book.shelf === 'reading' || book.shelf === 'finished'
  const progressLabel = book.pageCount > 0
    ? `${book.currentPage} of ${book.pageCount} pages`
    : `${book.progress}% complete`

  return {
    id: `work:${book.id}`,
    title: book.title,
    authors: book.authors,
    identitySource: `Work identity · ${source}`,
    summary: 'A local Work record. Add another edition when a different format or loan belongs to the same book.',
    overallProgress: book.progress,
    overallProgressLabel: hasReading ? progressLabel : shelfActivityLabel(book),
    initialEditionId: editionId,
    editions: [
      {
        id: editionId,
        kind: 'print',
        label: book.editionTitle || 'Print edition',
        shortLabel: 'Print',
        medium: 'Print',
        accessLabel: 'Catalog record',
        accessDetail: 'No readable file is attached to this edition.',
        availabilityTone: 'record-only',
        progress: book.progress,
        progressLabel,
        facts: [
          ...(book.pageCount > 0
            ? [{ label: 'Length', value: `${book.pageCount} pages`, source }]
            : []),
          { label: 'Language', value: 'Not recorded', source: 'No source value' },
          ...(book.identifiers?.length
            ? [{ label: 'Identifier', value: book.identifiers[0]!, source }]
            : []),
        ],
        sources: [source],
      },
    ],
    sessions: [],
    annotations: [],
    history: [
      {
        id: `${book.id}:added`,
        when: formatHistoryDate(book.addedAt),
        title: 'Added to the local library',
        detail: `${source} · available offline`,
      },
    ],
  }
}

export function createIdentityImpact(
  model: WorkDetailModel,
  kind: IdentityActionKind,
  editionId: string,
): IdentityImpact {
  const edition = model.editions.find(({ id }) => id === editionId) ?? model.editions[0]
  if (!edition) throw new Error('A Work detail requires at least one Edition')

  const attachedSessions = model.sessions.filter((session) => session.editionId === edition.id).length
  const attachedAnnotations = model.annotations.filter((annotation) => annotation.editionId === edition.id).length

  if (kind === 'preferred') {
    return {
      kind,
      eyebrow: 'Display preference',
      title: `Use ${edition.label} as the preferred edition?`,
      explanation: 'Covers and quick actions will start here. Reading history and every other edition stay unchanged.',
      confirmLabel: 'Use this edition',
      counts: [
        { label: 'Edition records', before: String(model.editions.length), after: String(model.editions.length) },
        { label: 'Reading events', before: String(model.sessions.length), after: String(model.sessions.length) },
      ],
      assurances: [
        'This changes a Work-level preference, not edition metadata.',
        'The previous preference can be restored with Undo.',
      ],
    }
  }

  if (kind === 'split') {
    return {
      kind,
      eyebrow: 'Identity change · preview only',
      title: `Split ${edition.label} into a new Work?`,
      explanation: 'The selected edition moves intact. It will no longer share this Work’s lists or combined reading view.',
      confirmLabel: 'Split edition',
      counts: [
        {
          label: 'Editions on this Work',
          before: String(model.editions.length),
          after: `${Math.max(0, model.editions.length - 1)} + 1 new Work`,
        },
        { label: 'Attached sessions', before: String(attachedSessions), after: `${attachedSessions} move intact` },
        { label: 'Attached annotations', before: String(attachedAnnotations), after: `${attachedAnnotations} move intact` },
        { label: 'Attached assets', before: edition.asset ? '1' : '0', after: edition.asset ? '1 moves intact' : '0' },
      ],
      assurances: [
        'No file, loan, progress event, source, or annotation is deleted.',
        'Undo restores the exact Edition → Work assignment.',
      ],
    }
  }

  return {
    kind,
    eyebrow: 'Identity change · preview only',
    title: `Merge an imported ${model.title} record here?`,
    explanation: 'A possible duplicate with one print edition will move into this Work. Existing editions keep their own facts and identifiers.',
    confirmLabel: 'Merge Work records',
    counts: [
      { label: 'Work records', before: '2', after: '1' },
      { label: 'Editions together', before: String(model.editions.length), after: String(model.editions.length + 1) },
      { label: 'Reading events', before: String(model.sessions.length), after: String(model.sessions.length) },
      { label: 'Source records', before: edition.sources.length.toString(), after: `${edition.sources.length + 1} retained` },
    ],
    assurances: [
      'Edition-specific metadata is never promoted to the Work.',
      'The operation is journaled and can be undone in one step.',
    ],
  }
}

function denseTaintedCupModel(book: LibraryBook): WorkDetailModel {
  const printId = `${book.id}:hardcover`
  const epubId = `${book.id}:epub`
  const audioId = `${book.id}:audio`
  const loanId = `${book.id}:libby`

  return {
    id: `work:${book.id}`,
    title: book.title,
    authors: book.authors,
    identitySource: 'Work identity · Reader confirmed · Google Books',
    summary: 'Ana Dolabra investigates an impossible murder in a mansion at the edge of a contagion-stricken empire.',
    overallProgress: book.progress,
    overallProgressLabel: `${book.progress}% across one reading history`,
    initialEditionId: epubId,
    editions: [
      {
        id: printId,
        kind: 'print',
        label: 'US hardcover',
        shortLabel: 'Print',
        medium: 'Hardcover',
        accessLabel: 'Owned',
        accessDetail: 'Physical copy · available at home',
        availabilityTone: 'local',
        progress: 24,
        progressLabel: 'Page 96 of 400',
        facts: [
          { label: 'Length', value: '400 pages', source: 'Printed colophon' },
          { label: 'Published', value: 'February 2024', source: 'Google Books' },
          { label: 'Publisher', value: 'Del Rey', source: 'Printed colophon' },
          { label: 'Language', value: 'English', source: 'Reader confirmed' },
          { label: 'ISBN-13', value: '9781984820709', source: 'Barcode scan' },
        ],
        sources: ['Barcode scan', 'Printed colophon', 'Google Books'],
      },
      {
        id: epubId,
        kind: 'epub',
        label: 'EPUB edition',
        shortLabel: 'EPUB',
        medium: 'Ebook',
        accessLabel: 'On this device',
        accessDetail: 'Readable offline · local file verified',
        availabilityTone: 'local',
        progress: book.progress,
        progressLabel: `${book.progress}% · chapter 19`,
        facts: [
          { label: 'Extent', value: '400 pages reported', source: 'EPUB metadata' },
          { label: 'Published', value: 'February 2024', source: 'EPUB metadata' },
          { label: 'Publisher', value: 'Del Rey', source: 'EPUB metadata' },
          { label: 'Language', value: 'English', source: 'EPUB package' },
          { label: 'ISBN-13', value: '9781984820716', source: 'EPUB package' },
        ],
        sources: ['EPUB package', 'Calibre import'],
        asset: {
          name: 'the-tainted-cup.epub',
          format: 'EPUB · 5.8 MB',
          location: 'Managed local file',
          detail: 'Checksum verified · available offline',
        },
      },
      {
        id: audioId,
        kind: 'audiobook',
        label: 'Unabridged audio',
        shortLabel: 'Audio',
        medium: 'Audiobook',
        accessLabel: 'Linked file',
        accessDetail: 'Available when the linked drive is mounted',
        availabilityTone: 'remote',
        progress: 8,
        progressLabel: '1h 04m of 13h 18m',
        facts: [
          { label: 'Duration', value: '13h 18m', source: 'M4B chapters' },
          { label: 'Narrator', value: 'Andrew Fallaize', source: 'Libro.fm metadata' },
          { label: 'Published', value: 'February 2024', source: 'Libro.fm metadata' },
          { label: 'Language', value: 'English', source: 'M4B metadata' },
        ],
        sources: ['M4B metadata', 'Libro.fm'],
        asset: {
          name: 'The Tainted Cup.m4b',
          format: 'M4B · 612 MB',
          location: 'Linked file',
          detail: 'Last seen on Reader Drive · Aug 24',
        },
      },
      {
        id: loanId,
        kind: 'loan',
        label: 'Libby loan',
        shortLabel: 'Libby',
        medium: 'Audiobook loan',
        accessLabel: 'Available for 9 days',
        accessDetail: 'Streaming access · connection required',
        availabilityTone: 'remote',
        progress: 18,
        progressLabel: '2h 23m listened',
        facts: [
          { label: 'Duration', value: '13h 18m', source: 'Libby' },
          { label: 'Narrator', value: 'Andrew Fallaize', source: 'Libby' },
          { label: 'Borrowed', value: 'August 21, 2026', source: 'Libby loan' },
          { label: 'Language', value: 'English', source: 'Libby' },
        ],
        sources: ['Libby loan', 'Public library catalog'],
        asset: {
          name: 'Libby streaming audio',
          format: 'Remote audio',
          location: 'Provider managed',
          detail: 'Not downloaded · expires with loan',
        },
        loan: {
          provider: 'Libby · Central Library',
          due: 'Due Sep 4 · 9 days left',
          detail: '1 renewal used · availability is derived from this loan',
        },
      },
    ],
    sessions: [
      { id: 'session:aug-25', editionId: epubId, when: 'Yesterday · 22:14', duration: '38 min', change: '61% → 67%' },
      { id: 'session:aug-24', editionId: loanId, when: 'Aug 24 · 08:02', duration: '27 min', change: '1h 56m → 2h 23m' },
      { id: 'session:aug-22', editionId: printId, when: 'Aug 22 · 19:40', duration: '46 min', change: 'Page 72 → 96' },
      { id: 'session:aug-21', editionId: audioId, when: 'Aug 21 · 07:31', duration: '1h 04m', change: 'Started audio' },
    ],
    annotations: [
      {
        id: 'annotation:architecture',
        editionId: epubId,
        kind: 'Highlight',
        locator: 'Chapter 12 · 48%',
        excerpt: 'The architecture of a lie matters as much as the lie itself.',
      },
      {
        id: 'annotation:detective',
        editionId: printId,
        kind: 'Note',
        locator: 'Page 88',
        excerpt: 'Return to the way Ana separates observation from interpretation.',
      },
      {
        id: 'annotation:bookmark',
        editionId: loanId,
        kind: 'Bookmark',
        locator: '02:11:40',
        excerpt: 'An especially good explanation of the contagion’s rules.',
      },
    ],
    history: [
      { id: 'history:progress', when: 'Yesterday', title: 'EPUB progress updated', detail: 'Local reader · 67%' },
      { id: 'history:loan', when: 'Aug 21', title: 'Libby loan borrowed', detail: 'Due Sep 4 · access derived from loan' },
      { id: 'history:audio', when: 'Aug 18', title: 'Audiobook linked', detail: 'Libro.fm metadata retained' },
      { id: 'history:added', when: 'Feb 9', title: 'Work added to Reading', detail: 'Google Books · reader confirmed identity' },
    ],
  }
}

function shelfActivityLabel(book: LibraryBook): string {
  if (book.shelf === 'finished') return 'Finished'
  if (book.shelf === 'reading') return `${book.progress}% complete`
  if (book.shelf === 'next') return 'Up Next · not started'
  return 'To Be Read · not started'
}

function formatHistoryDate(value: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value))
}
