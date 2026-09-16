import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  shelfMotionTiming,
  type MotionMode,
  type ShelfMotionTiming,
} from '../design-system'
import type { LibraryBook, ShelfId } from '../library-model'

export type ShelfMotionEvent = {
  readonly sequence: number
  readonly bookId: string
  readonly from?: ShelfId
  readonly to?: ShelfId
}

export type ShelfRowMotion = 'idle' | 'erase' | 'write'

export type AnimatedShelfBook = {
  readonly book: LibraryBook
  readonly motion: ShelfRowMotion
}

export function shelfMotionDelays(
  event: ShelfMotionEvent | undefined,
  shelf: ShelfId,
  timing: ShelfMotionTiming,
) {
  const isSource = event?.from === shelf
  const isDestination = event?.to === shelf
  const crossesShelves = Boolean(event?.from && event.to && event.from !== event.to)

  return {
    eraseDelayMs: isSource ? timing.focusMs : 0,
    writeDelayMs: isDestination
      ? crossesShelves
        ? timing.focusMs + timing.eraseMs + timing.settleMs + timing.focusMs
        : timing.focusMs
      : 0,
  }
}

export function shouldAnimateShelfChange(wasReady: boolean, ready: boolean): boolean {
  return wasReady && ready
}

export function useAnimatedShelfBooks({
  books,
  shelf,
  event,
  motionMode,
  ready,
}: {
  readonly books: readonly LibraryBook[]
  readonly shelf: ShelfId
  readonly event?: ShelfMotionEvent
  readonly motionMode: MotionMode
  readonly ready: boolean
}) {
  const [displayedBooks, setDisplayedBooks] = useState<AnimatedShelfBook[]>(
    () => books.map((book) => ({ book, motion: 'idle' })),
  )
  const [animating, setAnimating] = useState(false)
  const displayedBooksRef = useRef(displayedBooks)
  const rowElementsRef = useRef(new Map<string, HTMLElement>())
  const previousPositionsRef = useRef<Map<string, DOMRect> | undefined>(undefined)
  const layoutAnimationCleanupsRef = useRef(new Map<string, () => void>())
  const generationRef = useRef(0)
  const readyRef = useRef(ready)
  const timing = shelfMotionTiming(motionMode)

  useLayoutEffect(() => {
    const previousPositions = previousPositionsRef.current
    previousPositionsRef.current = undefined
    if (!previousPositions || timing.settleMs === 0) return

    const movingRows: Array<{ bookId: string; element: HTMLElement }> = []
    for (const [bookId, element] of rowElementsRef.current) {
      const previous = previousPositions.get(bookId)
      if (!previous) continue
      const current = element.getBoundingClientRect()
      if (current.bottom < 0 || current.top > window.innerHeight) continue
      const deltaX = previous.left - current.left
      const deltaY = previous.top - current.top
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue

      layoutAnimationCleanupsRef.current.get(bookId)?.()
      element.style.transition = 'none'
      element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`
      element.style.willChange = 'transform'
      movingRows.push({ bookId, element })
    }

    if (!movingRows.length) return
    void movingRows[0].element.offsetHeight

    for (const { bookId, element } of movingRows) {
      let timer: number | undefined
      const frame = window.requestAnimationFrame(() => {
        element.style.transition = `transform ${timing.settleMs}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
        element.style.transform = 'translate3d(0, 0, 0)'
        timer = window.setTimeout(cleanup, timing.settleMs + 32)
      })
      const cleanup = () => {
        window.cancelAnimationFrame(frame)
        if (timer !== undefined) window.clearTimeout(timer)
        element.style.removeProperty('transition')
        element.style.removeProperty('transform')
        element.style.removeProperty('will-change')
        if (layoutAnimationCleanupsRef.current.get(bookId) === cleanup) {
          layoutAnimationCleanupsRef.current.delete(bookId)
        }
      }
      layoutAnimationCleanupsRef.current.set(bookId, cleanup)
    }
  })

  useEffect(() => {
    const layoutAnimationCleanups = layoutAnimationCleanupsRef.current
    return () => {
      for (const cleanup of layoutAnimationCleanups.values()) cleanup()
      layoutAnimationCleanups.clear()
    }
  }, [])

  useEffect(() => {
    const animationReady = shouldAnimateShelfChange(readyRef.current, ready)
    readyRef.current = ready
    const generation = ++generationRef.current
    let cancelled = false
    const timers = new Map<ReturnType<typeof setTimeout>, (active: boolean) => void>()
    // Other shelves often receive a new array after one book changes. Do not schedule
    // another React commit when their actual books and ordering are unchanged.
    if (displayedBooksRef.current.length === books.length
      && displayedBooksRef.current.every((entry, index) => entry.book === books[index] && entry.motion === 'idle')) {
      setAnimating(false)
      return
    }
    const targetBooks = [...books]
    const targetById = new Map(targetBooks.map((book) => [book.id, book]))
    const current = displayedBooksRef.current
    const currentIds = new Set(current.map(({ book }) => book.id))
    const orderChanged = current.length === targetBooks.length
      && current.some(({ book }, index) => book.id !== targetBooks[index]?.id)
    const removedIds = new Set(
      current.filter(({ book }) => !targetById.has(book.id)).map(({ book }) => book.id),
    )
    const addedIds = new Set(targetBooks.filter((book) => !currentIds.has(book.id)).map(({ id }) => id))

    const snapshotPositions = () => new Map(
      [...rowElementsRef.current].flatMap(([bookId, element]) => {
        const rect = element.getBoundingClientRect()
        return rect.bottom >= 0 && rect.top <= window.innerHeight ? [[bookId, rect] as const] : []
      }),
    )
    const replaceDisplayed = (next: AnimatedShelfBook[], animateLayout = false) => {
      if (animateLayout && timing.settleMs > 0) previousPositionsRef.current = snapshotPositions()
      else previousPositionsRef.current = undefined
      displayedBooksRef.current = next
      setDisplayedBooks(next)
    }
    const wait = (durationMs: number) => new Promise<boolean>((resolve) => {
      if (durationMs <= 0) {
        resolve(!cancelled)
        return
      }
      const timer = setTimeout(() => {
        timers.delete(timer)
        resolve(!cancelled)
      }, durationMs)
      timers.set(timer, resolve)
    })
    const isCurrent = () => !cancelled && generationRef.current === generation

    const run = async () => {
      if (!animationReady) {
        replaceDisplayed(targetBooks.map((book) => ({ book, motion: 'idle' })))
        setAnimating(false)
        return
      }

      if (!removedIds.size && !addedIds.size) {
        replaceDisplayed(targetBooks.map((book) => ({ book, motion: 'idle' })), orderChanged)
        setAnimating(false)
        return
      }

      setAnimating(true)
      if (timing.eraseMs === 0 && timing.writeMs === 0) {
        replaceDisplayed(targetBooks.map((book) => ({ book, motion: 'idle' })))
        if (isCurrent()) setAnimating(false)
        return
      }

      const startedAt = performance.now()
      const relevantEvent = event && (removedIds.has(event.bookId) || addedIds.has(event.bookId))
        ? event
        : undefined
      const delays = shelfMotionDelays(relevantEvent, shelf, timing)

      if (removedIds.size) {
        if (!await wait(delays.eraseDelayMs) || !isCurrent()) return
        replaceDisplayed(displayedBooksRef.current.map((entry) => ({
          book: targetById.get(entry.book.id) ?? entry.book,
          motion: removedIds.has(entry.book.id) ? 'erase' : 'idle',
        })))
        if (!await wait(timing.eraseMs) || !isCurrent()) return

        const retainedIds = new Set(
          displayedBooksRef.current
            .filter(({ book }) => !removedIds.has(book.id))
            .map(({ book }) => book.id),
        )
        replaceDisplayed(
          targetBooks
            .filter((book) => retainedIds.has(book.id))
            .map((book) => ({ book, motion: 'idle' })),
          true,
        )
        if (!await wait(timing.settleMs) || !isCurrent()) return
      }

      if (addedIds.size) {
        const elapsedMs = performance.now() - startedAt
        if (!await wait(Math.max(0, delays.writeDelayMs - elapsedMs)) || !isCurrent()) return
        replaceDisplayed(targetBooks.map((book) => ({
          book,
          motion: addedIds.has(book.id) ? 'write' : 'idle',
        })), true)
        if (!await wait(timing.writeMs) || !isCurrent()) return
        replaceDisplayed(targetBooks.map((book) => ({ book, motion: 'idle' })))
      } else if (!removedIds.size) {
        replaceDisplayed(targetBooks.map((book) => ({ book, motion: 'idle' })), true)
      }

      if (isCurrent()) setAnimating(false)
    }

    void run()
    return () => {
      cancelled = true
      for (const [timer, resolve] of timers) {
        clearTimeout(timer)
        resolve(false)
      }
      timers.clear()
    }
  }, [books, event, ready, shelf, timing])

  const setRowElement = (bookId: string, element: HTMLElement | null) => {
    if (element) rowElementsRef.current.set(bookId, element)
    else rowElementsRef.current.delete(bookId)
  }

  return { displayedBooks, animating, setRowElement }
}
