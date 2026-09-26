import { Notebook, BookOpen, Library, Plus, Settings } from 'lucide-react'
import type { ShelfId } from '../../library'
import { tw } from '../../tailwind/styles'
import type { AppView } from '../model'

export function BottomNavigation({
  view,
  onLibrary,
  onShelf,
  onAdd,
  onSettings,
  onReviews,
  hasNewReview,
}: {
  view: AppView
  onLibrary: () => void
  onShelf: (shelf: ShelfId) => void
  onAdd: () => void
  onSettings: () => void
  onReviews: () => void
  hasNewReview: boolean
}) {
  return (
    <nav className={tw('bottom-nav')} aria-label="App shortcuts">
      <button
        className={tw(view === 'library' ? 'is-active' : '')}
        type="button"
        onClick={onLibrary}
        aria-current={view === 'library' ? 'page' : undefined}
      >
        <Library aria-hidden="true" /><span>My Books</span>
      </button>
      <button type="button" onClick={() => onShelf('reading')}>
        <BookOpen aria-hidden="true" /><span>Reading</span>
      </button>
      <button className={tw('bottom-nav__add')} type="button" onClick={onAdd}>
        <Plus aria-hidden="true" /><span>Add Book</span>
      </button>
      <button type="button" onClick={onReviews} aria-label="Reviews" className={tw(view === 'reviews' ? 'is-active' : '')} aria-current={view === 'reviews' ? 'page' : undefined} aria-describedby={hasNewReview ? 'new-review-notice' : undefined}>
        <span className="review-nav-icon"><Notebook aria-hidden="true" />{hasNewReview && <span className="review-nav-dot" aria-hidden="true" />}</span><span>Reviews</span>
        {hasNewReview && <span id="new-review-notice" className="review-sr-only">New quarterly review available</span>}
      </button>
      <button
        className={tw(view === 'settings' ? 'is-active' : '')}
        type="button"
        onClick={onSettings}
        aria-current={view === 'settings' ? 'page' : undefined}
      >
        <Settings aria-hidden="true" /><span>Settings</span>
      </button>
    </nav>
  )
}
