import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookCopy,
  Check,
  CircleAlert,
  GitMerge,
  Link2,
  RotateCcw,
  SearchCheck,
  ShieldOff,
} from 'lucide-react'
import { tw } from '../tailwind/styles'

type DemoSide = {
  readonly id: string
  readonly label: string
  readonly title: string
  readonly contributor: string
  readonly source: string
  readonly editionSummary: string
  readonly counts: DemoCounts
  readonly editions: readonly string[]
}

type DemoCounts = {
  readonly editions: number
  readonly assets: number
  readonly progress: number
  readonly annotations: number
  readonly lists: number
  readonly loans: number
}

type DemoCandidate = {
  readonly id: string
  readonly confidence: 'High' | 'Medium'
  readonly score: number
  readonly left: DemoSide
  readonly right: DemoSide
  readonly evidence: readonly {
    readonly tone: 'supporting' | 'caution'
    readonly label: string
    readonly explanation: string
  }[]
  readonly listConsolidations: number
}

const DEMO_CANDIDATES: readonly DemoCandidate[] = [
  {
    id: 'left-hand',
    confidence: 'High',
    score: 96,
    left: {
      id: 'saved',
      label: 'Saved library Work',
      title: 'The Left Hand of Darkness',
      contributor: 'Ursula K. Le Guin',
      source: 'Manual correction · Google Books · Open Library',
      editionSummary: 'EPUB · Audiobook',
      counts: { editions: 2, assets: 4, progress: 2, annotations: 1, lists: 2, loans: 0 },
      editions: ['EPUB · 304 pages · 42% read', 'Audiobook · 9h 57m · 20% listened'],
    },
    right: {
      id: 'imported',
      label: 'New import Work',
      title: 'The Left Hand of Darknes',
      contributor: 'Ursula K. Le Guin',
      source: 'Calibre catalog · ISBN scan',
      editionSummary: 'Paperback',
      counts: { editions: 1, assets: 1, progress: 0, annotations: 0, lists: 1, loans: 0 },
      editions: ['Paperback · 304 pages · ISBN 9780441478125'],
    },
    evidence: [
      {
        tone: 'supporting',
        label: 'Exact ISBN-13',
        explanation: '9780441478125 appears on both Edition records. ISBN evidence is strong, but never auto-merges Works.',
      },
      {
        tone: 'supporting',
        label: '96% fuzzy title match',
        explanation: 'The local search matcher found one missing final letter after normalizing punctuation and case.',
      },
      {
        tone: 'supporting',
        label: 'Same author credit',
        explanation: 'Both Work records normalize to Ursula K. Le Guin.',
      },
      {
        tone: 'caution',
        label: 'Identifier crosses formats',
        explanation: 'The ISBN appears beside ebook and print records. Confirm the Edition boundary before merging the Works.',
      },
    ],
    listConsolidations: 1,
  },
  {
    id: 'piranesi',
    confidence: 'Medium',
    score: 68,
    left: {
      id: 'corrected',
      label: 'Reader-corrected Work',
      title: 'Piranesi',
      contributor: 'Susanna Clarke',
      source: 'Manual correction · EPUB metadata',
      editionSummary: 'EPUB',
      counts: { editions: 1, assets: 2, progress: 1, annotations: 3, lists: 1, loans: 0 },
      editions: ['EPUB · 272 pages · private notes retained'],
    },
    right: {
      id: 'provider',
      label: 'Provider Work',
      title: 'Piranezi',
      contributor: 'Susanna Clarke',
      source: 'Google Books',
      editionSummary: 'Hardcover',
      counts: { editions: 1, assets: 1, progress: 0, annotations: 0, lists: 0, loans: 1 },
      editions: ['Hardcover · 272 pages · active library loan'],
    },
    evidence: [
      {
        tone: 'supporting',
        label: 'Likely title typo',
        explanation: 'The fuzzy matcher sees a one-letter substitution in an otherwise identical title.',
      },
      {
        tone: 'supporting',
        label: 'Same author and length',
        explanation: 'Both records credit Susanna Clarke and report 272 pages.',
      },
      {
        tone: 'caution',
        label: 'No shared identifier',
        explanation: 'The provider record has no ISBN, so this remains a medium-confidence review.',
      },
    ],
    listConsolidations: 0,
  },
]

type Decision = 'merge' | 'keep-separate' | 'relate' | 'never-suggest'

const countLabels: ReadonlyArray<readonly [keyof DemoCounts, string]> = [
  ['editions', 'Editions'],
  ['assets', 'Assets'],
  ['progress', 'Progress'],
  ['annotations', 'Annotations'],
  ['lists', 'Lists'],
  ['loans', 'Loans'],
]

