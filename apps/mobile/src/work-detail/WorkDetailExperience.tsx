import { OriginalFileInput } from '../files/OriginalFileInput'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  BookCheck,
  BookCopy,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  FolderInput,
  GitMerge,
  HardDrive,
  Hash,
  Headphones,
  History,
  Library,
  Pin,
  Pencil,
  RefreshCw,
  RotateCcw,
  Scissors,
  ShieldCheck,
  StickyNote,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react'
import { RatingStars, StatusBadge } from '../design-system'
import { SHELVES, type LibraryBook, type ShelfId } from '../library'
import type { CustomShelf } from '../organization-model'
import {
  buildWorkDetailModel,
  createIdentityImpact,
  type IdentityActionKind,
  type IdentityImpact,
  type WorkDetailModel,
  type WorkDetailSection,
  type WorkEditionDetail,
} from './model'
import { tw } from '../tailwind/styles'
import { motionStyles } from '../tailwind/motion'
import { applyManualBookEdits, inspectIsbnInput } from '../capture'
import { FEATURES } from '../app/feature-flags'
import type { EpubImportProgress, EpubImportResult } from '../epub'
import type { AudiobookImportDraft, AudiobookImportProgress, AudiobookImportResult } from '../audiobooks'
import { EditableBookCover } from './EditableBookCover'

export type EpubAttachmentState = {
  readonly progress?: EpubImportProgress
  readonly result?: EpubImportResult
  readonly error?: string
}

export type AudiobookAttachmentState = {
  readonly progress?: AudiobookImportProgress
  readonly draft?: AudiobookImportDraft
  readonly result?: AudiobookImportResult
  readonly error?: string
}

type WorkDetailExperienceProps = {
  readonly book: LibraryBook
  readonly libby?: ReactNode
  readonly customShelves: readonly CustomShelf[]
  readonly customShelfIds: readonly string[]
  readonly tags: readonly string[]
  readonly tagSuggestions: readonly string[]
  readonly onMove: (shelf: ShelfId) => void
  readonly onRead: () => void
  readonly onProgress: () => void
  readonly onFinish: () => void
  readonly onRate: (rating: number) => void
  readonly onNotes: (notes: string) => void
  readonly onMetadata: (changes: Partial<LibraryBook>) => void
  readonly onCover: (thumbnail: string) => void
  readonly onEnrich: () => Promise<boolean>
  readonly onCustomShelves: (shelfIds: readonly string[]) => void
  readonly onTags: (tags: readonly string[]) => void
  readonly onRemove: () => void
  readonly onAttachEpub: (files: readonly File[], overwriteCover: boolean) => void
  readonly onAttachAudiobook: (files: readonly File[], overwriteCover: boolean) => void
  readonly epubBusy: boolean
  readonly epubImport: EpubAttachmentState
  readonly audiobookBusy: boolean
  readonly audiobookImport: AudiobookAttachmentState
}

type IdentitySnapshot = {
  readonly preferredEditionId: string
  readonly separatedEditionIds: readonly string[]
  readonly mergedRecord: boolean
  readonly message: string
}

const detailSections: ReadonlyArray<{
  readonly id: WorkDetailSection
  readonly label: string
  readonly icon: ReactNode
}> = [
  { id: 'overview', label: 'Edition', icon: <BookOpen aria-hidden="true" /> },
  { id: 'reading', label: 'Reading', icon: <Clock3 aria-hidden="true" /> },
  { id: 'notes', label: 'Notes', icon: <StickyNote aria-hidden="true" /> },
  { id: 'library', label: 'Library', icon: <Library aria-hidden="true" /> },
]

const editionIcons: Record<WorkEditionDetail['kind'], ReactNode> = {
  print: <BookCopy aria-hidden="true" />,
  epub: <FileText aria-hidden="true" />,
  audiobook: <Headphones aria-hidden="true" />,
  loan: <Download aria-hidden="true" />,
}

