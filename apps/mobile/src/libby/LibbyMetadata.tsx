import { useId, useState } from 'react'
import type { LibraryBook } from '../library-model'
import { exactEditionMatch } from './enrichment-model'
import type { LibbyController } from './use-libby'

export function LibbyMetadata({ book, controller: c }: { book: LibraryBook; controller: LibbyController }) {
  const id = useId()
  const [selected, setSelected] = useState('')
  const job = c.state.enrichment.find(job => job.bookId === book.id)
  if (!job || job.status === 'dismissed') return null
  const candidate = job.candidates.find(candidate => `${job.id}/${candidate.id}` === selected)
  return <section className="libby-metadata" aria-labelledby={id}>
    <h4 id={id}>Book details</h4>
    {job.status === 'review' ? <>
      <p className="libby-caption">Open Library found a possible match. Confirm the work to add its subjects. Your title, tags and reading progress stay as they are.</p>
      <label htmlFor={`${id}-match`}>Matching book</label>
      <select id={`${id}-match`} value={candidate ? selected : ''} disabled={c.busy} onChange={event => setSelected(event.target.value)}>
        <option value="">Choose a match</option>
        {job.candidates.map(variant => <option key={variant.id} value={`${job.id}/${variant.id}`}>{variant.workTitle} · {variant.authors.join(', ')} · {exactEditionMatch(book, variant) ? variant.medium : 'Work subjects only'}{variant.publisher ? ` · ${variant.publisher}` : ''}</option>)}
      </select>
      {candidate && <p className="libby-caption">{exactEditionMatch(book, candidate) ? 'Verified edition. Missing compatible details can also be added.' : 'Edition is unverified. Pages, cover and edition identifiers will stay unchanged.'}</p>}
      {candidate && <div className="libby-caption">
        <p>{candidate.subjects?.flatMap(claim => claim.values).slice(0, 6).join(' · ') || 'No subjects listed.'}</p>
        {candidate.workKey && /^OL\d+W$/.test(candidate.workKey) && <a href={`https://openlibrary.org/works/${candidate.workKey}`} target="_blank" rel="noreferrer">Review this work on Open Library</a>}
      </div>}
      <div className="libby-book-actions"><button type="button" disabled={c.busy || !candidate} onClick={() => candidate && void c.chooseMetadata(job.id, candidate.id)}>Use this match</button><button type="button" disabled={c.busy} onClick={() => void c.chooseMetadata(job.id, null)}>Keep current details</button></div>
    </> : <p className="libby-caption" role="status">{job.status === 'applied' ? 'Details saved from Open Library.' : job.status === 'no-match' ? 'No matching details found. You can keep reading as usual.' : job.attempts >= 3 ? 'Book details are unavailable. Your reading is still saved.' : 'Book details will be checked when the catalog is available.'}</p>}
    {['retry', 'no-match'].includes(job.status) && <button type="button" disabled={c.busy} onClick={() => void c.retryMetadata(job.id)}>Check book details again</button>}
  </section>
}
