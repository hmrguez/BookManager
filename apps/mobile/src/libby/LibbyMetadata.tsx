import { t, useLanguage } from '../localization'
import { useId, useState } from 'react'
import type { LibraryBook } from '../library-model'
import { exactEditionMatch } from './enrichment-model'
import type { LibbyController } from './use-libby'

export function LibbyMetadata({ book, controller: c }: { book: LibraryBook; controller: LibbyController }) {
  useLanguage()
  const id = useId()
  const [selected, setSelected] = useState('')
  const job = c.state.enrichment.find(job => job.bookId === book.id)
  if (!job || job.status === 'dismissed') return null
  const candidate = job.candidates.find(candidate => `${job.id}/${candidate.id}` === selected)
  return <section className="libby-metadata" aria-labelledby={id}>
    <h4 id={id}>{t("Book details")}</h4>
    {job.status === 'review' ? <>
      <p className="libby-caption">{t("Open Library found a possible match. Confirm the work to add its subjects. Your title, tags and reading progress stay as they are.")}</p>
      <label htmlFor={`${id}-match`}>{t("Matching book")}</label>
      <select id={`${id}-match`} value={candidate ? selected : ''} disabled={c.busy} onChange={event => setSelected(event.target.value)}>
        <option value="">{t("Choose a match")}</option>
        {job.candidates.map(variant => <option key={variant.id} value={`${job.id}/${variant.id}`}>{variant.workTitle} · {variant.authors.join(', ')} · {exactEditionMatch(book, variant) ? variant.medium : t("Work subjects only")}{variant.publisher ? t(" · {{v0}}", { v0: variant.publisher }) : ''}</option>)}
      </select>
      {candidate && <p className="libby-caption">{exactEditionMatch(book, candidate) ? t("Verified edition. Missing compatible details can also be added.") : t("Edition is unverified. Pages, cover and edition identifiers will stay unchanged.")}</p>}
      {candidate && <div className="libby-caption">
        <p>{candidate.subjects?.flatMap(claim => claim.values).slice(0, 6).join(' · ') || t("No subjects listed.")}</p>
        {candidate.workKey && /^OL\d+W$/.test(candidate.workKey) && <a href={`https://openlibrary.org/works/${candidate.workKey}`} target="_blank" rel="noreferrer">{t("Review this work on Open Library")}</a>}
      </div>}
      <div className="libby-book-actions"><button type="button" disabled={c.busy || !candidate} onClick={() => candidate && void c.chooseMetadata(job.id, candidate.id)}>{t("Use this match")}</button><button type="button" disabled={c.busy} onClick={() => void c.chooseMetadata(job.id, null)}>{t("Keep current details")}</button></div>
    </> : <p className="libby-caption" role="status">{job.status === 'applied' ? t("Details saved from Open Library.") : job.status === 'no-match' ? t("No matching details found. You can keep reading as usual.") : job.attempts >= 3 ? t("Book details are unavailable. Your reading is still saved.") : t("Book details will be checked when the catalog is available.")}</p>}
    {['retry', 'no-match'].includes(job.status) && <button type="button" disabled={c.busy} onClick={() => void c.retryMetadata(job.id)}>{t("Check book details again")}</button>}
  </section>
}
