import { useState, type DragEvent } from 'react'
import {
  Archive,
  BookPlus,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  FileUp,
  FolderOpen,
  History,
  Library,
  Palette,
  Search,
  ShieldCheck,
  Table2,
  X,
} from 'lucide-react'
import {
  CONTRAST_MODES,
  MOTION_MODES,
  PAPER_MODES,
  TYPE_SCALES,
  type AppearancePreferences,
} from '../design-system'
import type { ImportBatchSummary } from '../imports'
import type { LibraryBook } from '../library'
import type { SearchPreferences } from '../search'
import { GOOGLE_BOOKS_KEY_CONFIGURED, appearanceLabels } from '../app/config'
import type { ExportFormat } from '../app/model'
import { tw } from '../tailwind/styles'
import { motionStyles } from '../tailwind/motion'
import type { EpubImportProgress, EpubImportResult } from '../epub'

export type EpubImportViewState = {
  readonly progress?: EpubImportProgress
  readonly result?: EpubImportResult
  readonly error?: string
}

export function SettingsPage({
  books,
  appearance,
  searchPreferences,
  importHistory,
  importBusy,
  importError,
  epubImport,
  epubBusy,
  exportBusy,
  exportError,
  onBack,
  onAppearanceChange,
  onSearchPreferencesChange,
  onManualAdd,
  onImportFile,
  onImportEpubFiles,
  onCancelEpubImport,
  onUndoImport,
  onExport,
}: {
  books: LibraryBook[]
  appearance: AppearancePreferences
  searchPreferences: SearchPreferences
  importHistory: readonly ImportBatchSummary[]
  importBusy: boolean
  importError?: string
  epubImport: EpubImportViewState
  epubBusy: boolean
  exportBusy: boolean
  exportError?: string
  onBack: () => void
  onAppearanceChange: (preferences: AppearancePreferences) => void
  onSearchPreferencesChange: (preferences: SearchPreferences) => void
  onManualAdd: () => void
  onImportFile: (file: File) => void
  onImportEpubFiles: (files: readonly File[]) => void
  onCancelEpubImport: () => void
  onUndoImport: (batchId: string) => void
  onExport: (format: ExportFormat, includeAnnotations: boolean) => void
}) {
  const [includeExportAnnotations, setIncludeExportAnnotations] = useState(true)
  const [epubDropActive, setEpubDropActive] = useState(false)
  const ratedBooks = books.filter((book) => book.rating > 0).length
  const notedBooks = books.filter((book) => book.notes.trim()).length

  const offerEpubFiles = (files: FileList | readonly File[]) => {
    const epubs = Array.from(files).filter((file) =>
      file.name.toLocaleLowerCase().endsWith('.epub') || file.type === 'application/epub+zip',
    )
    if (epubs.length > 0) onImportEpubFiles(epubs)
  }

  const handleEpubDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setEpubDropActive(false)
    if (!epubBusy) offerEpubFiles(event.dataTransfer.files)
  }

  return (
    <main className={tw('settings-page', motionStyles.navigate)} data-motion-event="navigate">
      <header className={tw('settings-header')}>
        <div className={tw('app-header__meta')}>
          <span>Wovenleaf</span><i aria-hidden="true" /><span>Local preferences</span>
        </div>
        <div className={tw('title-row')}>
          <div><p>Quiet controls for a private library</p><h1 tabIndex={-1}>Settings</h1></div>
          <button className={tw('header-search')} type="button" onClick={onBack} aria-label="Back to my books">
            <Library aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={tw('settings-ledger')}>
        <section
          className={tw(`settings-card epub-intake${epubDropActive ? ' is-dragging' : ''}`)}
          onDragEnter={(event) => {
            event.preventDefault()
            if (!epubBusy) setEpubDropActive(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEpubDropActive(false)
          }}
          onDrop={handleEpubDrop}
        >
          <div className={tw('settings-card__icon')}><BookOpen aria-hidden="true" /></div>
          <div className={tw('settings-card__heading')}>
            <span>Books on this device</span><h2>Bring in a DRM-free EPUB.</h2>
            <p>The original package is checked offline, fingerprinted, and copied into private managed storage before it joins your library.</p>
          </div>
          <label className={tw(`settings-action import-file-picker epub-picker${epubBusy ? ' is-busy' : ''}`)}>
            <FileUp aria-hidden="true" />
            <span>
              <strong>{epubBusy ? 'Checking the package…' : 'Choose EPUB files'}</strong>
              <small>Native file picker · EPUB 2 and EPUB 3</small>
            </span>
            <ChevronRight aria-hidden="true" />
            <input
              type="file"
              accept=".epub,application/epub+zip"
              multiple
              disabled={epubBusy}
              onChange={(event) => {
                if (event.currentTarget.files) offerEpubFiles(event.currentTarget.files)
                event.currentTarget.value = ''
              }}
            />
          </label>
          <label className={tw(`settings-action import-file-picker epub-folder-picker${epubBusy ? ' is-busy' : ''}`)}>
            <FolderOpen aria-hidden="true" />
            <span><strong>Choose a folder</strong><small>Imports only the EPUB files inside · where supported</small></span>
            <ChevronRight aria-hidden="true" />
            <input
              ref={(node) => node?.setAttribute('webkitdirectory', '')}
              type="file"
              accept=".epub,application/epub+zip"
              multiple
              disabled={epubBusy}
              onChange={(event) => {
                if (event.currentTarget.files) offerEpubFiles(event.currentTarget.files)
                event.currentTarget.value = ''
              }}
            />
          </label>
          <div className={tw('epub-drop-note')} aria-hidden="true">
            <span>On the web, you can also drop EPUB files here.</span>
          </div>
          {(epubImport.progress || epubImport.result || epubImport.error) && (
            <div
              className={tw(`epub-import-state${epubImport.error ? ' is-error' : epubImport.result ? ' is-complete' : ''}`)}
              role={epubImport.error ? 'alert' : 'status'}
              aria-live="polite"
            >
              {epubImport.error ? <X aria-hidden="true" /> : epubImport.result ? <CheckCircle2 aria-hidden="true" /> : <BookOpen aria-hidden="true" />}
              <span>
                <strong>{epubImport.result?.title ?? epubImport.progress?.fileName ?? 'EPUB import'}</strong>
                <small>
                  {epubImport.error
                    ?? (epubImport.result?.outcome === 'duplicate'
                      ? 'Already in managed storage · no duplicate asset created'
                      : epubImport.result?.outcome === 'revision'
                        ? 'Revised package linked to the existing edition'
                        : epubImport.result
                          ? 'Validated, fingerprinted, and stored with provenance'
                          : epubImport.progress?.detail)}
                </small>
              </span>
              {epubBusy && <button type="button" onClick={onCancelEpubImport}>Cancel</button>}
            </div>
          )}
        </section>

        <section className={tw('settings-card settings-card--appearance')}>
          <div className={tw('settings-card__icon')}><Palette aria-hidden="true" /></div>
          <div className={tw('settings-card__heading')}>
            <span>Reading room</span><h2>Paper, contrast, and type</h2>
            <p>Choose the atmosphere without changing the hierarchy or hiding state.</p>
          </div>

          <fieldset className={tw('appearance-field appearance-field--paper')}>
            <legend>Paper stock</legend>
            <div className={tw('appearance-options')}>
              {PAPER_MODES.map((mode) => (
                <button
                  className={tw('appearance-option appearance-option--paper')}
                  data-paper={mode}
                  type="button"
                  key={mode}
                  aria-pressed={appearance.paperMode === mode}
                  onClick={() => onAppearanceChange({ ...appearance, paperMode: mode })}
                >
                  <i aria-hidden="true" /><span>{appearanceLabels.paperMode[mode]}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={tw('appearance-field')}>
            <legend>Contrast</legend>
            <div className={tw('appearance-options appearance-options--compact')}>
              {CONTRAST_MODES.map((contrast) => (
                <button
                  className={tw('appearance-option')}
                  type="button"
                  key={contrast}
                  aria-pressed={appearance.contrast === contrast}
                  onClick={() => onAppearanceChange({ ...appearance, contrast })}
                >
                  {appearanceLabels.contrast[contrast]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={tw('appearance-field')}>
            <legend>Motion</legend>
            <div className={tw('appearance-options appearance-options--motion')}>
              {MOTION_MODES.map((motion) => (
                <button
                  className={tw('appearance-option')}
                  type="button"
                  key={motion}
                  aria-pressed={appearance.motion === motion}
                  onClick={() => onAppearanceChange({ ...appearance, motion })}
                >
                  {appearanceLabels.motion[motion]}
                </button>
              ))}
            </div>
            <small className={tw('appearance-field__hint')}>
              Reduced is a global test mode: hierarchy, status, focus, and feedback stay intact.
            </small>
          </fieldset>

          <fieldset className={tw('appearance-field')}>
            <legend>Type scale</legend>
            <div className={tw('appearance-options appearance-options--compact')}>
              {TYPE_SCALES.map((typeScale) => (
                <button
                  className={tw('appearance-option')}
                  type="button"
                  key={typeScale}
                  aria-pressed={appearance.typeScale === typeScale}
                  onClick={() => onAppearanceChange({ ...appearance, typeScale })}
                >
                  {appearanceLabels.typeScale[typeScale]}
                </button>
              ))}
            </div>
          </fieldset>

          <button
            className={tw('texture-toggle')}
            type="button"
            aria-pressed={appearance.texture === 'quiet'}
            onClick={() => onAppearanceChange({
              ...appearance,
              texture: appearance.texture === 'quiet' ? 'off' : 'quiet',
            })}
          >
            <span>
              <strong>Paper fiber</strong>
              <small>One static procedural layer; automatically removed for contrast and transparency preferences.</small>
            </span>
            <i aria-hidden="true" />
          </button>
        </section>

        <section className={tw('settings-card settings-card--privacy')}>
          <div className={tw('settings-card__icon')}><ShieldCheck aria-hidden="true" /></div>
          <div className={tw('settings-card__heading')}>
            <span>Data & privacy</span><h2>Your reading life stays here.</h2>
            <p>There is no account, analytics layer, community profile, or cloud sync.</p>
          </div>
          <dl className={tw('library-tally')}>
            <div><dt>Books</dt><dd>{books.length}</dd></div>
            <div><dt>Rated</dt><dd>{ratedBooks}</dd></div>
            <div><dt>With notes</dt><dd>{notedBooks}</dd></div>
          </dl>
          <button
            className={tw('texture-toggle search-notes-toggle')}
            type="button"
            aria-pressed={searchPreferences.includePrivateNotes}
            onClick={() => onSearchPreferencesChange({
              includePrivateNotes: !searchPreferences.includePrivateNotes,
            })}
          >
            <span>
              <strong>Search private notes</strong>
              <small>
                {searchPreferences.includePrivateNotes
                  ? 'Note text can surface a book in local search.'
                  : 'Off by default; titles and library metadata remain searchable.'}
              </small>
            </span>
            <i aria-hidden="true" />
          </button>
        </section>

        <section className={tw('settings-card settings-card--export')}>
          <div className={tw('settings-card__icon')}><Archive aria-hidden="true" /></div>
          <div className={tw('settings-card__heading')}>
            <span>Portable export · Contract v1</span><h2>Your library, with a way home.</h2>
            <p>Built entirely on this device. Review the manifest below before saving or sharing anything.</p>
          </div>

          <div className={tw('export-manifest')} aria-label="Portable export contents">
            <div>
              <strong>Inside the archive</strong>
              <span>Catalog records and relationships</span>
              <span>Shelves, progress, dates, and ratings</span>
              <span>Checksums plus readable CSV and Markdown views</span>
            </div>
            <div>
              <strong>Always left behind</strong>
              <span>Passwords, API keys, and secure credentials</span>
              <span>Database cache and import staging</span>
              <span>Cover, ebook, and audiobook files</span>
            </div>
          </div>

          <button
            className={tw('export-annotation-toggle')}
            type="button"
            aria-pressed={includeExportAnnotations}
            onClick={() => setIncludeExportAnnotations((value) => !value)}
          >
            <span>
              <strong>Private notes and ratings</strong>
              <small>{includeExportAnnotations ? 'Included in canonical and readable files' : 'Redacted from every exported file'}</small>
            </span>
            <i aria-hidden="true" />
          </button>

          <div className={tw('export-actions')}>
            <button
              className={tw('export-action export-action--primary')}
              type="button"
              disabled={exportBusy}
              onClick={() => onExport('archive', includeExportAnnotations)}
            >
              <Archive aria-hidden="true" />
              <span><strong>{exportBusy ? 'Building locally…' : 'Portable JSON archive'}</strong><small>Lossless structure · verified restore</small></span>
              <Download aria-hidden="true" />
            </button>
            <button className={tw('export-action')} type="button" disabled={exportBusy} onClick={() => onExport('csv', includeExportAnnotations)}>
              <Table2 aria-hidden="true" />
              <span><strong>Readable CSV</strong><small>Lossy table · not restorable</small></span>
              <Download aria-hidden="true" />
            </button>
            <button className={tw('export-action')} type="button" disabled={exportBusy} onClick={() => onExport('markdown', includeExportAnnotations)}>
              <FileText aria-hidden="true" />
              <span><strong>Reading journal</strong><small>Lossy Markdown · not restorable</small></span>
              <Download aria-hidden="true" />
            </button>
          </div>
          {exportError && <p className={tw('settings-hint settings-hint--error export-error')} role="alert">{exportError}</p>}
        </section>

        <section className={tw('settings-card settings-card--import')}>
          <div className={tw('settings-card__icon')}><FileUp aria-hidden="true" /></div>
          <div className={tw('settings-card__heading')}>
            <span>Import & recovery</span><h2>Preview every row before it lands.</h2>
            <p>Use a Wovenleaf CSV now. Matching, changes, validation errors, and file permissions stay visible until you commit.</p>
          </div>
          <label className={tw(`settings-action import-file-picker${importBusy ? ' is-busy' : ''}`)}>
            <FileUp aria-hidden="true" />
            <span><strong>{importBusy ? 'Preparing preview…' : 'Choose a CSV file'}</strong><small>Parsed locally · no network access</small></span>
            <ChevronRight aria-hidden="true" />
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importBusy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) onImportFile(file)
                event.currentTarget.value = ''
              }}
            />
          </label>
          {importError && <p className={tw('settings-hint settings-hint--error')} role="alert">{importError}</p>}
          {importHistory.length > 0 && (
            <div className={tw('import-history')} aria-label="Recent import batches">
              <div className={tw('import-history__heading')}><History aria-hidden="true" /><span>Recent checkpoints</span></div>
              {importHistory.slice(0, 3).map((batch) => (
                <div className={tw('import-history__row')} key={batch.id}>
                  <span><strong>{batch.fileName}</strong><small>{batch.appliedRows} rows · {batch.changeCount} changes</small></span>
                  <span className={tw(`import-history__status is-${batch.status}`)}>{batch.status}</span>
                  {batch.status === 'committed' && <button type="button" onClick={() => onUndoImport(batch.id)}>Undo</button>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={tw('settings-card')}>
          <div className={tw('settings-card__icon')}><Search aria-hidden="true" /></div>
          <div className={tw('settings-card__heading')}>
            <span>Book search</span><h2>Open Library + Google Books</h2>
            <p>Open Library is the primary catalog. Google Books can broaden a search when a restricted API key is configured.</p>
          </div>
          <div className={tw('settings-status-row')}>
            <span>Open Library</span>
            <strong className={tw('is-ready')}>Primary · no key</strong>
          </div>
          <div className={tw('settings-status-row')}>
            <span>Google Books fallback</span>
            <strong className={tw(GOOGLE_BOOKS_KEY_CONFIGURED ? 'is-ready' : 'is-warning')}>
              {GOOGLE_BOOKS_KEY_CONFIGURED ? 'Configured' : 'Not configured'}
            </strong>
          </div>
          {!GOOGLE_BOOKS_KEY_CONFIGURED && (
            <p className={tw('settings-hint')}>
              Add a restricted <code>VITE_GOOGLE_BOOKS_API_KEY</code> to <code>.env.local</code> to enable the optional fallback.
            </p>
          )}
        </section>

        <section className={tw('settings-card')}>
          <div className={tw('settings-card__icon')}><BookPlus aria-hidden="true" /></div>
          <div className={tw('settings-card__heading')}>
            <span>Local catalog</span><h2>Manual book entry</h2>
            <p>Add a personal record when a catalog has no match or the device is offline.</p>
          </div>
          <button className={tw('settings-action')} type="button" onClick={onManualAdd}>
            <BookPlus aria-hidden="true" />
            <span><strong>Add a book manually</strong><small>Always available on this device</small></span>
            <ChevronRight aria-hidden="true" />
          </button>
        </section>
      </div>
    </main>
  )
}
