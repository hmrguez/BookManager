import { useState, type DragEvent } from 'react'
import {
  Archive,
  AudioLines,
  BookPlus,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  FileUp,
  FolderOpen,
  History,
  Headphones,
  Library,
  Palette,
  RotateCcw,
  Search,
  ShieldCheck,
  Table2,
  Vibrate,
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
import type { SystemMediaPreferences } from '../playback'
import type { FeedbackPreferences } from '../feedback'
import { GOOGLE_BOOKS_KEY_CONFIGURED, appearanceLabels } from '../app/config'
import type { ExportFormat } from '../app/model'
import { tw } from '../tailwind/styles'
import { motionStyles } from '../tailwind/motion'
import type { EpubImportProgress, EpubImportResult } from '../epub'
import { AudiobookImportReviewPanel } from '../audiobooks/AudiobookImportReview'
import type {
  AudiobookImportDraft,
  AudiobookImportProgress,
  AudiobookImportResult,
  AudiobookImportReview,
} from '../audiobooks'
import type { RecoveryBackupPreview } from '../storage'
import { EpubStorageCard, type EpubStorageViewState } from './EpubStorageCard'
import { FEATURES } from '../app/feature-flags'

export type EpubImportViewState = {
  readonly progress?: EpubImportProgress
  readonly result?: EpubImportResult
  readonly error?: string
}

export type AudiobookImportViewState = {
  readonly progress?: AudiobookImportProgress
  readonly draft?: AudiobookImportDraft
  readonly result?: AudiobookImportResult
  readonly error?: string
}

export type RecoveryViewState = {
  readonly snapshots: readonly RecoveryBackupPreview[]
  readonly preview?: RecoveryBackupPreview
  readonly busy: boolean
  readonly error?: string
}

export function SettingsPage({
  books,
  appearance,
  searchPreferences,
  systemMediaPreferences,
  feedbackPreferences,
  importHistory,
  importBusy,
  importError,
  epubImport,
  epubBusy,
  epubStorage,
  audiobookImport,
  audiobookBusy,
  exportBusy,
  exportError,
  recovery,
  onBack,
  onAppearanceChange,
  onSearchPreferencesChange,
  onSystemMediaPreferencesChange,
  onFeedbackPreferencesChange,
  onManualAdd,
  onImportFile,
  onImportEpubFiles,
  onCancelEpubImport,
  onRefreshEpubStorage,
  onPreviewEpubCleanup,
  onConfirmEpubCleanup,
  onCancelEpubReview,
  onPreviewEpubRelink,
  onConfirmEpubRelink,
  onPrepareAudiobookFiles,
  onCommitAudiobook,
  onCancelAudiobookImport,
  onDismissAudiobookImport,
  onUndoImport,
  onExport,
  onRecoveryFile,
  onCreateRecoveryPoint,
  onRestoreBackup,
}: {
  books: LibraryBook[]
  appearance: AppearancePreferences
  searchPreferences: SearchPreferences
  systemMediaPreferences: SystemMediaPreferences
  feedbackPreferences: FeedbackPreferences
  importHistory: readonly ImportBatchSummary[]
  importBusy: boolean
  importError?: string
  epubImport: EpubImportViewState
  epubBusy: boolean
  epubStorage: EpubStorageViewState
  audiobookImport: AudiobookImportViewState
  audiobookBusy: boolean
  exportBusy: boolean
  exportError?: string
  recovery: RecoveryViewState
  onBack: () => void
  onAppearanceChange: (preferences: AppearancePreferences) => void
  onSearchPreferencesChange: (preferences: SearchPreferences) => void
  onSystemMediaPreferencesChange: (preferences: SystemMediaPreferences) => void
  onFeedbackPreferencesChange: (preferences: FeedbackPreferences) => void
  onManualAdd: () => void
  onImportFile: (file: File) => void
  onImportEpubFiles: (files: readonly File[]) => void
  onCancelEpubImport: () => void
  onRefreshEpubStorage: () => void
  onPreviewEpubCleanup: (assetIds?: readonly string[]) => void
  onConfirmEpubCleanup: () => void
  onCancelEpubReview: () => void
  onPreviewEpubRelink: (assetId: string, file: File) => void
  onConfirmEpubRelink: () => void
  onPrepareAudiobookFiles: (files: readonly File[]) => void
  onCommitAudiobook: (review: AudiobookImportReview) => void
  onCancelAudiobookImport: () => void
  onDismissAudiobookImport: () => void
  onUndoImport: (batchId: string) => void
  onExport: (format: ExportFormat, includeAnnotations: boolean, includeEpubFiles: boolean) => void
  onRecoveryFile: (file: File) => void
  onCreateRecoveryPoint: () => void
  onRestoreBackup: () => void
}) {
  const [includeExportAnnotations, setIncludeExportAnnotations] = useState(true)
  const [includeExportEpubFiles, setIncludeExportEpubFiles] = useState(false)
  const [epubDropActive, setEpubDropActive] = useState(false)
  const [audiobookDropActive, setAudiobookDropActive] = useState(false)
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

  const offerAudiobookFiles = (files: FileList | readonly File[]) => {
    const selected = Array.from(files)
    const hasAudio = selected.some((file) =>
      /\.(?:m4b|m4a|mp4|mp3)$/i.test(file.name) || file.type.startsWith('audio/'),
    )
    if (hasAudio) onPrepareAudiobookFiles(selected)
  }

  const handleAudiobookDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setAudiobookDropActive(false)
    if (!audiobookBusy) offerAudiobookFiles(event.dataTransfer.files)
  }

  return (
    <main className={tw('settings-page', motionStyles.navigate)} data-motion-event="navigate">
      <header className={tw('settings-header')}>
        <div className={tw('title-row')}>
          <h1 tabIndex={-1}>Settings</h1>
          <button className={tw('header-search')} type="button" onClick={onBack} aria-label="Back to my books">
            <Library aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={tw('settings-ledger')}>
        {FEATURES.advancedFileManagement && (
          <>
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

        <EpubStorageCard
          state={epubStorage}
          onRefresh={onRefreshEpubStorage}
          onPreviewCleanup={onPreviewEpubCleanup}
          onConfirmCleanup={onConfirmEpubCleanup}
          onCancelReview={onCancelEpubReview}
          onPreviewRelink={onPreviewEpubRelink}
          onConfirmRelink={onConfirmEpubRelink}
        />

        <section
          className={tw(`settings-card audiobook-intake${audiobookDropActive ? ' is-dragging' : ''}`)}
          onDragEnter={(event) => {
            event.preventDefault()
            if (!audiobookBusy) setAudiobookDropActive(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAudiobookDropActive(false)
          }}
          onDrop={handleAudiobookDrop}
        >
          <div className={tw('settings-card__icon')}><Headphones aria-hidden="true" /></div>
          <div className={tw('settings-card__heading')}>
            <span>Listening library</span><h2>Make one audiobook from its files.</h2>
            <p>M4B chapters or ordered MP3s become one private timeline. Covers, CUE sheets, tags, and revisions stay attached to the same edition.</p>
          </div>
          <label className={tw(`settings-action import-file-picker audiobook-picker${audiobookBusy ? ' is-busy' : ''}`)}>
            <AudioLines aria-hidden="true" />
            <span>
              <strong>{audiobookBusy ? 'Reading audio evidence…' : 'Choose audiobook files'}</strong>
              <small>M4B, MP3, CUE, JSON, and cover art</small>
            </span>
            <ChevronRight aria-hidden="true" />
            <input
              type="file"
              accept=".m4b,.m4a,.mp4,.mp3,.cue,.json,.jpg,.jpeg,.png,.gif,.webp,.avif,audio/mpeg,audio/mp4,image/jpeg,image/png,image/gif,image/webp,image/avif"
              multiple
              disabled={audiobookBusy}
              onChange={(event) => {
                if (event.currentTarget.files) offerAudiobookFiles(event.currentTarget.files)
                event.currentTarget.value = ''
              }}
            />
          </label>
          <label className={tw(`settings-action import-file-picker audiobook-folder-picker${audiobookBusy ? ' is-busy' : ''}`)}>
            <FolderOpen aria-hidden="true" />
            <span><strong>Choose an MP3 folder</strong><small>Keeps only supported audio and sidecar evidence</small></span>
            <ChevronRight aria-hidden="true" />
            <input
              ref={(node) => node?.setAttribute('webkitdirectory', '')}
              type="file"
              multiple
              disabled={audiobookBusy}
              onChange={(event) => {
                if (event.currentTarget.files) offerAudiobookFiles(event.currentTarget.files)
                event.currentTarget.value = ''
              }}
            />
          </label>
          <div className={tw('audiobook-drop-note')} aria-hidden="true">
            <span>Drop one M4B or one book folder here on the web.</span>
          </div>
          {(audiobookImport.progress || audiobookImport.result || audiobookImport.error) && !audiobookImport.draft && (
            <div
              className={tw(`audiobook-import-state${audiobookImport.error ? ' is-error' : audiobookImport.result ? ' is-complete' : ''}`)}
              role={audiobookImport.error ? 'alert' : 'status'}
              aria-live="polite"
            >
              {audiobookImport.error ? <X aria-hidden="true" /> : audiobookImport.result ? <CheckCircle2 aria-hidden="true" /> : <Headphones aria-hidden="true" />}
              <span>
                <strong>{audiobookImport.result?.title ?? audiobookImport.progress?.fileName ?? 'Audiobook import'}</strong>
                <small>
                  {audiobookImport.error
                    ?? (audiobookImport.result?.outcome === 'duplicate'
                      ? 'Already managed · no duplicate asset created'
                      : audiobookImport.result?.outcome === 'revision'
                        ? 'Revision linked · existing progress retained'
                        : audiobookImport.result
                          ? `${audiobookImport.result.manifest.segments.length} file timeline ready for playback`
                          : audiobookImport.progress?.detail)}
                </small>
              </span>
              {audiobookBusy && <button type="button" onClick={onCancelAudiobookImport}>Cancel</button>}
            </div>
          )}
          {audiobookImport.draft && (
            <AudiobookImportReviewPanel
              key={audiobookImport.draft.inspectionId}
              draft={audiobookImport.draft}
              busy={audiobookBusy}
              onImport={onCommitAudiobook}
              onDismiss={onDismissAudiobookImport}
            />
          )}
        </section>
          </>
        )}

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
              Reduced turns off shelf and other optional animations while keeping status, focus, and feedback intact.
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

        <section className={tw('settings-card')}>
          <div className={tw('settings-card__icon')}><Vibrate aria-hidden="true" /></div>
          <div className={tw('settings-card__heading')}>
            <span>Touch & sound</span><h2>Let the paper answer.</h2>
            <p>Brief native taps reinforce meaning. Optional graphite, eraser, and page sounds remain deliberately quiet.</p>
          </div>
          <button
            className={tw('texture-toggle')}
            type="button"
            aria-pressed={feedbackPreferences.haptics === 'system'}
            onClick={() => onFeedbackPreferencesChange({
              ...feedbackPreferences,
              haptics: feedbackPreferences.haptics === 'system' ? 'off' : 'system',
            })}
          >
            <span>
              <strong>System haptics</strong>
              <small>Uses the device’s native touch language and follows its feedback settings.</small>
            </span>
            <i aria-hidden="true" />
          </button>
          <button
            className={tw('texture-toggle')}
            type="button"
            aria-pressed={feedbackPreferences.sound === 'quiet'}
            onClick={() => onFeedbackPreferencesChange({
              ...feedbackPreferences,
              sound: feedbackPreferences.sound === 'quiet' ? 'off' : 'quiet',
            })}
          >
            <span>
              <strong>Paper sounds</strong>
              <small>Off by default · uses device volume · stays silent around audiobooks and assistive reading.</small>
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
          <button
            className={tw('texture-toggle search-notes-toggle')}
            type="button"
            aria-label="Show book details on the lock screen"
            aria-pressed={systemMediaPreferences.showBookDetailsWhenLocked}
            onClick={() => onSystemMediaPreferencesChange({
              showBookDetailsWhenLocked: !systemMediaPreferences.showBookDetailsWhenLocked,
            })}
          >
            <span>
              <strong>Show book details when locked</strong>
              <small>
                {systemMediaPreferences.showBookDetailsWhenLocked
                  ? 'Title, author, chapter, and cover appear on trusted system media surfaces.'
                  : 'Wovenleaf hides the book identity and cover; playback controls remain available.'}
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
              <span>{includeExportEpubFiles ? 'Audiobook, cover, and supplement files' : 'Cover, ebook, and audiobook files'}</span>
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

          <button
            className={tw('export-annotation-toggle export-epub-toggle')}
            type="button"
            aria-pressed={includeExportEpubFiles}
            onClick={() => setIncludeExportEpubFiles((value) => !value)}
          >
            <span>
              <strong>DRM-free EPUB files</strong>
              <small>
                {includeExportEpubFiles
                  ? `${epubStorage.inventory?.items.filter(({ active, state }) => active && state === 'available').length ?? 0} verified current copies will be embedded; the archive may contain copyrighted book files.`
                  : 'Excluded by default; library metadata, progress, highlights, and notes still remain restorable.'}
              </small>
            </span>
            <i aria-hidden="true" />
          </button>

          <div className={tw('export-actions')}>
            <button
              className={tw('export-action export-action--primary')}
              type="button"
              disabled={exportBusy}
              onClick={() => onExport('archive', includeExportAnnotations, includeExportEpubFiles)}
            >
              <Archive aria-hidden="true" />
              <span><strong>{exportBusy ? 'Building locally…' : 'Portable JSON archive'}</strong><small>Lossless structure · verified restore</small></span>
              <Download aria-hidden="true" />
            </button>
            <button className={tw('export-action')} type="button" disabled={exportBusy} onClick={() => onExport('csv', includeExportAnnotations, false)}>
              <Table2 aria-hidden="true" />
              <span><strong>Readable CSV</strong><small>Lossy table · not restorable</small></span>
              <Download aria-hidden="true" />
            </button>
            <button className={tw('export-action')} type="button" disabled={exportBusy} onClick={() => onExport('markdown', includeExportAnnotations, false)}>
              <FileText aria-hidden="true" />
              <span><strong>Reading journal</strong><small>Lossy Markdown · not restorable</small></span>
              <Download aria-hidden="true" />
            </button>
          </div>
          {exportError && <p className={tw('settings-hint settings-hint--error export-error')} role="alert">{exportError}</p>}
        </section>

        <section className={tw('settings-card settings-card--recovery')}>
          <div className={tw('settings-card__icon')}><RotateCcw aria-hidden="true" /></div>
          <div className={tw('settings-card__heading')}>
            <span>Backup & restore · Three-point rotation</span><h2>A quiet return point.</h2>
            <p>Wovenleaf checks the whole backup in a separate staging area, keeps the current library as rollback, and only then swaps the catalog. Local recovery points keep history and notes, but never EPUB bytes.</p>
          </div>

          {recovery.snapshots.length > 0 && (
            <div className={tw('recovery-points')} role="region" aria-label="Local recovery points">
              <div className={tw('recovery-points__heading')}>
                <History aria-hidden="true" /><span>Local recovery points</span><strong>{recovery.snapshots.length} / 3</strong>
              </div>
              {recovery.snapshots.slice(0, 3).map((snapshot) => (
                <div className={tw('recovery-point')} key={snapshot.artifactId}>
                  <span>
                    <strong>{formatBackupDate(snapshot.createdAt)}</strong>
                    <small>Contract {snapshot.formatVersion ?? '—'} · Schema {snapshot.schemaVersion ?? '—'} · {formatBackupSize(snapshot.byteSize)}</small>
                  </span>
                  <span className={tw(`recovery-validation is-${snapshot.validation.status}`)}>
                    {snapshot.validation.status === 'invalid' ? 'Needs attention' : 'Verified'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className={tw('recovery-actions')}>
            <label className={tw(`settings-action import-file-picker recovery-picker${recovery.busy ? ' is-busy' : ''}`)}>
              <FileUp aria-hidden="true" />
              <span><strong>{recovery.busy ? 'Checking in staging…' : 'Choose a Wovenleaf backup'}</strong><small>Nothing is replaced during preview</small></span>
              <ChevronRight aria-hidden="true" />
              <input
                type="file"
                accept=".json,.wovenleaf.json,application/json"
                disabled={recovery.busy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  if (file) onRecoveryFile(file)
                  event.currentTarget.value = ''
                }}
              />
            </label>
            <button className={tw('settings-action recovery-save')} type="button" disabled={recovery.busy} onClick={onCreateRecoveryPoint}>
              <Archive aria-hidden="true" />
              <span><strong>Save a recovery point now</strong><small>Private local rotation · oldest point retires first</small></span>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>

          {recovery.preview && (
            <div
              className={tw(`recovery-preview is-${recovery.preview.validation.status}`)}
              role={recovery.preview.validation.status === 'invalid' ? 'alert' : 'status'}
              aria-live="polite"
            >
              <div className={tw('recovery-preview__mark')}>
                {recovery.preview.validation.status === 'invalid' ? <X aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
              </div>
              <div className={tw('recovery-preview__title')}>
                <span>Restore preview</span>
                <strong>{recovery.preview.validation.status === 'invalid' ? 'This backup stays outside your library.' : 'Ready for an atomic restore.'}</strong>
                <small>{recovery.preview.validation.message}</small>
              </div>
              <dl className={tw('recovery-preview__ledger')}>
                <div><dt>Backup date</dt><dd>{formatBackupDate(recovery.preview.createdAt)}</dd></div>
                <div><dt>Version</dt><dd>Contract {recovery.preview.formatVersion ?? '—'} · Schema {recovery.preview.schemaVersion ?? '—'}</dd></div>
                <div><dt>Size</dt><dd>{formatBackupSize(recovery.preview.byteSize)}</dd></div>
                <div><dt>Included assets</dt><dd>{recovery.preview.includedAssetCount} files · {recovery.preview.relinkAssetCount} to relink</dd></div>
                <div><dt>Library</dt><dd>{recovery.preview.bookCount ?? '—'} books</dd></div>
                <div><dt>Validation</dt><dd>{recovery.preview.validation.status === 'warning' ? 'Valid with review' : recovery.preview.validation.status}</dd></div>
              </dl>
              {recovery.preview.canRestore && (
                <button className={tw('recovery-restore')} type="button" disabled={recovery.busy} onClick={onRestoreBackup}>
                  <RotateCcw aria-hidden="true" />
                  {recovery.preview.validation.code === 'stale' ? 'Restore this older backup' : 'Restore this backup'}
                </button>
              )}
            </div>
          )}
          {recovery.error && <p className={tw('settings-hint settings-hint--error recovery-error')} role="alert">{recovery.error}</p>}
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

function formatBackupDate(value?: string): string {
  if (!value) return 'Unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unavailable'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatBackupSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${Math.ceil(bytes / 1_024)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}
