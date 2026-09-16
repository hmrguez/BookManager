import { useEffect, useRef, useState, type RefObject } from 'react'
import { SHELVES, type LibraryBook, type ShelfId } from '../library'
import { tw } from '../tailwind/styles'

export type LibraryDropTarget =
  | { kind: 'status'; id: ShelfId; beforeBookId?: string }
  | { kind: 'custom'; id: string; beforeBookId?: string }

/** Both shelf headers and navigation pills remain targets when a shelf is collapsed. */
export function libraryDropTarget(kind: LibraryDropTarget['kind'], id: string, label: string) {
  return { 'data-library-drop': `${kind}:${id}`, 'data-drop-label': label }
}

export function useLibraryDrag(
  root: RefObject<HTMLDivElement | null>,
  books: readonly LibraryBook[],
  onDrop: (bookId: string, target: LibraryDropTarget) => void,
) {
  const latest = useRef({ books, onDrop })
  useEffect(() => { latest.current = { books, onDrop } }, [books, onDrop])
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    const container = root.current
    if (!container) return
    let source: HTMLElement | undefined
    let bookId: string | undefined
    let target: HTMLElement | undefined
    let preview: HTMLElement | undefined
    let holdTimer: number | undefined
    let frame = 0
    let active = false
    let suppressClickUntil = 0
    let point = { x: 0, y: 0 }
    let origin = point

    const bookElement = (node: EventTarget | null) => node instanceof Element
      ? node.closest<HTMLElement>('[data-library-book]') : null
    const highlight = () => {
      const hit = document.elementFromPoint(point.x, point.y)
      const next = hit?.closest<HTMLElement>('[data-library-drop]')
      const valid = next && container.contains(next) ? next : undefined
      if (target !== valid) {
        target?.removeAttribute('data-drop-active')
        target = valid
        target?.setAttribute('data-drop-active', '')
        if (target) setAnnouncement(`Release to place in ${target.dataset.dropLabel}.`)
      }
      return hit
    }
    const stop = () => {
      window.clearTimeout(holdTimer)
      window.cancelAnimationFrame(frame)
      holdTimer = undefined
      target?.removeAttribute('data-drop-active')
      source?.removeAttribute('data-book-dragging')
      preview?.remove()
      container.removeAttribute('data-library-dragging')
      if (active) suppressClickUntil = Date.now() + 450
      active = false
      bookId = undefined
      source = target = preview = undefined
    }
    const tick = () => {
      if (!active) return
      const edge = 72
      const delta = point.y < edge ? -Math.ceil((edge - point.y) / 7)
        : point.y > window.innerHeight - edge ? Math.ceil((point.y - window.innerHeight + edge) / 7) : 0
      if (delta) {
        window.scrollBy({ top: delta, behavior: 'instant' })
        highlight()
      }
      frame = window.requestAnimationFrame(tick)
    }
    const start = (element: HTMLElement, touch: boolean) => {
      const book = latest.current.books.find(({ id }) => id === element.dataset.libraryBook)
      if (!book) return false
      source = element
      bookId = book.id
      active = true
      source.setAttribute('data-book-dragging', '')
      container.setAttribute('data-library-dragging', '')
      setAnnouncement(`${book.title} picked up. Drop on a shelf. Press Escape to cancel.`)
      if (touch) {
        preview = (element.querySelector('.book-cover') ?? element).cloneNode(true) as HTMLElement
        preview.className += ` ${tw('library-drag-preview')}`
        preview.setAttribute('aria-hidden', 'true')
        preview.style.width = `${element.querySelector('.book-cover')?.getBoundingClientRect().width ?? 80}px`
        preview.style.height = `${element.querySelector('.book-cover')?.getBoundingClientRect().height ?? 112}px`
        document.body.append(preview)
        preview.style.left = `${point.x}px`
        preview.style.top = `${point.y}px`
      }
      frame = window.requestAnimationFrame(tick)
      return true
    }
    const drop = () => {
      const hit = highlight()
      const destination = target?.dataset.libraryDrop
      if (bookId && destination) {
        const separator = destination.indexOf(':')
        const kind = destination.slice(0, separator)
        const id = destination.slice(separator + 1)
        const beforeBookId = bookElement(hit)?.dataset.libraryBook
        if (kind === 'custom') latest.current.onDrop(bookId, { kind, id, beforeBookId })
        else if (kind === 'status' && SHELVES.some((shelf) => shelf.id === id)) {
          latest.current.onDrop(bookId, { kind, id: id as ShelfId, beforeBookId })
        }
        setAnnouncement(`Placed in ${target?.dataset.dropLabel}.`)
      } else if (active) setAnnouncement('Move cancelled.')
      stop()
    }
    const dragStart = (event: DragEvent) => {
      const element = bookElement(event.target)
      if (!element || !event.dataTransfer) return
      point = { x: event.clientX, y: event.clientY }
      if (!start(element, false)) { event.preventDefault(); return }
      event.dataTransfer.effectAllowed = 'copyMove'
      event.dataTransfer.setData('application/x-wovenleaf-book', bookId!)
      event.dataTransfer.setDragImage(element, 20, 20)
    }
    const dragOver = (event: DragEvent) => {
      if (!active) return
      point = { x: event.clientX, y: event.clientY }
      highlight()
      if (target) {
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = target.dataset.libraryDrop?.startsWith('custom:') ? 'copy' : 'move'
      }
    }
    const dragDrop = (event: DragEvent) => {
      if (!active) return
      event.preventDefault()
      point = { x: event.clientX, y: event.clientY }
      drop()
    }
    const touchStart = (event: TouchEvent) => {
      stop()
      const element = bookElement(event.target)
      if (!element || event.touches.length !== 1) return
      point = origin = { x: event.touches[0].clientX, y: event.touches[0].clientY }
      holdTimer = window.setTimeout(() => { start(element, true) }, 350)
    }
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) { stop(); return }
      point = { x: event.touches[0].clientX, y: event.touches[0].clientY }
      if (!active) {
        if (Math.hypot(point.x - origin.x, point.y - origin.y) > 8) window.clearTimeout(holdTimer)
        return
      }
      event.preventDefault()
      if (preview) {
        preview.style.left = `${point.x}px`
        preview.style.top = `${point.y}px`
      }
      highlight()
    }
    const touchEnd = (event: TouchEvent) => {
      if (active) { event.preventDefault(); drop() }
      else stop()
    }
    const click = (event: MouseEvent) => {
      if (bookElement(event.target) && Date.now() < suppressClickUntil) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const contextMenu = (event: MouseEvent) => {
      if (active || holdTimer !== undefined) event.preventDefault()
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { stop(); setAnnouncement('Move cancelled.') }
    }
    container.addEventListener('dragstart', dragStart)
    container.addEventListener('touchstart', touchStart, { passive: true })
    container.addEventListener('click', click, true)
    container.addEventListener('contextmenu', contextMenu)
    document.addEventListener('dragover', dragOver)
    document.addEventListener('drop', dragDrop)
    document.addEventListener('dragend', stop)
    document.addEventListener('touchmove', touchMove, { passive: false })
    document.addEventListener('touchend', touchEnd, { passive: false })
    document.addEventListener('touchcancel', stop)
    document.addEventListener('keydown', keyDown)
    window.addEventListener('blur', stop)
    return () => {
      stop()
      container.removeEventListener('dragstart', dragStart)
      container.removeEventListener('touchstart', touchStart)
      container.removeEventListener('click', click, true)
      container.removeEventListener('contextmenu', contextMenu)
      document.removeEventListener('dragover', dragOver)
      document.removeEventListener('drop', dragDrop)
      document.removeEventListener('dragend', stop)
      document.removeEventListener('touchmove', touchMove)
      document.removeEventListener('touchend', touchEnd)
      document.removeEventListener('touchcancel', stop)
      document.removeEventListener('keydown', keyDown)
      window.removeEventListener('blur', stop)
    }
  }, [root])
  return announcement
}