export function DuplicateReviewPrototype() {
  const [activeId, setActiveId] = useState(DEMO_CANDIDATES[0]!.id)
  const [destinationByCandidate, setDestinationByCandidate] = useState<Record<string, string>>({
    'left-hand': 'saved',
    piranesi: 'corrected',
  })
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [lastDecision, setLastDecision] = useState<{ readonly id: string; readonly decision: Decision }>()
  const [announcement, setAnnouncement] = useState('')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const active = useMemo(
    () => DEMO_CANDIDATES.find(({ id }) => id === activeId) ?? DEMO_CANDIDATES[0]!,
    [activeId],
  )
  const destinationId = destinationByCandidate[active.id] ?? active.left.id
  const destination = destinationId === active.left.id ? active.left : active.right
  const moving = destinationId === active.left.id ? active.right : active.left
  const decision = decisions[active.id]

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.paperMode = 'warm'
    root.dataset.contrast = 'standard'
    root.dataset.motion = 'reduced'
    root.dataset.texture = 'quiet'
    document.title = 'Duplicate review · Wovenleaf'
  }, [])

  const openCandidate = (id: string) => {
    setActiveId(id)
    setAnnouncement('')
    window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }))
  }

  const applyDecision = (nextDecision: Decision) => {
    setDecisions((current) => ({ ...current, [active.id]: nextDecision }))
    setLastDecision({ id: active.id, decision: nextDecision })
    const message = nextDecision === 'merge'
      ? `Merged into ${destination.title}. Edition identities and attached reader data stayed intact.`
      : nextDecision === 'keep-separate'
        ? 'Kept as separate Works. This evidence fingerprint is remembered.'
        : nextDecision === 'relate'
          ? 'Related the Works without combining their editions.'
          : 'This pair will no longer be suggested.'
    setAnnouncement(message)
  }

  const undoLastDecision = () => {
    if (!lastDecision) return
    setDecisions((current) => {
      const next = { ...current }
      delete next[lastDecision.id]
      return next
    })
    setActiveId(lastDecision.id)
    setLastDecision(undefined)
    setAnnouncement('Decision undone. The exact Work and Edition assignments are restored for review.')
  }

  const destinationAfter = combineCounts(destination.counts, moving.counts, active.listConsolidations)
  const openCount = DEMO_CANDIDATES.length - Object.keys(decisions).length

  return (
    <div className={tw("duplicate-desk")}>
      <header className={tw("duplicate-masthead")}>
        <div className={tw("duplicate-masthead__identity")}>
          <a href="/" aria-label="Back to Wovenleaf"><ArrowLeft aria-hidden="true" /></a>
          <div><span>Wovenleaf · identity desk</span><h1>Duplicate review</h1></div>
        </div>
        <p>Search finds the resemblance. Evidence earns the merge.</p>
        <span className={tw("duplicate-offline")}><SearchCheck aria-hidden="true" /> On-device · offline</span>
      </header>

      <section className={tw("duplicate-summary")} aria-label="Duplicate review summary">
        <div><strong>{openCount}</strong><span>ready for review</span></div>
        <p><span>3 quiet leads</span> Low-confidence matches wait here and never interrupt capture.</p>
        <button type="button" onClick={undoLastDecision} disabled={!lastDecision}>
          <RotateCcw aria-hidden="true" /> Undo last decision
        </button>
      </section>

      <main className={tw("duplicate-workbench")}>
        <aside className={tw("duplicate-queue")} aria-labelledby="duplicate-queue-title">
          <header><span>Candidate queue</span><h2 id="duplicate-queue-title">Worth a closer look</h2></header>
          <ol>
            {DEMO_CANDIDATES.map((candidate, index) => {
              const resolved = Boolean(decisions[candidate.id])
              return (
                <li key={candidate.id}>
                  <button
                    type="button"
                    aria-current={candidate.id === active.id ? 'true' : undefined}
                    onClick={() => openCandidate(candidate.id)}
                  >
                    <span className={tw("duplicate-queue__number")}>{String(index + 1).padStart(2, '0')}</span>
                    <span className={tw("duplicate-queue__copy")}>
                      <small>{candidate.confidence} confidence · {candidate.score}%</small>
                      <strong>{candidate.left.title}</strong>
                      <span>{candidate.left.contributor}</span>
                    </span>
                    <span className={tw(`duplicate-queue__state${resolved ? ' is-resolved' : ''}`)}>
                      {resolved ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
                      <span className={tw("sr-only")}>{resolved ? 'Reviewed' : 'Open'}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </aside>

        <article className={tw("duplicate-dossier")} aria-labelledby="duplicate-detail-title">
          <header className={tw("duplicate-dossier__header")}>
            <div>
              <span>{active.confidence} confidence · {active.score}% evidence score</span>
              <h2 id="duplicate-detail-title" ref={headingRef} tabIndex={-1}>Are these the same Work?</h2>
            </div>
            <span className={tw(`duplicate-state${decision ? ' is-reviewed' : ''}`)}>
              {decision ? 'Reviewed' : 'No automatic changes'}
            </span>
          </header>

          <section className={tw("duplicate-comparison")} aria-label="Work comparison">
            <WorkCard side={active.left} />
            <span className={tw("duplicate-comparison__link")} aria-hidden="true"><BookCopy /></span>
            <WorkCard side={active.right} />
          </section>

          <section className={tw("duplicate-evidence")} aria-labelledby="duplicate-evidence-title">
            <header><span>Why it surfaced</span><h3 id="duplicate-evidence-title">Evidence ledger</h3></header>
            <ol>
              {active.evidence.map((item) => (
                <li key={item.label} className={tw(item.tone === 'caution' ? 'is-caution' : '')}>
                  <span aria-hidden="true">{item.tone === 'supporting' ? <Check /> : <CircleAlert />}</span>
                  <p><strong>{item.label}</strong>{item.explanation}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className={tw("duplicate-preview")} aria-labelledby="duplicate-preview-title">
            <header>
              <div><span>Before any merge</span><h3 id="duplicate-preview-title">Choose the destination</h3></div>
              <p>Everything below moves by stable Edition ID.</p>
            </header>
            <fieldset>
              <legend className={tw("sr-only")}>Surviving Work</legend>
              {[active.left, active.right].map((side) => (
                <label key={side.id} className={tw(destinationId === side.id ? 'is-selected' : '')}>
                  <input
                    type="radio"
                    name={`destination-${active.id}`}
                    checked={destinationId === side.id}
                    onChange={() => setDestinationByCandidate((current) => ({ ...current, [active.id]: side.id }))}
                  />
                  <span><strong>{side.title}</strong><small>{side.label} · {side.source}</small></span>
                </label>
              ))}
            </fieldset>

            <div className={tw("duplicate-preview__route")}>
              <div><span>Moving from</span><strong>{moving.label}</strong><small>{moving.editionSummary}</small></div>
              <GitMerge aria-hidden="true" />
              <div><span>Destination after merge</span><strong>{destination.title}</strong><small>{destinationAfter.editions} editions together</small></div>
            </div>

            <dl className={tw("duplicate-counts")}>
              {countLabels.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd><span>{destination.counts[key]}</span><b aria-hidden="true">→</b><strong>{destinationAfter[key]}</strong></dd>
                </div>
              ))}
            </dl>

            <ul className={tw("duplicate-editions")} aria-label="Edition destinations">
              {moving.editions.map((edition) => <li key={edition}><span>Moves intact</span><strong>{edition}</strong></li>)}
              {active.listConsolidations > 0 && (
                <li><span>List cleanup</span><strong>{active.listConsolidations} shared membership consolidated; custom order retained</strong></li>
              )}
            </ul>
          </section>

          <section className={tw("duplicate-actions")} aria-label="Duplicate decision">
            <div>
              <button type="button" className={tw("duplicate-actions__merge")} onClick={() => applyDecision('merge')} disabled={Boolean(decision)}>
                <GitMerge aria-hidden="true" /> Merge into {destination.title}
              </button>
              <small>Journaled with one-step undo. No Edition or source evidence is deleted.</small>
            </div>
            <div className={tw("duplicate-actions__alternatives")}>
              <button type="button" onClick={() => applyDecision('keep-separate')} disabled={Boolean(decision)}>
                <BookCopy aria-hidden="true" /> Keep separate
              </button>
              <button type="button" onClick={() => applyDecision('relate')} disabled={Boolean(decision)}>
                <Link2 aria-hidden="true" /> Relate only
              </button>
              <button type="button" onClick={() => applyDecision('never-suggest')} disabled={Boolean(decision)}>
                <ShieldOff aria-hidden="true" /> Never suggest
              </button>
            </div>
          </section>
        </article>
      </main>

      <p className={tw("sr-only")} role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    </div>
  )
}

function WorkCard({ side }: { readonly side: DemoSide }) {
  return (
    <article>
      <span>{side.label}</span>
      <h3>{side.title}</h3>
      <p>{side.contributor}</p>
      <dl><div><dt>Edition</dt><dd>{side.editionSummary}</dd></div><div><dt>Evidence from</dt><dd>{side.source}</dd></div></dl>
    </article>
  )
}

function combineCounts(destination: DemoCounts, moving: DemoCounts, consolidatedLists: number): DemoCounts {
  return {
    editions: destination.editions + moving.editions,
    assets: destination.assets + moving.assets,
    progress: destination.progress + moving.progress,
    annotations: destination.annotations + moving.annotations,
    lists: destination.lists + moving.lists - consolidatedLists,
    loans: destination.loans + moving.loans,
  }
}
