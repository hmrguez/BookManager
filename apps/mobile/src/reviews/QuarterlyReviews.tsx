import { useEffect, useState } from 'react'
import { ArrowUpRight, ChevronRight, BookOpen } from 'lucide-react'
import { getStorageRuntime } from '../storage/runtime'
import { Sheet } from '../app/components/Sheet'
import type { ReviewKeepsakeRepository } from './keepsake-repository'
import type { ReviewKeepsake, ReviewPeriod } from './keepsake-model'
import { ReviewViewer } from './ReviewViewer'
import { PathwayArtwork } from './PathwayArtwork'
import { pathways, quarterLabel, reviewArtwork } from './presentation'
import './reviews.css'

export function ReviewsPage({ refresh, invitation, onDismiss, onOpen }: {
  refresh: unknown; invitation: ReviewPeriod | null; onDismiss: () => void; onOpen: (period: ReviewPeriod) => void
}) {
  const [archive, setArchive] = useState<ReviewKeepsake[]>([])
  const [latest, setLatest] = useState<ReviewPeriod>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [quarter, setQuarter] = useState('1')
  useEffect(() => {
    let active = true
    void (async () => {
      const repository = (await getStorageRuntime()).reviewKeepsakes
      const entries = await repository.list()
      const period = await repository.latestPeriod()
      if (active) { setArchive(entries); setLatest(period); setYear(String(period.year)); setQuarter(String(period.quarter)); setError('') }
    })().catch(() => { if (active) setError('Your reviews could not be loaded. Please reopen Reviews to try again.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh, invitation?.year, invitation?.quarter])
  const unopened = latest && !archive.some(entry => entry.facts.quarter.year === latest.year && entry.facts.quarter.quarter === latest.quarter)
  const years = [...new Set(archive.map(entry => entry.facts.quarter.year))]
  return <section className="reviews-page" aria-labelledby="reviews-title">
    <header className="reviews-heading"><p className="review-eyebrow">A reading life</p><h1 id="reviews-title">Reviews</h1><p>Your seasons in books, kept here.</p></header>
    {loading && <p role="status">Gathering your reading seasons…</p>}
    {error && <p role="alert">{error}</p>}
    {unopened && <section className="review-new" aria-label="Latest quarterly review">
      <div className="review-new-heading"><span className="review-eyebrow">Your latest season</span>{invitation && <span className="review-new-label">New</span>}</div>
      <h2>{quarterLabel(latest)}</h2><p>A moment to look back.<br />A little to take with you.</p>
      <button className="review-open" onClick={() => onOpen(latest)}>Open review <ArrowUpRight size={18} aria-hidden="true" /></button>
      {invitation && <button className="review-dismiss" aria-label="Dismiss quarterly invitation" onClick={() => {
        void getStorageRuntime().then(runtime => runtime.reviewKeepsakes.dismissInvitation(invitation)).then(onDismiss).catch(() => setError('Could not dismiss the invitation. Please try again.'))
      }}>Not now</button>}
    </section>}
    {years.map(year => <section key={year} className="review-year" aria-label={`${year} reviews`}><h2>{year}</h2>
      {archive.filter(entry => entry.facts.quarter.year === year).map(entry => {
        const genre = entry.identity.status === 'chosen' ? entry.identity.genre : null
        return <button className="review-season" key={entry.id} onClick={() => onOpen(entry.facts.quarter)}>
          <span className="review-season-art" aria-hidden="true">{genre ? <PathwayArtwork artwork={entry.artwork.pathways[genre]} /> : <BookOpen strokeWidth={1} />}</span>
          <span className="review-season-copy"><span className="review-season-date">{quarterLabel(entry.facts.quarter)}</span><span className="review-season-title">{genre ? pathways[genre].title : 'A quarter to keep'}</span><small>{entry.completedAt ? 'View keepsake' : 'Continue review'}</small></span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      })}
    </section>)}
    {!loading && !archive.length && <p className="review-archive-note">Your keepsakes will gather here, one quarter at a time.</p>}
    <details className="review-history"><summary>Looking for an earlier season?</summary>
      <form onSubmit={event => { event.preventDefault(); const details = event.currentTarget.parentElement; if (details instanceof HTMLDetailsElement) details.open = false; onOpen({ year: Number(year), quarter: Number(quarter) }) }}>
        <p>Open a completed quarter with recorded reading activity.</p>
        <div className="review-history-fields"><label>Year<input type="number" min="1900" max={latest?.year ?? new Date().getFullYear()} required value={year} onChange={event => setYear(event.target.value)} /></label>
          <label>Quarter<select aria-label="Quarter" value={quarter} onChange={event => setQuarter(event.target.value)}><option value="1">January–March</option><option value="2">April–June</option><option value="3">July–September</option><option value="4">October–December</option></select></label></div>
        <button className="review-open" disabled={loading}>Open quarter <ArrowUpRight size={18} aria-hidden="true" /></button>
      </form>
    </details>
  </section>
}

export function QuarterlyReviews({ period, reduced, onClose }: { period?: ReviewPeriod; reduced: boolean; onClose: () => void }) {
  const [repository, setRepository] = useState<ReviewKeepsakeRepository>()
  const [saved, setSaved] = useState<ReviewKeepsake>()
  const [fresh, setFresh] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void (async () => {
      const repo = (await getStorageRuntime()).reviewKeepsakes
      const selected = period ? { year: period.year, quarter: period.quarter } : await repo.latestPeriod()
      const isFresh = !await repo.get(selected)
      let entry = (await repo.open(selected, reviewArtwork)).keepsake
      // Resume legacy reveals directly in their collection, preserving all saved facts.
      if (entry.steps.find(step => step.id === entry.progress.stepId)?.kind === 'pathway' && entry.identity.status !== 'unselected') entry = await repo.complete(selected)
      if (active) { setRepository(repo); setSaved(entry); setFresh(isFresh) }
    })().catch(error => { if (active) setError(error instanceof Error ? error.message : 'The review could not be opened.') })
    return () => { active = false }
  }, [period])
  return <Sheet title="Quarterly review" onClose={onClose} tall>
    {saved && repository ? <ReviewViewer key={saved.id} initial={saved} fresh={fresh} repository={repository} reduced={reduced} onDone={onClose} />
      : <section className="quarterly-review">{error ? <p role="alert">{error}</p> : <p role="status">Opening your reading season…</p>}</section>}
  </Sheet>
}
