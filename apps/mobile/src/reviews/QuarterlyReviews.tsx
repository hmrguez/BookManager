import { useEffect, useState } from 'react'
import { App } from '@capacitor/app'
import { getStorageRuntime } from '../storage/runtime'
import { Sheet } from '../app/components/Sheet'
import type { ReviewKeepsakeRepository } from './keepsake-repository'
import type { ReviewKeepsake, ReviewPeriod } from './keepsake-model'
import { ReviewViewer } from './ReviewViewer'
import { quarterLabel, reviewArtwork } from './presentation'
import './reviews.css'

export function ReviewLibraryEntry({ ready, refresh, onOpen }: { ready: boolean; refresh: unknown; onOpen: (period?: ReviewPeriod) => void }) {
  const [invitation, setInvitation] = useState<ReviewPeriod | null>(null)
  const [dismissError, setDismissError] = useState(false)
  useEffect(() => {
    let active = true
    const refreshInvitation = () => {
      if (ready) void getStorageRuntime().then(runtime => runtime.reviewKeepsakes.invitation()).then(period => { if (active) setInvitation(period ? { year: period.year, quarter: period.quarter } : null) }).catch(() => {})
    }
    refreshInvitation()
    const listener = App.addListener('appStateChange', ({ isActive }) => { if (isActive) refreshInvitation() })
    return () => { active = false; void listener.then(handle => handle.remove()) }
  }, [ready, refresh])
  return <aside className="review-library-entry" aria-label="Quarterly reading reviews">
    {invitation && <div className="review-invitation"><div><p>There’s a quarterly review for you.</p><small>{quarterLabel(invitation)}</small></div>
      <button type="button" onClick={() => onOpen(invitation)}>Open review</button>
      <button type="button" className="review-quiet" aria-label="Dismiss quarterly invitation" onClick={() => {
        void getStorageRuntime().then(runtime => runtime.reviewKeepsakes.dismissInvitation(invitation)).then(() => { setInvitation(null); setDismissError(false) }).catch(() => setDismissError(true))
      }}>Dismiss</button></div>}
    {dismissError && <p role="alert">Could not dismiss the invitation. Please try again.</p>}
    <button type="button" className="review-archive-link" onClick={() => onOpen()}>Quarterly reviews <span aria-hidden="true">↗︎</span></button>
  </aside>
}

export function QuarterlyReviews({ period, reduced, onClose }: { period?: ReviewPeriod; reduced: boolean; onClose: () => void }) {
  const [repository, setRepository] = useState<ReviewKeepsakeRepository>()
  const [saved, setSaved] = useState<ReviewKeepsake>()
  const [fresh, setFresh] = useState(false)
  const [archive, setArchive] = useState<ReviewKeepsake[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [quarter, setQuarter] = useState('1')
  useEffect(() => {
    let active = true
    void (async () => {
      const repo = (await getStorageRuntime()).reviewKeepsakes
      const entries = await repo.list()
      const isFresh = period ? !await repo.get(period) : false
      const entry = period ? await repo.open(period, reviewArtwork) : undefined
      if (active) { setRepository(repo); setArchive(entries); setSaved(entry?.keepsake); setFresh(isFresh) }
    })().catch(error => { if (active) setError(error instanceof Error ? error.message : 'The review could not be opened.') })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [period])
  async function open(selected: ReviewPeriod) {
    if (!repository || busy) return
    selected = { year: selected.year, quarter: selected.quarter }
    setBusy(true); setError('')
    try { const isFresh = !await repository.get(selected); setSaved((await repository.open(selected, reviewArtwork)).keepsake); setFresh(isFresh) }
    catch (error) { setError(error instanceof Error ? error.message : 'The review could not be opened. Please try again.') }
    finally { setBusy(false) }
  }
  return <Sheet title="Quarterly reviews" onClose={onClose} tall>
    {saved && repository ? <ReviewViewer key={saved.id} initial={saved} fresh={fresh} repository={repository} reduced={reduced} onDone={onClose} />
      : <section className="quarterly-review review-archive">
        <p className="review-eyebrow">Your reading seasons</p><h3>A little of every quarter.</h3><p>Revisit a keepsake, or reflect on an earlier season.</p>
        {busy && <p role="status">Opening your saved reading seasons…</p>}
        {error && <p role="alert">{error}</p>}
        {archive.map(entry => <button key={entry.id} disabled={busy} onClick={() => void open(entry.facts.quarter)}>{quarterLabel(entry.facts.quarter)}<small>{entry.completedAt ? 'View keepsake' : 'Continue review'}</small></button>)}
        <form onSubmit={event => { event.preventDefault(); void open({ year: Number(year), quarter: Number(quarter) }) }}>
          <h4>Open a quarter</h4><p>Earlier quarters are available when your recorded history supports a reflection.</p>
          <div className="review-controls"><label>Year<input type="number" min="1900" max={new Date().getFullYear()} required value={year} onChange={event => setYear(event.target.value)} /></label>
            <label>Quarter<select aria-label="Quarter" value={quarter} onChange={event => setQuarter(event.target.value)}><option value="1">January–March</option><option value="2">April–June</option><option value="3">July–September</option><option value="4">October–December</option></select></label></div>
          <button className="review-primary" disabled={busy || !repository}>Open review</button>
        </form>
      </section>}
  </Sheet>
}
