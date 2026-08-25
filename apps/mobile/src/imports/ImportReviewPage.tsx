import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  FileCheck2,
  FilePlus2,
  GitCompareArrows,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  TriangleAlert,
} from 'lucide-react'
import type { LibraryBook } from '../library-model'
import { importedLibraryBookId, planLibraryBookCommit } from './commit-rules'
import {
  IMPORT_STAGES,
  type ImportPreview,
  type ImportProposal,
  type ImportReviewDecision,
} from './model'
import './import-review.css'

const proposalCopy = {
  add: { label: 'Add', icon: FilePlus2 },
  update: { label: 'Update', icon: GitCompareArrows },
  conflict: { label: 'Conflict', icon: AlertTriangle },
  skip: { label: 'Skip', icon: SkipForward },
  error: { label: 'Error', icon: TriangleAlert },
} as const

export function ImportReviewPage({
  preview,
  books,
  busy,
  error,
  onBack,
  onCommit,
}: {
  preview: ImportPreview
  books: readonly LibraryBook[]
  busy: boolean
  error?: string
  onBack: () => void
  onCommit: (decisions: readonly ImportReviewDecision[]) => Promise<void>
}) {
  const [decisions, setDecisions] = useState<Record<string, ImportReviewDecision>>(() =>
    Object.fromEntries(preview.proposals.map((proposal) => [
      proposal.id,
      {
        rowId: proposal.id,
        included: proposal.defaultIncluded,
        targetId: proposal.targetId,
        targetUpdatedAt: books.find(({ id }) => id === proposal.targetId)?.lastUpdatedAt,
      },
    ])),
  )
  const [filter, setFilter] = useState<'all' | keyof typeof proposalCopy | 'low'>('all')
  const summary = useMemo(() => ({
    add: preview.proposals.filter(({ kind }) => kind === 'add').length,
    update: preview.proposals.filter(({ kind }) => kind === 'update').length,
    conflict: preview.proposals.filter(({ kind }) => kind === 'conflict').length,
    skip: preview.proposals.filter(({ kind }) => kind === 'skip').length,
    error: preview.proposals.filter(({ kind }) => kind === 'error').length,
    low: preview.proposals.filter(({ match }) => match.confidence === 'low').length,
  }), [preview.proposals])
  const visible = preview.proposals.filter((proposal) =>
    filter === 'all' || (filter === 'low' ? proposal.match.confidence === 'low' : proposal.kind === filter),
  )
  const included = preview.proposals.filter((proposal) => decisions[proposal.id]?.included)
  const unresolved = included.filter((proposal) =>
    proposal.kind === 'error' || (!decisions[proposal.id]?.targetId && proposal.kind !== 'skip'),
  )

  const changeDecision = (rowId: string, patch: Partial<ImportReviewDecision>) => {
    setDecisions((current) => ({
      ...current,
      [rowId]: { ...current[rowId]!, ...patch },
    }))
  }

  return (
    <main className="import-review" data-motion-event="navigate">
      <header className="import-review__masthead">
        <button type="button" onClick={onBack} aria-label="Back to import settings">
          <ArrowLeft aria-hidden="true" />
        </button>
        <div>
          <span>Wovenleaf · import desk</span>
          <h1>Review before it lands</h1>
          <p>{preview.fileName} · {preview.proposals.length} parsed rows · local only</p>
        </div>
        <div className="import-review__seal">
          <ShieldCheck aria-hidden="true" />
          <span><strong>Nothing writes yet</strong><small>Every mutation is listed below.</small></span>
        </div>
      </header>

      <ol className="import-stage-rail" aria-label="Import pipeline stages">
        {IMPORT_STAGES.map((stage, index) => {
          const completed = preview.completedStages.includes(stage)
          return (
            <li key={stage} className={completed ? 'is-complete' : stage === 'commit' ? 'is-next' : ''}>
              <span>{completed ? <Check aria-hidden="true" /> : String(index + 1)}</span>
              <strong>{stage}</strong>
            </li>
          )
        })}
      </ol>

      <section className="import-permission-ledger" aria-labelledby="import-permissions-title">
        <header>
          <LockKeyhole aria-hidden="true" />
          <div><span>Source permissions</span><h2 id="import-permissions-title">A deliberately small footprint</h2></div>
        </header>
        <ul>
          {preview.source.permissions.map((permission) => (
            <li key={permission.scope}>
              <span className={`import-permission__access is-${permission.access}`}>{permission.access}</span>
              <span><strong>{permission.label}</strong><small>{permission.explanation}</small></span>
            </li>
          ))}
        </ul>
      </section>

      <section className="import-workbench">
        <aside className="import-summary" aria-label="Import proposal summary">
          <header><span>Change set</span><h2>What this file proposes</h2></header>
          <div className="import-summary__count"><strong>{included.length}</strong><span>rows selected to commit</span></div>
          <div className="import-filter-list">
            <FilterButton label="All rows" count={preview.proposals.length} active={filter === 'all'} onClick={() => setFilter('all')} />
            {(Object.keys(proposalCopy) as Array<keyof typeof proposalCopy>).map((kind) => (
              <FilterButton key={kind} label={`${proposalCopy[kind].label}s`} count={summary[kind]} active={filter === kind} onClick={() => setFilter(kind)} />
            ))}
            <FilterButton label="Low confidence" count={summary.low} active={filter === 'low'} onClick={() => setFilter('low')} />
          </div>
          <p><RotateCcw aria-hidden="true" /> Commit creates a checkpoint and field-level undo record.</p>
        </aside>

        <div className="import-proposals" aria-label="Import rows">
          {visible.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              books={books}
              sourceKey={preview.source.key}
              timestamp={preview.createdAt}
              decision={decisions[proposal.id]!}
              onChange={(patch) => changeDecision(proposal.id, patch)}
            />
          ))}
          {!visible.length && <p className="import-proposals__empty">No rows in this category.</p>}
        </div>
      </section>

      <footer className="import-commit-bar">
        <div>
          <strong>{unresolved.length ? `${unresolved.length} selected rows need attention` : 'Ready for a transactional commit'}</strong>
          <span>{included.length} included · {preview.proposals.length - included.length} excluded · undo remains available in Settings</span>
          {error && <small role="alert">{error}</small>}
        </div>
        <button
          type="button"
          disabled={busy || included.length === 0 || unresolved.length > 0}
          onClick={() => void onCommit(Object.values(decisions))}
        >
          <FileCheck2 aria-hidden="true" />
          {busy ? 'Committing…' : `Commit ${included.length} rows`}
        </button>
      </footer>
    </main>
  )
}