export function WorkDetailExperience({
  book,
  libby,
  customShelves,
  customShelfIds,
  tags,
  tagSuggestions,
  onMove,
  onRead,
  onProgress,
  onFinish,
  onRate,
  onNotes,
  onMetadata,
  onCover,
  onEnrich,
  onCustomShelves,
  onTags,
  onRemove,
  onAttachEpub,
  onAttachAudiobook,
  epubBusy,
  epubImport,
  audiobookBusy,
  audiobookImport,
}: WorkDetailExperienceProps) {
  const model = useMemo(() => buildWorkDetailModel(book), [book])
  const [activeSection, setActiveSection] = useState<WorkDetailSection>('overview')
  const [selectedEditionId, setSelectedEditionId] = useState(model.initialEditionId)
  const [preferredEditionId, setPreferredEditionId] = useState(model.initialEditionId)
  const [separatedEditionIds, setSeparatedEditionIds] = useState<readonly string[]>([])
  const [mergedRecord, setMergedRecord] = useState(false)
  const [identityPreview, setIdentityPreview] = useState<IdentityImpact>()
  const [identitySnapshot, setIdentitySnapshot] = useState<IdentitySnapshot>()
  const [announcement, setAnnouncement] = useState('')
  const selectedEdition = model.editions.find(({ id }) => id === selectedEditionId) ?? model.editions[0]!

  if (!FEATURES.advancedBookDetails) {
    return (
      <SimpleBookDetail
        book={book}
        libby={libby}
        customShelves={customShelves}
        customShelfIds={customShelfIds}
        tags={tags}
        tagSuggestions={tagSuggestions}
        onMove={onMove}
        onRead={onRead}
        onProgress={onProgress}
        onFinish={onFinish}
        onRate={onRate}
        onNotes={onNotes}
        onMetadata={onMetadata}
        onCover={onCover}
        onCustomShelves={onCustomShelves}
        onTags={onTags}
        onRemove={onRemove}
        onAttachEpub={onAttachEpub}
        onAttachAudiobook={onAttachAudiobook}
        epubBusy={epubBusy}
        epubImport={epubImport}
        audiobookBusy={audiobookBusy}
        audiobookImport={audiobookImport}
      />
    )
  }

  const openIdentityPreview = (kind: IdentityActionKind) => {
    setIdentityPreview(createIdentityImpact(model, kind, selectedEdition.id))
  }

  const applyIdentityChange = () => {
    if (!identityPreview) return
    const snapshot = {
      preferredEditionId,
      separatedEditionIds,
      mergedRecord,
      message: '',
    }

    if (identityPreview.kind === 'preferred') {
      setPreferredEditionId(selectedEdition.id)
      snapshot.message = `${selectedEdition.label} is now preferred.`
    } else if (identityPreview.kind === 'split') {
      setSeparatedEditionIds((current) => [...new Set([...current, selectedEdition.id])])
      snapshot.message = `${selectedEdition.label} moved to a new Work. Its data stayed attached.`
    } else {
      setMergedRecord(true)
      snapshot.message = `Imported ${model.title} record merged here. Edition facts stayed separate.`
    }

    setIdentitySnapshot(snapshot)
    setAnnouncement(`${snapshot.message} Undo is available.`)
    setIdentityPreview(undefined)
  }

  const undoIdentityChange = () => {
    if (!identitySnapshot) return
    setPreferredEditionId(identitySnapshot.preferredEditionId)
    setSeparatedEditionIds(identitySnapshot.separatedEditionIds)
    setMergedRecord(identitySnapshot.mergedRecord)
    setAnnouncement(`Undone. ${identitySnapshot.message.replace(/\.$/, '')} was restored to its previous state.`)
    setIdentitySnapshot(undefined)
  }

  return (
    <div className={tw("work-detail")} data-density={model.editions.length > 1 ? 'dense' : 'sparse'}>
      <header className={tw("work-detail__hero")}>
        <EditableBookCover book={book} onCover={onCover} />
        <div className={tw("work-detail__identity")}>
          <div className={tw("work-detail__eyebrow")}>
            <span>Work record</span>
            <StatusBadge icon={<HardDrive aria-hidden="true" />}>Saved locally</StatusBadge>
          </div>
          <h3>{model.title}</h3>
          <p>{model.authors.join(', ')}</p>
          <div className={tw("work-detail__work-state")}>
            <strong>{model.overallProgressLabel}</strong>
            <span>{model.identitySource}</span>
          </div>
        </div>
      </header>

      <p className={tw("work-detail__summary")}>{model.summary}</p>

      {libby}

      <section className={tw("edition-switcher")} aria-labelledby="edition-switcher-title">
        <header>
          <div>
            <span>Manifestations</span>
            <h4 id="edition-switcher-title">Choose an edition or access</h4>
          </div>
          <small>{model.editions.length} together · one Work history</small>
        </header>
        <div className={tw("edition-switcher__rail")} role="radiogroup" aria-label="Editions and formats">
          {model.editions.map((edition) => {
            const preferred = preferredEditionId === edition.id
            const separated = separatedEditionIds.includes(edition.id)
            return (
              <button
                type="button"
                role="radio"
                key={edition.id}
                aria-checked={selectedEdition.id === edition.id}
                className={tw(selectedEdition.id === edition.id ? 'is-selected' : '')}
                onClick={() => setSelectedEditionId(edition.id)}
              >
                <span className={tw("edition-switcher__icon")}>{editionIcons[edition.kind]}</span>
                <span>
                  <strong>{edition.shortLabel}</strong>
                  <small>{separated ? 'Separate Work' : edition.accessLabel}</small>
                </span>
                {preferred && <i aria-label="Preferred edition"><Check aria-hidden="true" /></i>}
              </button>
            )
          })}
        </div>
      </section>

      <nav className={tw("work-detail__tabs")} aria-label="Book detail sections" role="tablist">
        {detailSections.map((section) => (
          <button
            type="button"
            role="tab"
            key={section.id}
            id={`work-detail-tab-${section.id}`}
            aria-selected={activeSection === section.id}
            aria-controls={`work-detail-panel-${section.id}`}
            onClick={() => setActiveSection(section.id)}
          >
            {section.icon}
            <span>{section.label}</span>
          </button>
        ))}
      </nav>

      <div
        className={tw("work-detail__panel")}
        id={`work-detail-panel-${activeSection}`}
        role="tabpanel"
        aria-labelledby={`work-detail-tab-${activeSection}`}
      >
        {activeSection === 'overview' && (
          <EditionOverview
            book={book}
            edition={selectedEdition}
            preferred={preferredEditionId === selectedEdition.id}
            separated={separatedEditionIds.includes(selectedEdition.id)}
            onPrefer={() => openIdentityPreview('preferred')}
            onMetadata={onMetadata}
            onEnrich={onEnrich}
          />
        )}
        {activeSection === 'reading' && (
          <ReadingPanel model={model} selectedEdition={selectedEdition} book={book} onRead={onRead} onProgress={onProgress} onFinish={onFinish} />
        )}
        {activeSection === 'notes' && (
          <NotesPanel
            model={model}
            book={book}
            tags={tags}
            suggestions={tagSuggestions}
            onRate={onRate}
            onNotes={onNotes}
            onTags={onTags}
          />
        )}
        {activeSection === 'library' && (
          <LibraryPanel
            model={model}
            book={book}
            customShelves={customShelves}
            customShelfIds={customShelfIds}
            selectedEdition={selectedEdition}
            mergedRecord={mergedRecord}
            separated={separatedEditionIds.includes(selectedEdition.id)}
            undoAvailable={Boolean(identitySnapshot)}
            onMove={onMove}
            onCustomShelves={onCustomShelves}
            onPreviewIdentity={openIdentityPreview}
            onUndoIdentity={undoIdentityChange}
            onRemove={onRemove}
          />
        )}
      </div>

      {identityPreview && (
        <IdentityPreviewDialog
          impact={identityPreview}
          onCancel={() => setIdentityPreview(undefined)}
          onConfirm={applyIdentityChange}
        />
      )}

      <p className={tw("sr-only")} role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    </div>
  )
}

