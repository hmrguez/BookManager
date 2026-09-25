import { useId, useState } from 'react'
import { BookOpen, ChevronDown } from 'lucide-react'
import type { LibraryBook } from '../library-model'
import { shelfCopy } from '../app/config'
import type { LibbyController } from './use-libby'
import { LibbyMetadata } from './LibbyMetadata'
import './libby.css'

/** The book is fixed here; the reader chooses its captured Libby edition. */
export function LibbyBookLink({ book, controller: c, onSettings }: {
  book: LibraryBook
  controller: LibbyController
  onSettings: () => void
}) {
  const id = useId()
  const [selection, setSelection] = useState('')
  const mapping = c.state.mappings.find(entry => entry.bookId === book.id)
  const linkedItem = c.state.items.find(item => item.key === mapping?.key)
  const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim()
  const available = c.state.items.filter(item => item.status === 'pending' && !c.state.mappings.some(entry => entry.key === item.key))
    .sort((a, b) => Number(normalized(b.observation.title) === normalized(book.title)) - Number(normalized(a.observation.title) === normalized(book.title)) || a.observation.title.localeCompare(b.observation.title))
  // Include the snapshot ID so an arriving capture requires a fresh choice.
  const selected = mapping ? (linkedItem?.status === 'pending' ? linkedItem : undefined)
    : available.find(item => `${item.key}/${item.snapshotId}` === selection)
  const needsReview = mapping && (mapping.paused || selected || book.shelf !== 'reading' || book.lastUpdatedAt !== mapping.baseline)
  const status = !c.ready ? 'Loading connection…' : mapping ? needsReview ? 'Review to resume progress updates' : c.state.automatic ? 'Progress follows Libby web' : 'Automatic updates are off'
    : 'Connect this book to your web Shelf'
  return <details className="libby-book-link">
    <summary className="libby-summary"><BookOpen size={20} aria-hidden="true" /><span><strong>{mapping ? 'Linked to Libby' : 'Link to Libby'}</strong><small>{status}</small></span><ChevronDown className="libby-chevron" size={18} aria-hidden="true" /></summary>
    <div className="libby-book-link-body">
      {c.error && <p className="libby-error" role="alert">{c.error}</p>}
      {!c.state.enabled ? <><p className="libby-caption">Connect Safari or Quetta once to receive your Libby books and web reading progress.</p><button type="button" onClick={onSettings}>Set up Libby</button></>
        : <>
          {mapping ? <p className="libby-caption" role="status">{linkedItem ? `${linkedItem.observation.title} · ${linkedItem.observation.format === 'audiobook' ? 'Audiobook' : 'Ebook'}` : 'This book is linked to Libby.'}</p>
            : available.length ? <div className="libby-book-picker"><label htmlFor={id}>Book in Libby</label><select id={id} value={selected ? selection : ''} disabled={!c.ready || c.busy} onChange={event => setSelection(event.target.value)}>
              <option value="">Choose a Libby book</option>{available.map(item => <option key={item.key} value={`${item.key}/${item.snapshotId}`}>{item.observation.title} · {item.observation.author} · {item.observation.format === 'audiobook' ? 'Audiobook' : 'Ebook'} · {item.observation.percent}%</option>)}
            </select></div>
              : <p className="libby-caption">No unlinked loans are ready yet. Visit your Libby web Shelf, then return here. If a loan is linked to another book, unlink it in Libby settings first.</p>}
          {selected && <div className="libby-book-review">
            <p className="libby-caption">{selected.reason} Captured {new Date(selected.capturedAt).toLocaleString()}.</p>
            <p>Wovenleaf {book.progress}% → Libby {selected.observation.percent}%</p>
            {book.shelf !== 'reading' && <p className="libby-caption">This moves your existing book from {shelfCopy[book.shelf].label} to Reading. Your notes, rating, page markers and cover stay.</p>}
            <button type="button" className="libby-primary" disabled={!c.ready || c.busy} onClick={() => void c.apply(selected.key, selected.snapshotId, book.id, book.lastUpdatedAt, book.shelf !== 'reading')}>
              {book.shelf !== 'reading' ? 'Move to Reading & link' : mapping ? 'Apply progress & resume' : 'Link & apply progress'}
            </button>
            <p className="libby-caption">Undo is available in Settings → Libby → Recent updates.</p>
          </div>}
          {mapping && needsReview && !selected && <p className="libby-caption">Visit your Libby web Shelf to receive a fresh capture, then review it here.</p>}
          <LibbyMetadata book={book} controller={c} />
          <div className="libby-book-actions">{mapping && <button type="button" disabled={c.busy} onClick={() => void c.unlink(mapping.key)}>Unlink from Libby</button>}<button type="button" onClick={onSettings}>Libby settings</button></div>
        </>}
    </div>
  </details>
}
