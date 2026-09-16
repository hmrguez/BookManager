export const REVEAL_EVENT = 'library-reveal-book'

export function revealShelfBook(shelf: string, bookId: string) {
  const section = document.getElementById(`shelf-${shelf}`)
  const book = section?.querySelector<HTMLElement>(`[data-library-book="${CSS.escape(bookId)}"]`)
  if (book) {
    const rect = book.getBoundingClientRect()
    if (rect.top < 0 || rect.bottom > window.innerHeight) book.scrollIntoView({ block: 'center', behavior: 'instant' })
  } else section?.querySelector('header')?.scrollIntoView({ block: 'start', behavior: 'instant' })
  window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: { shelf: `shelf-${shelf}`, bookId } }))
}

