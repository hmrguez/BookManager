import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  CircleAlert,
  History,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import { ActionButton, StatusBadge } from '../design-system'
import type { ConflictDomain, EvidenceClass } from '../domain/catalog'
import { PROTOTYPE_CONFLICTS, SOURCE_LABELS } from './prototypeFixtures'
import '../App.css'
import './conflict-inbox.css'

const domainLabels: Record<ConflictDomain, string> = {
  'work-identity': 'Identity',
  metadata: 'Metadata',
  'list-placement': 'Lists',
  progress: 'Progress',
  'finish-state': 'Finish state',
  deletion: 'Deletion',
}

const evidenceLabels: Record<EvidenceClass, string> = {
  authoritative: 'Authoritative here',
  observed: 'Observed',
  inferred: 'Inferred',
  'user-corrected': 'Reader corrected',
}

function formatObservation(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(value))
}

export function ConflictInboxPrototype() {
  const [activeId, setActiveId] = useState(PROTOTYPE_CONFLICTS[0]!.item.id)
  const [resolvedIds, setResolvedIds] = useState<ReadonlySet<string>>(new Set())
  const [selectedByConflict, setSelectedByConflict] = useState<Record<string, string>>(() =>
    Object.fromEntries(PROTOTYPE_CONFLICTS.map(({ item, recommendedCandidateId }) => [item.id, recommendedCandidateId])),
  )
  const [rememberChoice, setRememberChoice] = useState(true)
  const [announcement, setAnnouncement] = useState('')
  const [lastResolvedId, setLastResolvedId] = useState<string>()
  const detailHeadingRef = useRef<HTMLHeadingElement>(null)

  const active = useMemo(
    () => PROTOTYPE_CONFLICTS.find(({ item }) => item.id === activeId) ?? PROTOTYPE_CONFLICTS[0]!,
    [activeId],
  )
  const openCount = PROTOTYPE_CONFLICTS.length - resolvedIds.size
  const selectedCandidateId = selectedByConflict[active.item.id]

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.paperMode = 'warm'
    root.dataset.contrast = 'standard'
    root.dataset.motion = 'reduced'
    root.dataset.texture = 'quiet'
    document.title = 'Conflict inbox prototype · Wovenleaf'
  }, [])

  const openConflict = (id: string) => {
    setActiveId(id)
    setAnnouncement('')
    window.requestAnimationFrame(() => detailHeadingRef.current?.focus({ preventScroll: true }))
  }

  const resolveConflict = () => {
    const candidate = active.item.candidates.find(({ id }) => id === selectedCandidateId)
    if (!candidate) return

    setResolvedIds((current) => new Set([...current, active.item.id]))
    setLastResolvedId(active.item.id)
    setAnnouncement(
      `${active.title} resolved with ${SOURCE_LABELS[candidate.source]}. ${rememberChoice ? 'The choice is remembered for this field only.' : 'The choice applies once.'}`,
    )
  }

  const undoLastDecision = () => {
    if (!lastResolvedId) return
    const restored = PROTOTYPE_CONFLICTS.find(({ item }) => item.id === lastResolvedId)
    setResolvedIds((current) => {
      const next = new Set(current)
      next.delete(lastResolvedId)
      return next
    })
    setActiveId(lastResolvedId)
    setLastResolvedId(undefined)
    setAnnouncement(`${restored?.title ?? 'Decision'} restored to the conflict inbox.`)
  }

  return (
    <div className="conflict-inbox">
      <header className="conflict-masthead">
        <div className="conflict-masthead__identity">
          <a href="/" aria-label="Back to Wovenleaf"><ArrowLeft aria-hidden="true" /></a>
          <div>
            <span>Wovenleaf · reconciliation desk</span>
            <h1>Conflict inbox</h1>
          </div>
        </div>
        <p>Nothing overwrites quietly. Compare the evidence, keep the useful parts, and leave a path back.</p>
        <StatusBadge tone="accent" icon={<BookOpenCheck aria-hidden="true" />}>Interactive prototype</StatusBadge>
      </header>

      <div className="conflict-summary" aria-label="Conflict inbox summary">
        <div><strong>{openCount}</strong><span>open decisions</span></div>
        <p><ShieldCheck aria-hidden="true" /> A decision protects one field. Other sources can still add useful metadata.</p>
        <button type="button" onClick={undoLastDecision} disabled={!lastResolvedId}>
          <RotateCcw aria-hidden="true" /> Undo last decision
        </button>
      </div>

      <main className="conflict-workbench">
        <aside className="conflict-queue" aria-labelledby="conflict-queue-title">
          <header>
            <span>Review queue</span>
            <h2 id="conflict-queue-title">Needs your eye</h2>
          </header>
          <ol>
            {PROTOTYPE_CONFLICTS.map((fixture, index) => {
              const isResolved = resolvedIds.has(fixture.item.id)
              return (
                <li key={fixture.item.id}>
                  <button
                    type="button"
                    aria-current={fixture.item.id === active.item.id ? 'true' : undefined}
                    onClick={() => openConflict(fixture.item.id)}
                  >
                    <span className="conflict-queue__number">{String(index + 1).padStart(2, '0')}</span>
                    <span className="conflict-queue__copy">
                      <small>{domainLabels[fixture.item.domain]}</small>
                      <strong>{fixture.title}</strong>
                      <span>{fixture.work}</span>
                    </span>
                    <span className={`conflict-queue__state${isResolved ? ' is-resolved' : ''}`}>
                      {isResolved ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
                      <span className="sr-only">{isResolved ? 'Resolved' : 'Open'}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </aside>

        <article className="conflict-dossier" aria-labelledby="conflict-detail-title">
          <header className="conflict-dossier__header">
            <div>
              <span>{active.eyebrow}</span>
              <h2 id="conflict-detail-title" ref={detailHeadingRef} tabIndex={-1}>{active.title}</h2>
              <p>{active.work}</p>
            </div>
            <StatusBadge tone={resolvedIds.has(active.item.id) ? 'accent' : 'neutral'}>
              {resolvedIds.has(active.item.id) ? 'Resolved' : 'Awaiting review'}
            </StatusBadge>
          </header>

          <section className="conflict-brief" aria-label="Why this needs review">
            <div><span>What disagrees</span><p>{active.summary}</p></div>
            <div><span>What changes</span><p>{active.consequence}</p></div>
          </section>

          <form onSubmit={(event) => { event.preventDefault(); resolveConflict() }}>
            <fieldset className="conflict-candidates">
              <legend>Which should Wovenleaf use?</legend>
              <p id="candidate-guidance">Choose with Space or the arrow keys. Source evidence remains available after the decision.</p>
              <div aria-describedby="candidate-guidance">
                {active.item.candidates.map((candidate) => {
                  const isRecommended = candidate.id === active.recommendedCandidateId
                  return (
                    <label key={candidate.id} className={selectedCandidateId === candidate.id ? 'is-selected' : ''}>
                      <input
                        type="radio"
                        name={`choice-${active.item.id}`}
                        value={candidate.id}
                        checked={selectedCandidateId === candidate.id}
                        onChange={() => setSelectedByConflict((current) => ({ ...current, [active.item.id]: candidate.id }))}
                      />
                      <span className="conflict-candidate__marker" aria-hidden="true"><span /></span>
                      <span className="conflict-candidate__body">
                        <span className="conflict-candidate__source">
                          <strong>{SOURCE_LABELS[candidate.source]}</strong>
                          <span>{evidenceLabels[candidate.evidence]}</span>
                          {isRecommended && <em>Suggested</em>}
                        </span>
                        <strong className="conflict-candidate__value">{active.displayValues[candidate.id]}</strong>
                        <span className="conflict-candidate__why">{candidate.explanation}</span>
                        <span className="conflict-candidate__meta">
                          Seen {formatObservation(candidate.observedAt)} UTC · {Math.round(candidate.confidence * 100)}% source confidence
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <div className="conflict-decision">
              <label className="conflict-remember">
                <input type="checkbox" checked={rememberChoice} onChange={(event) => setRememberChoice(event.target.checked)} />
                <span><strong>Remember for this field</strong><small>Future sources may still improve every other field.</small></span>
              </label>
              <ActionButton type="submit" disabled={resolvedIds.has(active.item.id)}>
                {resolvedIds.has(active.item.id) ? 'Decision applied' : 'Apply decision'}
                <ArrowRight aria-hidden="true" />
              </ActionButton>
            </div>
          </form>

          <footer className="conflict-history-note">
            <History aria-hidden="true" />
            <p><strong>Evidence stays intact.</strong> Merge, split, reassignment, and this choice are journaled so undo never depends on reconstructing an old screen.</p>
          </footer>
        </article>
      </main>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    </div>
  )
}
