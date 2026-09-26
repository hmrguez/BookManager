import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { App } from '@capacitor/app'
import { BookOpen, Compass, Clock, Feather, Sunrise, Bookmark } from 'lucide-react'
import type { ReviewKeepsake, SavedReviewFacts } from './keepsake-model'
import type { ReviewKeepsakeRepository } from './keepsake-repository'
import { badgeFact, metricFact, pathways, quarterLabel } from './presentation'
import { REVIEW_GENRES, type ReviewGenre } from './genres'
import { BADGE_SETTLED_MS, BADGE_TOTAL_MS, badgePhase, shouldAdvanceBadge } from './playback'
import { PathwayArtwork } from './PathwayArtwork'
import { useReviewManualMode } from './accessibility'

type Badge = SavedReviewFacts['earned'][number]
const symbols = { completion: BookOpen, discovery: Compass, time: Clock, rhythm: Sunrise, reflection: Feather, progress: Bookmark }
function Seal({ badge }: { badge: Badge }) {
  const Symbol = symbols[badge.family]
  return <div className="review-seal" data-tier={badge.tier} aria-hidden="true"><Symbol /><span>{'· '.repeat(badge.tier)}</span></div>
}
function BadgeDetails({ badge, saved }: { badge: Badge; saved: ReviewKeepsake }) {
  return <div className="review-evidence"><h4>{badge.name}</h4><p>{badgeFact(badge)}</p>
    {badge.detail && <p>{badge.detail}</p>}
    <ul>{saved.facts.supportingBooks.filter(book => badge.workIds.includes(book.workId)).map(book => <li key={book.workId}>{book.title}</li>)}</ul>
    {badge.personalBest && <><p>Your best recorded quarter. Compared with complete, comparable recorded quarters:</p><ul>
      {badge.comparisons.map(c => <li key={`${c.quarter.year}-${c.quarter.quarter}`}>{quarterLabel(c.quarter)}: {new Intl.NumberFormat('en').format(c.value)} {badge.unit}</li>)}
    </ul></>}
  </div>
}