function ProposalCard({
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
  const copy = proposalCopy[proposal.kind]
  const Icon = copy.icon
  const immutable = proposal.kind === 'error' || Boolean(proposal.duplicateOfBatchId)
  const createId = proposal.record
    ? importedLibraryBookId(sourceKey, proposal.record.externalKey)
    : undefined
  const selectedBook = books.find(({ id }) => id === decision.targetId)
  const effectiveChanges = proposal.record && decision.targetId
    ? planLibraryBookCommit(proposal.record, sourceKey, timestamp, selectedBook).changes
    : proposal.changes
  const createdValue = effectiveChanges.find(({ field }) => field === '$record')?.after.value
  const effectiveReason = selectedBook && decision.targetId !== proposal.targetId
    ? `Remapped by you to “${selectedBook.title}”; ${effectiveChanges.length} reviewed fields would change.`
    : decision.targetId === createId && proposal.kind === 'conflict'
      ? 'You chose to keep this ambiguous row distinct by creating a new record.'
      : proposal.reason

  return (
    <article className={`import-proposal import-proposal--${proposal.kind}${decision.included ? ' is-included' : ''}`}>
      <header>
        <label className="import-row-toggle">
          <input
            type="checkbox"
            checked={decision.included}
            disabled={immutable}
            onChange={(event) => onChange({ included: event.target.checked })}
          />
          <span aria-hidden="true"><Check /></span>
          <span className="sr-only">Include row {proposal.rowNumber}</span>
        </label>
        <span className="import-proposal__kind"><Icon aria-hidden="true" />{copy.label}</span>
        {proposal.match.confidence === 'low' && <span className="import-proposal__confidence">Low confidence</span>}
        <span className="import-proposal__row">row {proposal.rowNumber}</span>
      </header>

      <div className="import-proposal__body">
        <div className="import-proposal__identity">
          <span>{proposal.externalKey ?? 'Invalid row'}</span>
          <h3>{proposal.record?.title ?? 'Could not normalize this row'}</h3>
          <p>{proposal.record?.authors.join(', ') ?? proposal.validationErrors.join(' · ')}</p>
        </div>

        {proposal.record && proposal.kind !== 'skip' && (
          <label className="import-target-select">
            <span>Map this row to</span>
            <select
              value={decision.targetId ?? ''}
              onChange={(event) => onChange({
                targetId: event.target.value || undefined,
                targetUpdatedAt: books.find(({ id }) => id === event.target.value)?.lastUpdatedAt,
                included: Boolean(event.target.value),
              })}
            >
              <option value="">Choose or exclude…</option>
              {createId && <option value={createId}>Create “{proposal.record.title}”</option>}
              {books.map((book) => (
                <option key={book.id} value={book.id}>{book.title} — {book.authors.join(', ')}</option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" />
          </label>
        )}

        <p className="import-proposal__reason">{effectiveReason}</p>
        <details>
          <summary>Why this proposal?</summary>
          <div className="import-proposal__evidence">
            <ul>
              {proposal.match.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              {proposal.validationErrors.map((validationError) => <li key={validationError}>{validationError}</li>)}
            </ul>
            {proposal.match.candidates.length > 0 && (
              <div className="import-match-candidates">
                {proposal.match.candidates.map((candidate) => (
                  <div key={candidate.targetId}>
                    <span>{Math.round(candidate.score * 100)}% signal</span>
                    <strong>{candidate.title}</strong>
                    <small>{candidate.authors.join(', ')}</small>
                  </div>
                ))}
              </div>
            )}
            {effectiveChanges.length > 0 && effectiveChanges[0]?.field !== '$record' && (
              <dl className="import-change-list">
                {effectiveChanges.map((change) => (
                  <div key={change.field}>
                    <dt>{humanField(change.field)}</dt>
                    <dd><del>{displayValue(change.before.value)}</del><span>→</span><ins>{displayValue(change.after.value)}</ins></dd>
                  </div>
                ))}
              </dl>
            )}
            {createdValue && typeof createdValue === 'object' && !Array.isArray(createdValue) && (
              <dl className="import-change-list import-change-list--create">
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
    </article>
  )
}

function FilterButton({ label, count, active, onClick }: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}>
      <span>{label}</span><strong>{count}</strong>
    </button>
  )
}

function humanField(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase())
}

function displayValue(value: unknown): string {
  if (value === undefined) return 'Not set'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}
