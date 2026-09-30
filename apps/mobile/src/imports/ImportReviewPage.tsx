import { LocalizedError } from '../localization/LocalizedError'
import { t, formatNumber, getLocale, useLanguage } from '../localization'
import { useWideLayout } from '../responsive/useWideLayout'
import { useMemo, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { LibraryBook } from '../library-model'
import type { ImportProgress } from '../storage/import-repository'
import { importedLibraryBookId, planLibraryBookCommit } from './commit-rules'
import type { ImportPreview, ImportProposal, ImportReviewDecision } from './model'
import { tw } from '../tailwind/styles'
import './import-review.css'

const PAGE_SIZE = 100
const proposalCopy = {
  get add() { return t("New") }, get update() { return t("Update") }, get conflict() { return t("Review") }, get skip() { return t("Unchanged") }, get error() { return t("Needs attention") },
} as const

type Filter = 'all' | 'attention' | 'add' | 'update' | 'skip'

export function ImportReviewPage({ preview, books, busy, progress, error, onBack, onCommit }: {
  preview: ImportPreview
  books: readonly LibraryBook[]
  busy: boolean
  progress?: ImportProgress
  error?: string
  onBack: () => void
  onCommit: (decisions: readonly ImportReviewDecision[]) => Promise<void>
}) {
  useLanguage()
  const wideLayout = useWideLayout()
  const [overrides, setOverrides] = useState<Record<string, ImportReviewDecision>>({})
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(0)
  const [expandedId, setExpandedId] = useState<string>()
  const booksById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])
  const preparing = progress?.stage === 'preparing'
  const committing = progress?.stage === 'committing' && busy
  const complete = progress?.stage === 'complete'
  const decisionFor = (proposal: ImportProposal): ImportReviewDecision => overrides[proposal.id] ?? {
    rowId: proposal.id,
    included: proposal.defaultIncluded,
    targetId: proposal.targetId,
    targetUpdatedAt: proposal.targetId ? booksById.get(proposal.targetId)?.lastUpdatedAt : undefined,
  }
  const needsAttention = (proposal: ImportProposal) =>
    proposal.kind === 'error' || proposal.kind === 'conflict' || proposal.match.confidence === 'low'
  const visible = preview.proposals.filter((proposal) =>
    filter === 'all' || (filter === 'attention' ? needsAttention(proposal) : proposal.kind === filter),
  )
  const included = preview.proposals.filter((proposal) => decisionFor(proposal).included)
  const unresolved = included.filter((proposal) => proposal.kind === 'error' || !decisionFor(proposal).targetId)
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const rows = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const progressPercent = progress?.total ? Math.min(100, progress.completed / progress.total * 100) : 0
  const counts: Record<Filter, number> = {
    all: preview.proposals.length,
    attention: preview.proposals.filter(needsAttention).length,
    add: preview.proposals.filter(({ kind }) => kind === 'add').length,
    update: preview.proposals.filter(({ kind }) => kind === 'update').length,
    skip: preview.proposals.filter(({ kind }) => kind === 'skip').length,
  }
  const labels: Record<Filter, string> = { all: 'All books', attention: 'Needs review', add: 'New', update: 'Updates', skip: 'Unchanged' }
  const changeDecision = (proposal: ImportProposal, patch: Partial<ImportReviewDecision>) => {
    setOverrides((current) => ({ ...current, [proposal.id]: { ...decisionFor(proposal), ...patch } }))
  }

  return (
    <main data-wide={wideLayout || undefined} className="import-review import-compact" aria-busy={busy}>
      <header className="import-heading">
        <button type="button" className="import-back" onClick={onBack} disabled={busy} aria-label={complete ? t("View library") : t("Back to settings")}><ArrowLeft /></button>
        <div>
          <span className="import-eyebrow">{preview.source.key === 'goodreads-csv' ? t("From Goodreads") : t("Library import")}</span>
          <h1>{complete ? t("Your library is here.") : preparing ? t("Reading your library…") : committing ? t("Bringing your books home…") : t("Make yourself at home.")}</h1>
          <p>{complete ? t('booksImported', { count: included.length, value: formatNumber(included.length) }) : preparing ? t("{{v0}} of {{v1}} books found", { v0: preview.proposals.length.toLocaleString(getLocale()), v1: progress.total.toLocaleString(getLocale()) }) : t("{{v0}} books · review the exceptions, then import", { v0: preview.proposals.length.toLocaleString(getLocale()) })}</p>
        </div>
      </header>

      {(busy || complete) && (
        <div className="import-live" role="status" aria-live="polite">
          <div><span>{complete ? <Check /> : <LoaderCircle className="import-spin" />}{complete ? t("Saved on this device") : preparing ? t("Preparing your books") : t("Saving your library")}</span><strong>{complete ? t("Done") : t("{{v0}} / {{v1}}", { v0: progress?.completed.toLocaleString(getLocale()) ?? 0, v1: progress?.total.toLocaleString(getLocale()) ?? preview.proposals.length })}</strong></div>
          <progress aria-label={preparing ? t("Preparation progress") : t("Import progress")} max={100} value={complete ? 100 : progressPercent} />
          {complete && <small>{t("Books are ready. Missing covers can fill in afterward.")}</small>}
        </div>
      )}

      <nav className="import-filters" aria-label={t("Filter import books")}>
        {(Object.keys(labels) as Filter[]).map((key) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(0); setExpandedId(undefined) }}>
            {labels[key]} <span>{counts[key].toLocaleString(getLocale())}</span>
          </button>
        ))}
      </nav>

      <div className="import-book-list" aria-label={t("Import rows")}>
        {rows.map((proposal, index) => {
          const decision = decisionFor(proposal)
          const expanded = expandedId === proposal.id
          const imported = complete && decision.included && !proposal.duplicateOfBatchId
          const active = committing && decision.included
          const immutable = busy || complete || proposal.kind === 'error' || Boolean(proposal.duplicateOfBatchId)
          return (
            <article className={`import-book-row${expanded ? ' is-expanded' : ''}${imported ? ' is-imported' : ''}`} key={proposal.id}>
              <div className="import-book-line" style={wideLayout ? { gridRow: index + 1 } : undefined}>
                <label className="import-select">
                  <input type="checkbox" checked={decision.included} disabled={immutable} onChange={(event) => changeDecision(proposal, { included: event.target.checked })} aria-label={t("Include {{v0}}", { v0: proposal.record?.title ?? `row ${proposal.rowNumber}` })} />
                  <span aria-hidden="true">{imported ? <Check className="import-arrived" /> : active ? <LoaderCircle className="import-spin" /> : proposal.kind === 'error' ? <TriangleAlert /> : decision.included ? <Check /> : null}</span>
                </label>
                <button className="import-book-expand" type="button" aria-expanded={expanded} aria-controls={`details-${proposal.id}`} onClick={() => setExpandedId(expanded ? undefined : proposal.id)}>
                  <span className="import-book-identity"><strong>{proposal.record?.title ?? t("Row {{v0}}", { v0: proposal.rowNumber })}</strong><small>{proposal.record?.authors.join(', ') ?? proposal.validationErrors.join(' · ')}</small></span>
                  <span className={`import-book-status${needsAttention(proposal) ? ' needs-attention' : ''}`}>{imported ? t("Imported") : active ? t("Saving") : proposalCopy[proposal.kind]}</span>
                  <ChevronRight className="import-chevron" />
                </button>
              </div>
              {expanded && <div id={`details-${proposal.id}`} className="import-book-details" style={wideLayout ? { gridRow: `1 / span ${Math.max(1, rows.length)}` } : undefined}>
                <fieldset disabled={busy || complete}>
                  <ProposalDetails proposal={proposal} books={books} sourceKey={preview.source.key} timestamp={preview.createdAt} decision={decision} onChange={(patch) => changeDecision(proposal, patch)} />
                </fieldset>
              </div>}
            </article>
          )
        })}
        {!rows.length && <p className="import-empty">{preparing ? t("Reading the first books…") : t("No books in this category.")}</p>}
      </div>

      {pageCount > 1 && <nav className="import-pagination" aria-label={t("Import pages")}>
        <button type="button" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setExpandedId(undefined) }} aria-label={t("Previous books")}><ChevronLeft /></button>
        <span>{(currentPage * PAGE_SIZE + 1).toLocaleString(getLocale())}–{Math.min((currentPage + 1) * PAGE_SIZE, visible.length).toLocaleString(getLocale())} {t(" of")}{' '}{visible.length.toLocaleString(getLocale())}</span>
        <button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => { setPage(currentPage + 1); setExpandedId(undefined) }} aria-label={t("Next books")}><ChevronRight /></button>
      </nav>}

      <details className="import-privacy"><summary>{t("What stays private")}<ChevronDown /></summary>
        <p>{t("The file is processed on this device. Books, shelves, notes, and reading history are saved together. You can undo this import in Settings. Cover lookup happens separately.")}</p>
      </details>

      <footer className="import-action-bar">
        <div><strong>{complete ? t("All set.") : unresolved.length ? t('booksNeedReview', { count: unresolved.length, value: formatNumber(unresolved.length) }) : t('booksSelected', { count: included.length, value: formatNumber(included.length) })}</strong><span>{complete ? t("Your reading life, in one place.") : t("Saved locally · undo available")}</span></div>
        <button type="button" disabled={!complete && (busy || included.length === 0 || unresolved.length > 0)} onClick={() => complete ? onBack() : void onCommit(preview.proposals.map(decisionFor))}>
          {busy ? <LoaderCircle className="import-spin" /> : <Check />}{complete ? t("View library") : preparing ? t("Preparing…") : committing ? t("Importing…") : t('importBooks', { count: included.length, value: formatNumber(included.length) })}
        </button>
        {error && <p role="alert">{<LocalizedError message={error} />}</p>}
      </footer>
    </main>
  )
}