function SimpleBookDetail({
  book,
  libby,
  customShelves,
  customShelfIds,
  tags,
  tagSuggestions,
  onMove,
  onRead,
  onProgress,
  onFinish,
  onRate,
  onNotes,
  onMetadata,
  onCover,
  onCustomShelves,
  onTags,
  onRemove,
  onAttachEpub,
  onAttachAudiobook,
  epubBusy,
  epubImport,
  audiobookBusy,
  audiobookImport,
}: Omit<WorkDetailExperienceProps, 'onEnrich'>) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(book.title)
  const [author, setAuthor] = useState(book.authors.join(', '))
  const [pageCount, setPageCount] = useState(book.pageCount ? String(book.pageCount) : '')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [overwriteCover, setOverwriteCover] = useState(false)
  const hasReadableFile = ['EPUB', 'PDF', 'AUDIOBOOK'].includes(book.format?.toLocaleUpperCase() ?? '')
  const epubResult = epubImport.result?.bookId === book.id ? epubImport.result : undefined
  const audiobookResult = audiobookImport.result?.bookId === book.id ? audiobookImport.result : undefined

  const saveDetails = (event: FormEvent) => {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    onMetadata({
      title: cleanTitle,
      authors: author.split(/[;,]/).map((value) => value.trim()).filter(Boolean),
      pageCount: Number.parseInt(pageCount, 10) || 0,
    })
    setEditing(false)
  }

  return (
    <div className={tw('work-detail simple-book-detail')}>
      <header className={tw('work-detail__hero simple-book-detail__hero')}>
        <EditableBookCover book={book} onCover={onCover} />
        <div className={tw('work-detail__identity')}>
          <span className={tw('simple-book-detail__status')}>{SHELVES.find(({ id }) => id === book.shelf)?.label}</span>
          <h3>{book.title}</h3>
          <p>{book.authors.join(', ') || 'Unknown author'}</p>
          <div className={tw('work-detail__work-state')}>
            <strong>{book.startedAt || book.progress > 0 ? `${book.progress}% complete` : book.format ?? 'No file attached'}</strong>
          </div>
        </div>
      </header>

      <section className={tw('simple-attachments')} aria-labelledby="attach-file-title">
        <header>
          <div><span>Read or listen</span><h4 id="attach-file-title">Attach a file</h4></div>
          <small>It stays private on this device.</small>
        </header>
        <div className={tw('simple-attachments__actions')}>
          <label className={tw(epubBusy ? 'is-busy' : '')}>
            <FileText aria-hidden="true" />
            <span><strong>{epubBusy ? 'Attaching book…' : 'Attach book'}</strong><small>Choose an EPUB or PDF</small></span>
            <ChevronRight aria-hidden="true" />
            <OriginalFileInput
              kind="ebook"
              accept=".epub,.pdf,application/epub+zip,application/pdf"
              disabled={epubBusy}
              onFiles={(files) => onAttachEpub(files, overwriteCover)}
            />
          </label>
          <label className={tw(audiobookBusy ? 'is-busy' : '')}>
            <Headphones aria-hidden="true" />
            <span><strong>{audiobookBusy ? 'Attaching audio…' : 'Attach audiobook'}</strong><small>M4B or ordered MP3 files</small></span>
            <ChevronRight aria-hidden="true" />
            <OriginalFileInput
              kind="audio"
              accept=".m4b,.m4a,.mp4,.mp3,audio/mpeg,audio/mp4"
              multiple
              disabled={audiobookBusy}
              onFiles={(files) => onAttachAudiobook(files, overwriteCover)}
            />
          </label>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={overwriteCover} disabled={epubBusy || audiobookBusy}
            onChange={(event) => setOverwriteCover(event.target.checked)} />
          <span>Overwrite existing cover</span>
        </label>
        <p className="text-xs text-[var(--text-secondary)]">Use the file’s cover when available. Missing covers are filled automatically.</p>
        {(epubBusy || epubResult || epubImport.error) && (
          <AttachmentMessage
            busy={epubBusy}
            error={epubImport.error}
            complete={Boolean(epubResult)}
            detail={epubImport.error ?? epubImport.progress?.detail ?? (epubResult ? 'Book attached and ready to read.' : '')}
          />
        )}
        {(audiobookBusy || audiobookResult || audiobookImport.error) && (
          <AttachmentMessage
            busy={audiobookBusy}
            error={audiobookImport.error}
            complete={Boolean(audiobookResult)}
            detail={audiobookImport.error ?? audiobookImport.progress?.detail ?? (audiobookResult ? 'Audiobook attached and ready to listen.' : '')}
          />
        )}
      </section>

      <section className={tw('simple-reading-actions')} aria-label="Reading actions">
        {hasReadableFile && (
          <button type="button" className={tw('is-primary')} onClick={onRead}>
            {book.format?.toLocaleUpperCase() === 'AUDIOBOOK' ? <Headphones aria-hidden="true" /> : <BookOpen aria-hidden="true" />}
            {book.startedAt || book.progress > 0 ? 'Continue' : 'Start'}
          </button>
        )}
        <button type="button" onClick={onProgress}><Clock3 aria-hidden="true" /> Update progress</button>
        {book.shelf !== 'finished' && <button type="button" onClick={onFinish}><BookCheck aria-hidden="true" /> Mark finished</button>}
      </section>

      {libby}

      <section className={tw('simple-detail-section')} aria-labelledby="book-information-title">
        <header><div><span>Book information</span><h4 id="book-information-title">The essentials</h4></div></header>
        {editing ? (
          <form className={tw('simple-details-form')} onSubmit={saveDetails}>
            <label><span>Title</span><input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label><span>Author</span><input value={author} onChange={(event) => setAuthor(event.target.value)} /></label>
            <label><span>Pages</span><input type="number" min="0" value={pageCount} onChange={(event) => setPageCount(event.target.value)} /></label>
            <div><button type="button" onClick={() => setEditing(false)}>Cancel</button><button type="submit">Save</button></div>
          </form>
        ) : (
          <div className={tw('simple-facts')}>
            <dl>
              <div><dt>Format</dt><dd>{book.format ?? 'Not set'}</dd></div>
              <div><dt>Length</dt><dd>{book.pageCount ? `${book.pageCount} pages` : 'Not set'}</dd></div>
              <div><dt>ISBN</dt><dd>{book.identifiers?.[0] ?? 'Not set'}</dd></div>
            </dl>
            <button type="button" onClick={() => setEditing(true)}><Pencil aria-hidden="true" /> Edit details</button>
          </div>
        )}
      </section>

      <section className={tw('simple-detail-section')} aria-labelledby="reading-status-title">
        <header><div><span>Reading status</span><h4 id="reading-status-title">Where it belongs</h4></div></header>
        <div className={tw('simple-shelf-choices')}>
          {SHELVES.map((shelf) => (
            <button type="button" key={shelf.id} aria-pressed={shelf.id === book.shelf} onClick={() => onMove(shelf.id)}>
              {shelf.shortLabel}{shelf.id === book.shelf && <Check aria-hidden="true" />}
            </button>
          ))}
        </div>
        {customShelves.length > 0 && (
          <fieldset className={tw('simple-custom-shelves')}>
            <legend>Custom shelves</legend>
            {customShelves.map((shelf) => {
              const checked = customShelfIds.includes(shelf.id)
              return (
                <label key={shelf.id}>
                  <input type="checkbox" checked={checked} onChange={() => onCustomShelves(checked
                    ? customShelfIds.filter((id) => id !== shelf.id)
                    : [...customShelfIds, shelf.id])} />
                  <span>{shelf.name}</span>
                </label>
              )
            })}
          </fieldset>
        )}
      </section>

      <section className={tw('simple-detail-section simple-personal')} aria-labelledby="personal-title">
        <header><div><span>For you</span><h4 id="personal-title">Rating and notes</h4></div></header>
        <div className={tw('work-memory__rating')}><span>Rating</span><RatingStars value={book.rating} onChange={onRate} /></div>
        <label><span>Private note</span><textarea value={book.notes} onChange={(event) => onNotes(event.target.value)} rows={3} placeholder="What do you want to remember?" /></label>
        <WorkTagEditor tags={tags} suggestions={tagSuggestions} onChange={onTags} />
      </section>

      <section className={tw('remove-work')} aria-label="Remove from library">
        <button type="button" onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}>
          <Trash2 aria-hidden="true" />
          <span><strong>{confirmRemove ? 'Tap again to remove' : 'Remove from library'}</strong><small>Your attached files and library entry will be removed.</small></span>
          <ChevronRight aria-hidden="true" />
        </button>
      </section>
    </div>
  )
}

