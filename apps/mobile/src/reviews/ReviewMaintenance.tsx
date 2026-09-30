import { t, translateCopy, useLanguage } from '../localization'
import { useEffect, useRef, useState } from 'react'
import type { ReviewKeepsake } from './keepsake-model'
import type { ReviewKeepsakeRepository } from './keepsake-repository'
import type { ReviewUpdatePreview } from './updates'
import { badgeFact, pathways } from './presentation'

export function ReviewMaintenance({ saved, repository, onUpdated, onDeleted, onPause }: {
  saved: ReviewKeepsake; repository: ReviewKeepsakeRepository; onUpdated: (saved: ReviewKeepsake) => void; onDeleted: () => void; onPause: () => void
}) {
  useLanguage()
  const [candidate, setCandidate] = useState<ReviewUpdatePreview | null>(null)
  const [preview, setPreview] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (preview) return
    let active = true
    const check = () => { void repository.previewUpdate({ year: saved.facts.quarter.year, quarter: saved.facts.quarter.quarter }).then(value => { if (active) setCandidate(value) }).catch(() => { if (active) setMessage(t("Could not check for review updates. Reopen this review to retry.")) }) }
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
        setMessage(result.preview ? t("Your history changed again. Review the refreshed preview, then apply again.") : t("Your saved review is already up to date."))
      } else { setPreview(false); setCandidate(null); setMessage(t("Review updated.")); onUpdated(result.entry.keepsake) }
    } catch { setMessage(t("The update could not be saved. Your previous review is safe. Try again.")) }
    finally { setBusy(false) }
  }
  return <aside className="review-maintenance" aria-label={t("Saved review options")} aria-busy={busy}>
    {message && <p role="status">{message}</p>}
    {candidate && !preview && <p>{t("Your reading history has changed.")}<button className="review-quiet" onClick={() => { onPause(); setPreview(true) }}>{t("Update review")}</button></p>}
    {preview && candidate && <section className="review-update-preview" aria-label={t("Review update preview")}>
      <h3 ref={heading} tabIndex={-1}>{t("A fresh look at this season")}</h3>
      <p>{t("Compare your saved achievements with the proposed update. Your chosen pathway stays yours.")}</p>
      <div className="review-update-columns">{(['before', 'after'] as const).map(side => <div key={side}><h4>{side === 'before' ? t("Saved review") : t("After update")}</h4>
        {candidate[side].earned.length ? candidate[side].earned.map(badge => <p key={badge.id}><strong>{translateCopy(badge.name)}</strong><br />{badgeFact(badge)} {t(" · Milestone")}{badge.tier}{badge.personalBest ? t(" · Your best recorded quarter") : ''}
          {badge.comparisons.length > 0 && <small>{badge.comparisons.map(c => t("{{v0}} Q{{v1}}: {{v2}} {{v3}}", { v0: c.quarter.year, v1: c.quarter.quarter, v2: c.value, v3: badge.unit })).join('; ')}</small>}</p>) : <p>{t("No earned badges. A moment to reflect.")}</p>}
        <p>{t("Highlights:")}{candidate[side].revealIds.map(id => candidate[side].earned.find(b => b.id === id)?.name).map(name => translateCopy(name ?? '')).join(' → ') || t("Quiet reflection")}</p>
        <p>{t("Suggested pathway:")}{candidate[side].genre.suggested ? translateCopy(pathways[candidate[side].genre.suggested].title) : t("Your choice")}</p>
        <details><summary>{t("Supporting books and facts")}</summary>{candidate[side].supportingBooks.map(book => <p key={book.workId}>{book.title}{book.editions.map(e => t(" · {{v0}}{{v1}}", { v0: e.title, v1: e.pageCount ? t(" ({{v0}} pages)", { v0: e.pageCount }) : '' })).join('')}</p>)}</details>
      </div>)}</div>
      <div className="review-actions"><button className="review-primary" disabled={busy} onClick={() => void apply()}>{t("Apply update")}</button><button disabled={busy} onClick={() => setPreview(false)}>{t("Keep saved review")}</button></div>
    </section>}
    <details><summary>{t("Manage this keepsake")}</summary><button disabled={busy} onClick={() => { onPause(); setDeleting(true) }}>{t("Delete review")}</button></details>
    {deleting && <section className="review-update-preview" aria-label={t("Delete review confirmation")}><h3 ref={heading} tabIndex={-1}>{t("Delete this keepsake?")}</h3><p>{t("Your reading history stays. You can recreate the review later, and we won’t invite you again.")}</p>
      <button disabled={busy} onClick={() => { setBusy(true); void repository.delete({ year: saved.facts.quarter.year, quarter: saved.facts.quarter.quarter }).then(onDeleted).catch(() => setMessage(t("Could not delete this review. Please try again."))).finally(() => setBusy(false)) }}>{t("Delete saved review")}</button><button disabled={busy} onClick={() => setDeleting(false)}>{t("Keep review")}</button>
    </section>}
  </aside>
}
