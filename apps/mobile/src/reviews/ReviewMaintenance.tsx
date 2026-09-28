import { useEffect, useRef, useState } from 'react'
import type { ReviewKeepsake } from './keepsake-model'
import type { ReviewKeepsakeRepository } from './keepsake-repository'
import type { ReviewUpdatePreview } from './updates'
import { badgeFact, pathways } from './presentation'

export function ReviewMaintenance({ saved, repository, onUpdated, onDeleted, onPause }: {
  saved: ReviewKeepsake; repository: ReviewKeepsakeRepository; onUpdated: (saved: ReviewKeepsake) => void; onDeleted: () => void; onPause: () => void
}) {
  const [candidate, setCandidate] = useState<ReviewUpdatePreview | null>(null)
  const [preview, setPreview] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (preview) return
    let active = true
    const check = () => { void repository.previewUpdate({ year: saved.facts.quarter.year, quarter: saved.facts.quarter.quarter }).then(value => { if (active) setCandidate(value) }).catch(() => { if (active) setMessage('Could not check for review updates. Reopen this review to retry.') }) }
    check()
    window.addEventListener('focus', check)
    return () => { active = false; window.removeEventListener('focus', check) }
  }, [repository, saved.facts, preview])
  useEffect(() => { if (preview || deleting) heading.current?.focus() }, [preview, deleting])
  async function apply() {
    if (!candidate || busy) return
    setBusy(true)
    try {
      const result = await repository.applyUpdate({ year: saved.facts.quarter.year, quarter: saved.facts.quarter.quarter }, candidate.token)
      if (result.status === 'stale') {
        setCandidate(result.preview)
        if (!result.preview) { setPreview(false); onUpdated(result.entry.keepsake) }
        setMessage(result.preview ? 'Your history changed again. Review the refreshed preview, then apply again.' : 'Your saved review is already up to date.')
      } else { setPreview(false); setCandidate(null); setMessage('Review updated.'); onUpdated(result.entry.keepsake) }
    } catch { setMessage('The update could not be saved. Your previous review is safe. Try again.') }
    finally { setBusy(false) }
  }
  return <aside className="review-maintenance" aria-label="Saved review options" aria-busy={busy}>
    {message && <p role="status">{message}</p>}
    {candidate && !preview && <p>Your reading history has changed. <button className="review-quiet" onClick={() => { onPause(); setPreview(true) }}>Update review</button></p>}
    {preview && candidate && <section className="review-update-preview" aria-label="Review update preview">
      <h3 ref={heading} tabIndex={-1}>A fresh look at this season</h3>
      <p>Compare your saved achievements with the proposed update. Your chosen pathway stays yours.</p>
      <div className="review-update-columns">{(['before', 'after'] as const).map(side => <div key={side}><h4>{side === 'before' ? 'Saved review' : 'After update'}</h4>
        {candidate[side].earned.length ? candidate[side].earned.map(badge => <p key={badge.id}><strong>{badge.name}</strong><br />{badgeFact(badge)} · Milestone {badge.tier}{badge.personalBest ? ' · Your best recorded quarter' : ''}
          {badge.comparisons.length > 0 && <small>{badge.comparisons.map(c => `${c.quarter.year} Q${c.quarter.quarter}: ${c.value} ${badge.unit}`).join('; ')}</small>}</p>) : <p>No earned badges. A moment to reflect.</p>}
        <p>Highlights: {candidate[side].revealIds.map(id => candidate[side].earned.find(b => b.id === id)?.name).join(' → ') || 'Quiet reflection'}</p>
        <p>Suggested pathway: {candidate[side].genre.suggested ? pathways[candidate[side].genre.suggested].title : 'Your choice'}</p>
        <details><summary>Supporting books and facts</summary>{candidate[side].supportingBooks.map(book => <p key={book.workId}>{book.title}{book.editions.map(e => ` · ${e.title}${e.pageCount ? ` (${e.pageCount} pages)` : ''}`).join('')}</p>)}</details>
      </div>)}</div>
      <div className="review-actions"><button className="review-primary" disabled={busy} onClick={() => void apply()}>Apply update</button><button disabled={busy} onClick={() => setPreview(false)}>Keep saved review</button></div>
    </section>}
    <details><summary>Manage this keepsake</summary><button disabled={busy} onClick={() => { onPause(); setDeleting(true) }}>Delete review</button></details>
    {deleting && <section className="review-update-preview" aria-label="Delete review confirmation"><h3 ref={heading} tabIndex={-1}>Delete this keepsake?</h3><p>Your reading history stays. You can recreate the review later, and we won’t invite you again.</p>
      <button disabled={busy} onClick={() => { setBusy(true); void repository.delete({ year: saved.facts.quarter.year, quarter: saved.facts.quarter.quarter }).then(onDeleted).catch(() => setMessage('Could not delete this review. Please try again.')).finally(() => setBusy(false)) }}>Delete saved review</button><button disabled={busy} onClick={() => setDeleting(false)}>Keep review</button>
    </section>}
  </aside>
}