function AttachmentMessage({
  busy,
  error,
  complete,
  detail,
}: {
  readonly busy: boolean
  readonly error?: string
  readonly complete: boolean
  readonly detail: string
}) {
  return (
    <p className={tw(`simple-attachment-message${error ? ' is-error' : complete ? ' is-complete' : ''}`)} role={error ? 'alert' : 'status'}>
      {complete ? <Check aria-hidden="true" /> : busy ? <RefreshCw aria-hidden="true" /> : <X aria-hidden="true" />}
      <span>{detail}</span>
    </p>
  )
}

function EditionOverview({
  book,
  edition,
  preferred,
  separated,
  onPrefer,
  onMetadata,
  onEnrich,
}: {
  readonly book: LibraryBook
  readonly edition: WorkEditionDetail
  readonly preferred: boolean
  readonly separated: boolean
  readonly onPrefer: () => void
  readonly onMetadata: (changes: Partial<LibraryBook>) => void
  readonly onEnrich: () => Promise<boolean>
}) {
  const capture = book.capture ?? (book.id.startsWith('manual-') ? {
    method: 'manual-entry' as const,
    capturedAt: book.addedAt,
    manualOverrides: ['title'] as const,
  } : undefined)
  return (
    <div className={tw("edition-overview")} id="selected-edition-panel">
      <header className={tw("panel-heading")}>
        <div>
          <span>Selected edition · {edition.medium}</span>
          <h4>{edition.label}</h4>
        </div>
        <div className={tw("panel-heading__badges")}>
          {preferred && <StatusBadge icon={<Check aria-hidden="true" />}>Preferred</StatusBadge>}
          {separated && <StatusBadge tone="accent">Separate Work</StatusBadge>}
        </div>
      </header>

      <section className={tw(`edition-access is-${edition.availabilityTone}`)} aria-labelledby="edition-access-title">
        <span className={tw("edition-access__mark")} aria-hidden="true">
          {edition.availabilityTone === 'local' ? <HardDrive /> : edition.availabilityTone === 'record-only' ? <BookCopy /> : <WifiOff />}
        </span>
        <div>
          <span>Current access</span>
          <h5 id="edition-access-title">{edition.accessLabel}</h5>
          <p>{edition.accessDetail}</p>
        </div>
        <div className={tw("edition-access__progress")}>
          <strong>{edition.progress}%</strong>
          <small>{edition.progressLabel}</small>
        </div>
      </section>

      {capture && (
        <CaptureMetadataPanel
          book={book}
          capture={capture}
          onMetadata={onMetadata}
          onEnrich={onEnrich}
        />
      )}

      <div className={tw("edition-overview__split")}>
        <section className={tw("edition-facts")} aria-labelledby="edition-facts-title">
          <header><span>Edition facts, never Work facts</span><h5 id="edition-facts-title">Publication ledger</h5></header>
          <dl>
            {edition.facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd><strong>{fact.value}</strong><small>{fact.source}</small></dd>
              </div>
            ))}
          </dl>
        </section>

        <div className={tw("edition-assets-stack")}>
          <section className={tw("edition-asset")} aria-labelledby="edition-asset-title">
            <header><span>Current asset</span><h5 id="edition-asset-title">{edition.asset ? edition.asset.name : 'No readable asset'}</h5></header>
            {edition.asset ? (
              <dl>
                <div><dt>Format</dt><dd>{edition.asset.format}</dd></div>
                <div><dt>Location</dt><dd>{edition.asset.location}</dd></div>
                <div><dt>Status</dt><dd>{edition.asset.detail}</dd></div>
              </dl>
            ) : (
              <p>This edition is catalogued without a content file. Cover art and metadata remain available offline.</p>
            )}
          </section>

          {edition.loan && (
            <section className={tw("edition-loan")} aria-labelledby="edition-loan-title">
              <header><span>Loan state</span><h5 id="edition-loan-title">{edition.loan.due}</h5></header>
              <p><strong>{edition.loan.provider}</strong>{edition.loan.detail}</p>
            </section>
          )}

          <section className={tw("edition-provenance")} aria-labelledby="edition-provenance-title">
            <header><span>Source provenance</span><h5 id="edition-provenance-title">Why these facts appear</h5></header>
            <ul>
              {edition.sources.map((source) => <li key={source}><ShieldCheck aria-hidden="true" />{source}</li>)}
            </ul>
          </section>
        </div>
      </div>

      <button className={tw("edition-preference")} type="button" disabled={preferred} onClick={onPrefer}>
        <BookOpen aria-hidden="true" />
        <span><strong>{preferred ? 'Preferred edition' : 'Choose as preferred edition'}</strong><small>Controls the cover and default quick action for this Work</small></span>
        {preferred ? <Check aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
      </button>
    </div>
  )
}