export function ReviewViewer({ initial, fresh, repository, reduced, onDone }: {
  initial: ReviewKeepsake; fresh: boolean; repository: ReviewKeepsakeRepository; reduced: boolean; onDone: () => void
}) {
  const [saved, setSaved] = useState(initial)
  const [index, setIndex] = useState(() => initial.completedAt ? initial.steps.length - 1 : initial.steps.findIndex(step => step.id === initial.progress.stepId))
  const [paused, setPaused] = useState(!fresh)
  const [elapsed, setElapsed] = useState(fresh ? 0 : BADGE_SETTLED_MS)
  const [details, setDetails] = useState<Badge>()
  const [chooser, setChooser] = useState(false)
  const [identityDetails, setIdentityDetails] = useState(false)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const manual = useReviewManualMode(reduced)
  const step = saved.steps[index]!
  const badge = step.kind === 'badge' ? saved.facts.earned.find(badge => badge.id === step.badgeId) : undefined
  const lastBadge = index === saved.steps.length - 3
  const phase = manual ? 'settled' : badgePhase(elapsed)
  const genre = saved.identity.status === 'chosen' ? saved.identity.genre : null
  const period = { year: saved.facts.quarter.year, quarter: saved.facts.quarter.quarter }
  // Commits precede presentation; prevent double taps racing identity/progress writes.
  async function write(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await action() } catch { setPaused(true); setError('Your last saved review is safe. Please try again.') }
    finally { lock.current = false; setBusy(false) }
  }
  const go = (next: number, play = false) => write(async () => {
    const target = saved.steps[next]!
    const updated = await repository.saveProgress(period, target.id)
    setSaved(updated); setIndex(next); setElapsed(play && !manual ? 0 : BADGE_SETTLED_MS)
    setPaused(!play || manual); setDetails(undefined); setChooser(false); setIdentityDetails(false)
  })
  const tick = useEffectEvent((delta: number) => {
    if (!paused && !manual && !busy && badge && !details) {
      const next = elapsed + delta
      setElapsed(next)
      if (shouldAdvanceBadge(next, false, lastBadge)) void go(index + 1, true)
      else if (lastBadge && next >= BADGE_TOTAL_MS) setPaused(true)
    }
  })
  useEffect(() => {
    let previous = performance.now()
    const timer = window.setInterval(() => { const now = performance.now(); tick(Math.min(100, now - previous)); previous = now }, 50)
    return () => clearInterval(timer)
  }, [])
  const [previousManual, setPreviousManual] = useState(manual)
  if (manual !== previousManual) {
    setPreviousManual(manual)
    if (manual) { setPaused(true); setElapsed(BADGE_SETTLED_MS) }
  }
  useEffect(() => {
    const pause = () => { setPaused(true); setElapsed(BADGE_SETTLED_MS) }
    const visibility = () => { if (document.hidden) pause() }
    document.addEventListener('visibilitychange', visibility)
    let disposed = false
    const listener = App.addListener('appStateChange', ({ isActive }) => { if (!isActive) pause() })
    void listener.then(handle => { if (disposed) void handle.remove() })
    return () => { disposed = true; document.removeEventListener('visibilitychange', visibility); void listener.then(handle => handle.remove()) }
  }, [])
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [index, chooser, identityDetails, all])
  const restart = () => write(async () => {
    const entry = await repository.restart(period)
    setSaved(entry.keepsake); setIndex(0); setPaused(true); setElapsed(BADGE_SETTLED_MS); setChooser(false); setIdentityDetails(false); setAll(false)
  })
  const discover = () => write(async () => {
    let updated = saved
    if (saved.identity.status === 'skipped' || saved.identity.status === 'removed') {
      setSaved(await repository.complete(period)); setIndex(saved.steps.length - 1); setPaused(true); return
    }
    if (saved.identity.status === 'unselected' && saved.facts.genre.suggested) {
      updated = await repository.setIdentity(period, { status: 'chosen', genre: saved.facts.genre.suggested })
    }
    if (updated.identity.status === 'chosen') {
      setSaved(await repository.complete(period)); setIndex(saved.steps.length - 1); setPaused(true)
    } else {
      setSaved(await repository.saveProgress(period, saved.steps.at(-2)!.id)); setIndex(saved.steps.length - 2); setPaused(true); setChooser(true)
    }
  })
  const finish = (skip = false) => write(async () => {
    if (skip || saved.identity.status === 'unselected') await repository.setIdentity(period, { status: 'skipped' })
    setSaved(await repository.complete(period)); setIndex(saved.steps.length - 1); setPaused(true); setChooser(false); setIdentityDetails(false)
  })
  const choose = (choice: ReviewGenre) => write(async () => {
    await repository.setIdentity(period, { status: 'chosen', genre: choice })
    setSaved(await repository.complete(period)); setIndex(saved.steps.length - 1); setChooser(false); setIdentityDetails(false); setPaused(true)
  })
  const tap = () => {
    if (phase !== 'settled') setElapsed(BADGE_SETTLED_MS)
    else if (!lastBadge) void go(index + 1, !paused)
  }
  const choices = [...new Set([...saved.facts.genre.choices, ...REVIEW_GENRES])]
  const collection = step.kind === 'collection'
  return <section className="quarterly-review" aria-busy={busy}>
    <p className="review-eyebrow">{quarterLabel(period)}</p>
    {error && <p role="alert">{error}</p>}
    {badge && <>
      <p className="review-eyebrow">A moment worth keeping · {index + 1} of {saved.facts.revealIds.length}</p>
      <div className="review-badge" data-phase={phase} data-paused={paused || manual}>
        <button className="review-stamp-button" type="button" disabled={busy} onClick={tap} aria-label={phase !== 'settled' ? 'Finish badge reveal' : lastBadge ? 'Keep this achievement visible' : 'Next achievement'}><Seal badge={badge} /></button>
        <h3 ref={heading} tabIndex={-1}>{badge.name}</h3><p className="review-fact">{badgeFact(badge)}</p>
        {badge.detail && <p>{badge.detail}</p>}
        {badge.personalBest && <p className="review-best">Your best recorded quarter</p>}
      </div>
      <div className="review-controls">
        {index > 0 && <button disabled={busy} onClick={() => void go(index - 1)}>Previous</button>}
        {!manual && <button disabled={busy || !!details} onClick={() => { if (!paused) setElapsed(BADGE_SETTLED_MS); setPaused(!paused) }}>{paused ? 'Resume' : 'Pause'}</button>}
        <button onClick={() => { setPaused(true); setElapsed(BADGE_SETTLED_MS); setDetails(details ? undefined : badge) }}>{details ? 'Close details' : 'Details'}</button>
      </div>
      {details && <BadgeDetails badge={details} saved={saved} />}
      {lastBadge ? <div className="review-actions"><button className="review-primary" disabled={busy} onClick={() => void discover()}>Discover your pathway</button><button disabled={busy} onClick={() => void finish(true)}>Skip</button></div>
        : <button className="review-primary" disabled={busy} onClick={tap}>{phase === 'settled' ? 'Continue' : 'Finish reveal'}</button>}
      <button className="review-quiet" disabled={busy} onClick={() => void restart()}>Start again</button>
    </>}
    {step.kind === 'reflection' && <>
      <h3 ref={heading} tabIndex={-1}>A moment to reflect on your reading.</h3>
      {['01', '09', '28'].filter(id => (saved.facts.metrics[id]?.value ?? 0) >= .01).map(id => <p key={id}>{metricFact(id, saved.facts.metrics[id]!.value!)}</p>)}
      <p>Keep a little of this season with you.</p>
      <div className="review-actions"><button className="review-primary" disabled={busy} onClick={() => void discover()}>Discover your pathway</button><button disabled={busy} onClick={() => void finish(true)}>Skip</button></div>
    </>}
    {(chooser || step.kind === 'pathway' && !genre) && <>
      <h3 ref={heading} tabIndex={-1}>Which pathway feels like your quarter?</h3><p>A title for this season. The choice is yours.</p>
      <div className="review-choices">{choices.map(choice => <button key={choice} disabled={busy} onClick={() => void choose(choice)}>
        <PathwayArtwork artwork={saved.artwork.pathways[choice]} />
        <span>{pathways[choice].title}</span><small>{pathways[choice].label}</small>
      </button>)}</div>
      <button disabled={busy} onClick={() => collection ? setChooser(false) : void finish(true)}>{collection ? 'Cancel' : 'Skip'}</button>
    </>}
    {collection && !chooser && <>
      <p className="review-eyebrow">{genre && saved.facts.genre.suggested === genre ? 'Inspired by your reading' : 'Your reading season'}</p>
      <h3 ref={heading} tabIndex={-1}>{genre ? pathways[genre].title : 'A quarter to keep'}</h3>
      {genre && <>
        <button className="review-stamp-button" aria-label="Pathway details" onClick={() => setIdentityDetails(!identityDetails)}><PathwayArtwork key={genre} artwork={saved.artwork.pathways[genre]} /></button>
        {identityDetails && <div className="review-evidence"><p>{pathways[genre].label} · Your chosen quarterly reading identity</p><button onClick={() => setChooser(true)}>Choose another pathway</button>
          <button disabled={busy} onClick={() => void write(async () => { setSaved(await repository.setIdentity(period, { status: 'removed' })); setIdentityDetails(false) })}>Remove pathway</button></div>}
      </>}
      <div className="review-collection">{(all ? saved.facts.earned : saved.facts.featuredIds.map(id => saved.facts.earned.find(b => b.id === id)!)).map(b => <article key={b.id}>
        <Seal badge={b} /><div className="review-collection-copy"><h4>{b.name}</h4><p>{badgeFact(b)}</p>{b.personalBest && <p className="review-best">Your best recorded quarter</p>}
        <details><summary>Details</summary><BadgeDetails badge={b} saved={saved} /></details></div>
      </article>)}</div>
      <div className="review-actions"><button className="review-primary" onClick={onDone}>Done</button>
        {saved.facts.earned.length > 0 && <button onClick={() => setAll(!all)}>{all ? 'Featured badges' : 'All earned badges'}</button>}
        <button disabled={busy} onClick={() => void restart()}>Replay highlights</button></div>
      {!genre && <details className="review-secondary-menu"><summary>Review options</summary><button onClick={() => setChooser(true)}>Choose a pathway</button></details>}
    </>}
  </section>
}
