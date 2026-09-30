import { t, getLocale, formatNumber } from '../localization'
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
  const source = book.sourceNames?.join(' · ') || t("Local library entry")
  const hasReading = book.shelf === 'reading' || book.shelf === 'finished' || book.shelf === 'dnf'
  const progressLabel = book.pageCount > 0
    ? t("editionPageProgress", { count: book.pageCount, current: formatNumber(book.currentPage), total: formatNumber(book.pageCount) })
    : t("{{value}}% complete", { value: formatNumber(book.progress) })

  return {
    id: `work:${book.id}`,
    title: book.title,
    authors: book.authors,
    identitySource: t("Work identity · {{v0}}", { v0: source }),
    summary: t("A local Work record. Add another edition when a different format or loan belongs to the same book."),
    overallProgress: book.progress,
    overallProgressLabel: hasReading ? progressLabel : shelfActivityLabel(book),
    initialEditionId: editionId,
    editions: [
      {
        id: editionId,
        kind: 'print',
        label: book.editionTitle || t("Print edition"),
        shortLabel: t("Print"),
        medium: t("Print"),
        accessLabel: t("Catalog record"),
        accessDetail: t("No readable file is attached to this edition."),
        availabilityTone: 'record-only',
        progress: book.progress,
        progressLabel,
        facts: [
          ...(book.pageCount > 0
            ? [{ label: t("Length"), value: t("pageCount", { count: book.pageCount, value: formatNumber(book.pageCount) }), source }]
            : []),
          { label: t("Language"), value: t("Not recorded"), source: t("No source value") },
          ...(book.identifiers?.length
            ? [{ label: t("Identifier"), value: book.identifiers[0]!, source }]
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
        title: t("Added to the local library"),
        detail: t("{{v0}} · available offline", { v0: source }),
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
  if (!edition) throw new Error(t("A Work detail requires at least one Edition"))

  const attachedSessions = model.sessions.filter((session) => session.editionId === edition.id).length
  const attachedAnnotations = model.annotations.filter((annotation) => annotation.editionId === edition.id).length

  if (kind === 'preferred') {
    return {
      kind,
      eyebrow: t("Display preference"),
      title: t("Use {{v0}} as the preferred edition?", { v0: edition.label }),
      explanation: t("Covers and quick actions will start here. Reading history and every other edition stay unchanged."),
      confirmLabel: t("Use this edition"),
      counts: [
        { label: t("Edition records"), before: String(model.editions.length), after: String(model.editions.length) },
        { label: t("Reading events"), before: String(model.sessions.length), after: String(model.sessions.length) },
      ],
      assurances: [
        t("This changes a Work-level preference, not edition metadata."),
        t("The previous preference can be restored with Undo."),
      ],
    }
  }

  if (kind === 'split') {
    return {
      kind,
      eyebrow: t("Identity change · preview only"),
      title: t("Split {{v0}} into a new Work?", { v0: edition.label }),
      explanation: t("The selected edition moves intact. It will no longer share this Work’s lists or combined reading view."),
      confirmLabel: t("Split edition"),
      counts: [
        {
          label: t("Editions on this Work"),
          before: String(model.editions.length),
          after: t("{{v0}} + 1 new Work", { v0: Math.max(0, model.editions.length - 1) }),
        },
        { label: t("Attached sessions"), before: String(attachedSessions), after: t("{{v0}} move intact", { v0: attachedSessions }) },
        { label: t("Attached annotations"), before: String(attachedAnnotations), after: t("{{v0}} move intact", { v0: attachedAnnotations }) },
        { label: t("Attached assets"), before: edition.asset ? '1' : '0', after: edition.asset ? t("1 moves intact") : '0' },
      ],
      assurances: [
        t("No file, loan, progress event, source, or annotation is deleted."),
        t("Undo restores the exact Edition → Work assignment."),
      ],
    }
  }

  return {
    kind,
    eyebrow: t("Identity change · preview only"),
    title: t("Merge an imported {{v0}} record here?", { v0: model.title }),
    explanation: t("A possible duplicate with one print edition will move into this Work. Existing editions keep their own facts and identifiers."),
    confirmLabel: t("Merge Work records"),
    counts: [
      { label: t("Work records"), before: '2', after: '1' },
      { label: t("Editions together"), before: String(model.editions.length), after: String(model.editions.length + 1) },
      { label: t("Reading events"), before: String(model.sessions.length), after: String(model.sessions.length) },
      { label: t("Source records"), before: edition.sources.length.toString(), after: `${edition.sources.length + 1} retained` },
    ],
    assurances: [
      t("Edition-specific metadata is never promoted to the Work."),
      t("The operation is journaled and can be undone in one step."),
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
    identitySource: t("Work identity · Reader confirmed · Open Library"),
    summary: t("Ana Dolabra investigates an impossible murder in a mansion at the edge of a contagion-stricken empire."),
    overallProgress: book.progress,
    overallProgressLabel: t("{{v0}}% across one reading history", { v0: book.progress }),
    initialEditionId: epubId,
    editions: [
      {
        id: printId,
        kind: 'print',
        label: t("US hardcover"),
        shortLabel: t("Print"),
        medium: 'Hardcover',
        accessLabel: t("Owned"),
        accessDetail: t("Physical copy · available at home"),
        availabilityTone: 'local',
        progress: 24,
        progressLabel: 'Page 96 of 400',
        facts: [
          { label: t("Length"), value: '400 pages', source: t("Printed colophon") },
          { label: t("Published"), value: 'February 2024', source: t("Open Library") },
          { label: t("Publisher"), value: 'Del Rey', source: t("Printed colophon") },
          { label: t("Language"), value: 'English', source: t("Reader confirmed") },
          { label: 'ISBN-13', value: '9781984820709', source: t("Barcode scan") },
        ],
        sources: [t("Barcode scan"), t("Printed colophon"), t("Open Library")],
      },
      {
        id: epubId,
        kind: 'epub',
        label: t("EPUB edition"),
        shortLabel: 'EPUB',
        medium: 'Ebook',
        accessLabel: t("On this device"),
        accessDetail: t("Readable offline · local file verified"),
        availabilityTone: 'local',
        progress: book.progress,
        progressLabel: `${book.progress}% · chapter 19`,
        facts: [
          { label: t("Extent"), value: '400 pages reported', source: t("EPUB metadata") },
          { label: t("Published"), value: 'February 2024', source: t("EPUB metadata") },
          { label: t("Publisher"), value: 'Del Rey', source: t("EPUB metadata") },
          { label: t("Language"), value: 'English', source: t("EPUB package") },
          { label: 'ISBN-13', value: '9781984820716', source: t("EPUB package") },
        ],
        sources: [t("EPUB package"), t("Calibre import")],
        asset: {
          name: 'the-tainted-cup.epub',
          format: 'EPUB · 5.8 MB',
          location: t("Managed local file"),
          detail: t("Checksum verified · available offline"),
        },
      },
      {
        id: audioId,
        kind: 'audiobook',
        label: t("Unabridged audio"),
        shortLabel: t("Audio"),
        medium: 'Audiobook',
        accessLabel: t("Linked file"),
        accessDetail: t("Available when the linked drive is mounted"),
        availabilityTone: 'remote',
        progress: 8,
        progressLabel: '1h 04m of 13h 18m',
        facts: [
          { label: t("Duration"), value: '13h 18m', source: 'M4B chapters' },
          { label: t("Narrator"), value: 'Andrew Fallaize', source: t("Libro.fm metadata") },
          { label: t("Published"), value: 'February 2024', source: t("Libro.fm metadata") },
          { label: t("Language"), value: 'English', source: 'M4B metadata' },
        ],
        sources: ['M4B metadata', 'Libro.fm'],
        asset: {
          name: 'The Tainted Cup.m4b',
          format: 'M4B · 612 MB',
          location: t("Linked file"),
          detail: t("Last seen on Reader Drive · Aug 24"),
        },
      },
      {
        id: loanId,
        kind: 'loan',
        label: t("Libby loan"),
        shortLabel: 'Libby',
        medium: t("Audiobook loan"),
        accessLabel: t("Available for 9 days"),
        accessDetail: t("Streaming access · connection required"),
        availabilityTone: 'remote',
        progress: 18,
        progressLabel: '2h 23m listened',
        facts: [
          { label: t("Duration"), value: '13h 18m', source: 'Libby' },
          { label: t("Narrator"), value: 'Andrew Fallaize', source: 'Libby' },
          { label: t("Borrowed"), value: 'August 21, 2026', source: t("Libby loan") },
          { label: t("Language"), value: 'English', source: 'Libby' },
        ],
        sources: [t("Libby loan"), t("Public library catalog")],
        asset: {
          name: 'Libby streaming audio',
          format: t("Remote audio"),
          location: t("Provider managed"),
          detail: t("Not downloaded · expires with loan"),
        },
        loan: {
          provider: t("Libby · Central Library"),
          due: t("Due Sep 4 · 9 days left"),
          detail: t("1 renewal used · availability is derived from this loan"),
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
        kind: "Highlight",
        locator: 'Chapter 12 · 48%',
        excerpt: 'The architecture of a lie matters as much as the lie itself.',
      },
      {
        id: 'annotation:detective',
        editionId: printId,
        kind: "Note",
        locator: 'Page 88',
        excerpt: 'Return to the way Ana separates observation from interpretation.',
      },
      {
        id: 'annotation:bookmark',
        editionId: loanId,
        kind: "Bookmark",
        locator: '02:11:40',
        excerpt: 'An especially good explanation of the contagion’s rules.',
      },
    ],
    history: [
      { id: 'history:progress', when: 'Yesterday', title: t("EPUB progress updated"), detail: t("Local reader · 67%") },
      { id: 'history:loan', when: 'Aug 21', title: t("Libby loan borrowed"), detail: t("Due Sep 4 · access derived from loan") },
      { id: 'history:audio', when: 'Aug 18', title: t("Audiobook linked"), detail: t("Libro.fm metadata retained") },
      { id: 'history:added', when: 'Feb 9', title: t("Work added to Reading"), detail: t("Open Library · reader confirmed identity") },
    ],
  }
}

function shelfActivityLabel(book: LibraryBook): string {
  if (book.shelf === 'finished') return t("Finished")
  if (book.shelf === 'dnf') return t("Did not finish · {{v0}}% complete", { v0: book.progress })
  if (book.shelf === 'reading') return t("{{value}}% complete", { value: formatNumber(book.progress) })
  if (book.shelf === 'next') return t("Up Next · not started")
  return t("To Be Read · not started")
}

function formatHistoryDate(value: string): string {
  return new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric' }).format(new Date(value))
}