function CaptureMetadataPanel({
  book,
  capture,
  onMetadata,
  onEnrich,
}: {
  readonly book: LibraryBook
  readonly capture: NonNullable<LibraryBook['capture']>
  readonly onMetadata: (changes: Partial<LibraryBook>) => void
  readonly onEnrich: () => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(book.title)
  const [author, setAuthor] = useState(book.authors.join(', '))
  const [pageCount, setPageCount] = useState(book.pageCount ? String(book.pageCount) : '')
  const [isbn, setIsbn] = useState(book.identifiers?.[0] ?? '')
  const [issue, setIssue] = useState<string>()
  const [enriching, setEnriching] = useState(false)

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    const inspection = inspectIsbnInput(isbn)
    if (isbn.trim() && inspection.state !== 'valid') {
      setIssue(inspection.state === 'invalid' ? inspection.message : 'Enter a valid ISBN.')
      return
    }
    onMetadata(applyManualBookEdits(book, {
      title,
      author,
      pageCount: Number.parseInt(pageCount, 10) || 0,
      isbn: inspection.state === 'valid' ? inspection.isbn : undefined,
    }))
    setIssue(undefined)
    setEditing(false)
  }

  const enrich = async () => {
    if (enriching) return
    setEnriching(true)
    setIssue(undefined)
    const enriched = await onEnrich()
    if (!enriched) setIssue('No saved or live catalog match was found. Your local details are unchanged.')
    setEnriching(false)
  }

  return (
    <section className={tw('capture-metadata')} aria-labelledby="capture-metadata-title">
      <header>
        <div>
          <span>Local capture · reader-owned fields win</span>
          <h5 id="capture-metadata-title">Personal record</h5>
        </div>
        <small>{capture.enrichedAt ? 'Enriched' : 'Awaiting enrichment'}</small>
      </header>
      {editing ? (
        <form className={tw('capture-metadata__form')} onSubmit={save}>
          <label><span>Title</span><input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label><span>Author</span><input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Unknown author" /></label>
          <label><span>ISBN</span><input value={isbn} onChange={(event) => setIsbn(event.target.value)} placeholder="978-…" inputMode="numeric" /></label>
          <label><span>Pages</span><input value={pageCount} onChange={(event) => setPageCount(event.target.value)} type="number" min="0" inputMode="numeric" /></label>
          {issue && <p role="alert">{issue}</p>}
          <div>
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit">Save local details</button>
          </div>
        </form>
      ) : (
        <>
          <p>
            {capture.manualOverrides.length
              ? `${capture.manualOverrides.length} local ${capture.manualOverrides.length === 1 ? 'field is' : 'fields are'} protected. Catalog updates fill only the gaps.`
              : 'Catalog details can refresh without changing your reading history or edition identity.'}
          </p>
          {issue && <p className={tw('capture-metadata__issue')} role="status">{issue}</p>}
          <div className={tw('capture-metadata__actions')}>
            <button type="button" onClick={() => setEditing(true)}><Pencil aria-hidden="true" /> Edit local details</button>
            <button type="button" onClick={() => { void enrich() }} disabled={enriching}>
              <RefreshCw aria-hidden="true" /> {enriching ? 'Checking catalogs…' : 'Enrich now'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function ReadingPanel({
  model,
  selectedEdition,
  book,
  onRead,
  onProgress,
  onFinish,
}: {
  readonly model: WorkDetailModel
  readonly selectedEdition: WorkEditionDetail
  readonly book: LibraryBook
  readonly onRead: () => void
  readonly onProgress: () => void
  readonly onFinish: () => void
}) {
  const editionNames = new Map(model.editions.map((edition) => [edition.id, edition.shortLabel]))

  return (
    <div className={tw("reading-panel")}>
      <section className={tw("reading-overview")} aria-labelledby="reading-overview-title">
        <div>
          <span>One Work history</span>
          <h4 id="reading-overview-title">{model.overallProgress}% complete</h4>
          <p>Sessions from print, files, audio, and loans appear once in the same chronology.</p>
        </div>
        <div className={tw("reading-overview__meter")} aria-label={`${model.overallProgress}% complete`}>
          <i><b style={{ width: `${model.overallProgress}%` }} /></i>
          <span><strong>{selectedEdition.shortLabel}</strong>{selectedEdition.progressLabel}</span>
        </div>
        <div className={tw("reading-overview__actions")}>
          {['EPUB', 'PDF'].includes(book.format?.toLocaleUpperCase() ?? '') && (
            <button type="button" onClick={onRead}><BookOpen aria-hidden="true" />{book.startedAt || book.progress > 0 ? 'Continue reading' : 'Start reading'}</button>
          )}
          {book.format?.toLocaleUpperCase() === 'AUDIOBOOK' && (
            <button type="button" onClick={onRead}><Headphones aria-hidden="true" />{book.startedAt || book.progress > 0 ? 'Continue listening' : 'Start listening'}</button>
          )}
          <button type="button" onClick={onProgress} disabled={book.shelf === 'finished'}>Update progress</button>
          {book.shelf !== 'finished' && <button type="button" onClick={onFinish}><BookCheck aria-hidden="true" /> Mark finished</button>}
        </div>
      </section>

      <section className={tw("reading-timeline")} aria-labelledby="reading-history-title">
        <header className={tw("panel-heading")}>
          <div><span>All manifestations</span><h4 id="reading-history-title">Reading history</h4></div>
          <small>{model.sessions.length} sessions</small>
        </header>
        {model.sessions.length ? (
          <ol>
            {model.sessions.map((session) => (
              <li key={session.id}>
                <span className={tw("reading-timeline__mark")} aria-hidden="true" />
                <div><strong>{session.when}</strong><small>{editionNames.get(session.editionId)} · {session.duration}</small></div>
                <span>{session.change}</span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyDetailState
            icon={<Clock3 aria-hidden="true" />}
            title="No reading sessions yet"
            copy="Starting any edition will add one event to this Work history."
          />
        )}
      </section>
    </div>
  )
}

function NotesPanel({
  model,
  book,
  tags,
  suggestions,
  onRate,
  onNotes,
  onTags,
}: {
  readonly model: WorkDetailModel
  readonly book: LibraryBook
  readonly tags: readonly string[]
  readonly suggestions: readonly string[]
  readonly onRate: (rating: number) => void
  readonly onNotes: (notes: string) => void
  readonly onTags: (tags: readonly string[]) => void
}) {
  const editionNames = new Map(model.editions.map((edition) => [edition.id, edition.shortLabel]))

  return (
    <div className={tw("notes-panel")}>
      <section className={tw("work-memory")} aria-labelledby="work-memory-title">
        <header><span>Work-level memory</span><h4 id="work-memory-title">Your private record</h4></header>
        <div className={tw("work-memory__rating")}><span>Rating</span><RatingStars value={book.rating} onChange={onRate} /></div>
        <label>
          <span>Private note</span>
          <textarea
            value={book.notes}
            onChange={(event) => onNotes(event.target.value)}
            placeholder="What do you want to remember about the Work?"
            rows={3}
          />
        </label>
        <WorkTagEditor tags={tags} suggestions={suggestions} onChange={onTags} />
      </section>

      <section className={tw("annotation-ledger")} aria-labelledby="annotation-ledger-title">
        <header className={tw("panel-heading")}>
          <div><span>Edition-located, Work-visible</span><h4 id="annotation-ledger-title">Annotations</h4></div>
          <small>{model.annotations.length} saved</small>
        </header>
        {model.annotations.length ? (
          <ol>
            {model.annotations.map((annotation) => (
              <li key={annotation.id}>
                <span><strong>{annotation.kind}</strong><small>{editionNames.get(annotation.editionId)} · {annotation.locator}</small></span>
                <p>{annotation.excerpt}</p>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyDetailState
            icon={<StickyNote aria-hidden="true" />}
            title="No annotations yet"
            copy="Highlights and bookmarks will keep their exact edition location here."
          />
        )}
      </section>
    </div>
  )
}

function LibraryPanel({
  model,
  book,
  customShelves,
  customShelfIds,
  selectedEdition,
  mergedRecord,
  separated,
  undoAvailable,
  onMove,
  onCustomShelves,
  onPreviewIdentity,
  onUndoIdentity,
  onRemove,
}: {
  readonly model: WorkDetailModel
  readonly book: LibraryBook
  readonly customShelves: readonly CustomShelf[]
  readonly customShelfIds: readonly string[]
  readonly selectedEdition: WorkEditionDetail
  readonly mergedRecord: boolean
  readonly separated: boolean
  readonly undoAvailable: boolean
  readonly onMove: (shelf: ShelfId) => void
  readonly onCustomShelves: (shelfIds: readonly string[]) => void
  readonly onPreviewIdentity: (kind: IdentityActionKind) => void
  readonly onUndoIdentity: () => void
  readonly onRemove: () => void
}) {
  const [showShelves, setShowShelves] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  return (
    <div className={tw("library-panel")}>
      <section className={tw("library-membership")} aria-labelledby="library-membership-title">
        <header><span>Lists and status</span><h4 id="library-membership-title">Where this Work lives</h4></header>
        <div className={tw("library-membership__status")}>
          <button type="button" onClick={() => setShowShelves((value) => !value)}>
            <FolderInput aria-hidden="true" />
            <span><strong>{SHELVES.find(({ id }) => id === book.shelf)?.label}</strong><small>Reading status applies to the Work</small></span>
            <ChevronRight className={tw(showShelves ? 'is-rotated' : '')} aria-hidden="true" />
          </button>
          {showShelves && (
            <div className={tw("library-membership__choices", motionStyles.reveal)} data-motion-event="reveal">
              {SHELVES.map((shelf) => (
                <button type="button" key={shelf.id} disabled={shelf.id === book.shelf} onClick={() => onMove(shelf.id)}>
                  {shelf.shortLabel}{shelf.id === book.shelf && <Check aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <fieldset>
          <legend>Custom shelves</legend>
          {customShelves.length ? customShelves.map((shelf) => {
            const checked = customShelfIds.includes(shelf.id)
            return (
              <label key={shelf.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onCustomShelves(checked
                    ? customShelfIds.filter((id) => id !== shelf.id)
                    : [...customShelfIds, shelf.id])}
                />
                <span>{shelf.name}</span>
                {shelf.pinned && <Pin aria-label="Pinned" />}
              </label>
            )
          }) : <p>No custom shelves yet. Reading status still stays independent.</p>}
        </fieldset>
      </section>

      <section className={tw("work-history")} aria-labelledby="work-history-title">
        <header className={tw("panel-heading")}>
          <div><span>Local journal</span><h4 id="work-history-title">Work history</h4></div>
          <small>Offline-first</small>
        </header>
        <ol>
          {model.history.map((event) => (
            <li key={event.id}><History aria-hidden="true" /><span><strong>{event.title}</strong><small>{event.when} · {event.detail}</small></span></li>
          ))}
        </ol>
      </section>

      <section className={tw("identity-actions")} aria-labelledby="identity-actions-title">
        <header>
          <div><span>Careful tools</span><h4 id="identity-actions-title">Work identity & editions</h4></div>
          <button type="button" onClick={onUndoIdentity} disabled={!undoAvailable}><RotateCcw aria-hidden="true" /> Undo</button>
        </header>
        <p>Every identity change previews what moves. Assets, loans, sources, progress, and annotations remain attached by Edition ID.</p>
        <div className={tw("identity-actions__state")}>
          <span>{selectedEdition.label}</span>
          <strong>{separated ? 'Split into a separate Work' : mergedRecord ? 'Imported record merged' : 'Belongs to this Work'}</strong>
        </div>
        <div className={tw("identity-actions__buttons")}>
          <button type="button" onClick={() => onPreviewIdentity('merge')} disabled={mergedRecord}>
            <GitMerge aria-hidden="true" /><span><strong>Merge another Work…</strong><small>Review a possible duplicate and its destination</small></span><ChevronRight aria-hidden="true" />
          </button>
          <button type="button" onClick={() => onPreviewIdentity('split')} disabled={separated || model.editions.length < 2}>
            <Scissors aria-hidden="true" /><span><strong>Split selected edition…</strong><small>Create a new Work without detaching its data</small></span><ChevronRight aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className={tw("remove-work")} aria-label="Remove from library">
        <button type="button" onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}>
          <Trash2 aria-hidden="true" />
          <span><strong>{confirmRemove ? 'Tap again to remove from library' : 'Remove from library'}</strong><small>Also removes this Work from every custom shelf</small></span>
          <ChevronRight aria-hidden="true" />
        </button>
      </section>
    </div>
  )
}

function WorkTagEditor({
  tags,
  suggestions,
  onChange,
}: {
  readonly tags: readonly string[]
  readonly suggestions: readonly string[]
  readonly onChange: (tags: readonly string[]) => void
}) {
  const [value, setValue] = useState('')

  const addTag = (event: FormEvent) => {
    event.preventDefault()
    const next = value.trim().replace(/\s+/g, ' ')
    if (!next || tags.includes(next)) return
    onChange([...tags, next])
    setValue('')
  }

  return (
    <div className={tw("work-tag-editor")}>
      <span>Tags</span>
      <div>
        {tags.map((tag) => (
          <button type="button" key={tag} onClick={() => onChange(tags.filter((item) => item !== tag))}>
            <Hash aria-hidden="true" />{tag}<X aria-hidden="true" />
          </button>
        ))}
        {!tags.length && <small>No tags yet</small>}
      </div>
      <form onSubmit={addTag}>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          list="work-detail-tag-suggestions"
          maxLength={40}
          placeholder="Add a tag"
          aria-label="New tag"
        />
        <datalist id="work-detail-tag-suggestions">
          {suggestions.map((suggestion) => <option value={suggestion} key={suggestion} />)}
        </datalist>
        <button type="submit" disabled={!value.trim()}>Add</button>
      </form>
    </div>
  )
}

function IdentityPreviewDialog({
  impact,
  onCancel,
  onConfirm,
}: {
  readonly impact: IdentityImpact
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true })
  }, [])

  return createPortal(
    <div className={tw("identity-preview-layer")}>
      <section
        className={tw("identity-preview")}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="identity-preview-title"
        tabIndex={-1}
      >
        <header>
          <span>{impact.eyebrow}</span>
          <h4 id="identity-preview-title">{impact.title}</h4>
          <p>{impact.explanation}</p>
        </header>
        <dl>
          {impact.counts.map((count) => (
            <div key={count.label}><dt>{count.label}</dt><dd><span>{count.before}</span><ChevronRight aria-hidden="true" /><strong>{count.after}</strong></dd></div>
          ))}
        </dl>
        <ul>
          {impact.assurances.map((assurance) => <li key={assurance}><ShieldCheck aria-hidden="true" />{assurance}</li>)}
        </ul>
        <div>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={onConfirm}>{impact.confirmLabel}</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

function EmptyDetailState({ icon, title, copy }: { readonly icon: ReactNode; readonly title: string; readonly copy: string }) {
  return (
    <div className={tw("detail-empty-state")}>
      <span>{icon}</span>
      <div><strong>{title}</strong><p>{copy}</p></div>
    </div>
  )
}