function ProposalDetails({
  proposal,
  books,
  sourceKey,
  timestamp,
  decision,
  onChange,
}: {
  proposal: ImportProposal
  books: readonly LibraryBook[]
  sourceKey: string
  timestamp: string
  decision: ImportReviewDecision
  onChange: (patch: Partial<ImportReviewDecision>) => void
}) {
  useLanguage()
  const createId = proposal.record
    ? importedLibraryBookId(sourceKey, proposal.record.externalKey)
    : undefined
  const selectedBook = books.find(({ id }) => id === decision.targetId)
  const effectiveChanges = proposal.record && decision.targetId
    ? planLibraryBookCommit(proposal.record, sourceKey, timestamp, selectedBook).changes
    : proposal.changes
  const createdValue = effectiveChanges.find(({ field }) => field === '$record')?.after.value
  const effectiveReason = selectedBook && decision.targetId !== proposal.targetId
    ? t("Remapped by you to “{{v0}}”; {{v1}} reviewed fields would change.", { v0: selectedBook.title, v1: effectiveChanges.length })
    : decision.targetId === createId && proposal.kind === 'conflict'
      ? t("You chose to keep this ambiguous row distinct by creating a new record.")
      : proposal.reason

  return (
      <div className={tw("import-proposal__body")}>
        <div className={tw("import-proposal__identity")}>
          <span>{proposal.externalKey ?? t("Invalid row")}</span>
          <h3>{proposal.record?.title ?? t("Could not normalize this row")}</h3>
          <p>{proposal.record?.authors.join(', ') ?? proposal.validationErrors.join(' · ')}</p>
        </div>

        {proposal.record && proposal.kind !== 'skip' && (
          <label className={tw("import-target-select")}>
            <span>{t("Map this row to")}</span>
            <select
              value={decision.targetId ?? ''}
              onChange={(event) => onChange({
                targetId: event.target.value || undefined,
                targetUpdatedAt: books.find(({ id }) => id === event.target.value)?.lastUpdatedAt,
                included: Boolean(event.target.value),
              })}
            >
              <option value="">{t("Choose or exclude…")}</option>
              {createId && <option value={createId}>{t("Create “")}{proposal.record.title}”</option>}
              {books.map((book) => (
                <option key={book.id} value={book.id}>{book.title} — {book.authors.join(', ')}</option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" />
          </label>
        )}

        <p className={tw("import-proposal__reason")}>{effectiveReason}</p>
        <details>
          <summary>{t("Why this proposal?")}</summary>
          <div className={tw("import-proposal__evidence")}>
            <ul>
              {proposal.match.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              {proposal.validationErrors.map((validationError) => <li key={validationError}>{validationError}</li>)}
            </ul>
            {proposal.match.candidates.length > 0 && (
              <div className={tw("import-match-candidates")}>
                {proposal.match.candidates.map((candidate) => (
                  <div key={candidate.targetId}>
                    <span>{Math.round(candidate.score * 100)}{t("% signal")}</span>
                    <strong>{candidate.title}</strong>
                    <small>{candidate.authors.join(', ')}</small>
                  </div>
                ))}
              </div>
            )}
            {effectiveChanges.length > 0 && effectiveChanges[0]?.field !== '$record' && (
              <dl className={tw("import-change-list")}>
                {effectiveChanges.map((change) => (
                  <div key={change.field}>
                    <dt>{humanField(change.field)}</dt>
                    <dd><del>{displayValue(change.before.value)}</del><span>→</span><ins>{displayValue(change.after.value)}</ins></dd>
                  </div>
                ))}
              </dl>
            )}
            {proposal.entities.length > 0 && (
              <div className={tw("import-entity-ledger")}>
                <span>{t("Preserved behind each book")}</span>
                <ul>
                  {entitySummary(proposal).map(({ label, count }) => (
                    <li key={label}><strong>{count}</strong>{label}</li>
                  ))}
                </ul>
                <details className={tw("import-entity-details")}>
                  <summary>{t("Source, targets & rationale")}</summary>
                  <ul>
                    {proposal.entities.map((entity) => (
                      <li key={`${entity.entityType}:${entity.entityId}`}>
                        <strong>{entity.label}</strong>
                        <span>{entity.sourceKey} · {entity.confidence} {t(" confidence ·")}{entity.action}</span>
                        <small>{entity.rationale}</small>
                        <code>{entity.entityId}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
            {createdValue && typeof createdValue === 'object' && !Array.isArray(createdValue) && (
              <dl className={tw("import-change-list import-change-list--create")}>
                {Object.entries(createdValue)
                  .filter(([field]) => field !== 'id')
                  .map(([field, value]) => (
                    <div key={field}>
                      <dt>{humanField(field)}</dt>
                      <dd><ins>{displayValue(value)}</ins></dd>
                    </div>
                  ))}
              </dl>
            )}
          </div>
        </details>
      </div>
  )
}

function humanField(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase())
}

function displayValue(value: unknown): string {
  if (value === undefined) return t("Not set")
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function entitySummary(proposal: ImportProposal): Array<{ readonly label: string; readonly count: number }> {
  type EntityType = ImportProposal['entities'][number]['entityType']
  const labels: Record<EntityType, import('../localization').TranslationKey> = {
    "work": "importEntity_work",
    "edition": "importEntity_edition",
    "source-record": "importEntity_source-record",
    "identifier": "importEntity_identifier",
    "person": "importEntity_person",
    "contributor": "importEntity_contributor",
    "list": "importEntity_list",
    "list-entry": "importEntity_list-entry",
    "integration-checkpoint": "importEntity_integration-checkpoint",
    "reading-event": "importEntity_reading-event",
    "progress-snapshot": "importEntity_progress-snapshot",
  }
  const counts = new Map<EntityType, number>()
  proposal.entities.forEach(({ entityType }) => {
    counts.set(entityType, (counts.get(entityType) ?? 0) + 1)
  })
  return [...counts].map(([entityType, count]) => ({ label: t(labels[entityType], { count }), count }))
}
