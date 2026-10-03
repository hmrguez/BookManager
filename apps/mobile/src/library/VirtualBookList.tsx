import { defaultRangeExtractor, useWindowVirtualizer } from '@tanstack/react-virtual'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { tw } from '../tailwind/styles'
import { REVEAL_EVENT } from './reveal-book'

export type BookListGroup<T> = { key: string; items: readonly T[]; header?: ReactNode }
type BookRow<T> = { key: string; items: readonly T[]; start: number; header?: ReactNode }

/** One window-scrolled surface, including group headings. No nested scroll containers. */
export function VirtualBookList<T>({ items, groups, grid, getKey, children, estimateSize = 64, className = '' }: {
  items?: readonly T[]
  groups?: readonly BookListGroup<T>[]
  grid: boolean
  getKey: (item: T) => string
  children: (item: T, index: number) => ReactNode
  estimateSize?: number
  className?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLSpanElement>(null)
  const [layout, setLayout] = useState({ columns: 1, width: 0, margin: 0, gap: 22 })
  const [rowEstimate, setRowEstimate] = useState(grid ? 210 : estimateSize)
  const [focused, setFocused] = useState<string>()
  const [dragged, setDragged] = useState<string>()
  const [reveal, setReveal] = useState<string>()
  const sections = useMemo(() => groups ?? [{ key: 'books', items: items ?? [] }], [groups, items])
  const count = sections.reduce((sum, group) => sum + group.items.length, 0)
  // Small shelves retain their natural flow; large collections mount only a viewport and overscan.
  const virtual = count > 40
  const columns = grid ? layout.columns : 1
  const rows = useMemo(() => {
    const result: BookRow<T>[] = []
    let start = 0
    for (const group of sections) {
      if (group.header) result.push({ key: `header:${group.key}`, items: [], start, header: group.header })
      for (let offset = 0; offset < group.items.length; offset += columns) {
        result.push({ key: `${group.key}:${getKey(group.items[offset])}`, items: group.items.slice(offset, offset + columns), start: start + offset })
      }
      start += group.items.length
    }
    return result
  }, [sections, columns, getKey])
  const pinnedRows = useMemo(() => rows.flatMap((row, index) => row.items.some((item) => {
    const key = getKey(item)
    return key === focused || key === dragged
  }) ? [index] : []), [rows, getKey, focused, dragged])
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const indexes = new Set(defaultRangeExtractor(range))
    // Keep native drag sources alive; retain keyboard focus and its next/previous Tab targets.
    for (const index of pinnedRows) {
      for (let adjacent = Math.max(0, index - 1); adjacent <= Math.min(rows.length - 1, index + 1); adjacent++) indexes.add(adjacent)
    }
    return [...indexes].sort((left, right) => left - right)
  }, [pinnedRows, rows.length])
  const rowKey = useCallback((index: number) => rows[index].key, [rows])
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    enabled: virtual,
    // Responsive measurements can run during a React commit. Let React batch their updates.
    useFlushSync: false,
    estimateSize: (index) => rows[index].header ? 28 : rowEstimate,
    getItemKey: rowKey,
    scrollMargin: layout.margin,
    gap: grid ? layout.gap : 0,
    overscan: grid ? 2 : 5,
    rangeExtractor,
  })

  useLayoutEffect(() => {
    const element = root.current
    if (!element || !virtual) return
    let frame = 0
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const gap = parseFloat(style.columnGap) || 0
      const tileWidth = probe.current?.getBoundingClientRect().width || 96
      const next = {
        columns: grid ? Math.max(1, Math.floor((width + gap + 0.5) / (tileWidth + gap))) : 1,
        width,
        margin: rect.top + window.scrollY + parseFloat(style.paddingTop),
        gap: parseFloat(style.rowGap) || 22,
      }
      setLayout((current) => current.columns === next.columns && current.width === next.width
        && current.margin === next.margin && current.gap === next.gap ? current : next)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    measure()
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    observer.observe(document.body)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { passive: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule)
    }
  }, [grid, virtual])

  useLayoutEffect(() => {
    if (!virtual) return
    const elements = [...(root.current?.querySelectorAll<HTMLElement>('[data-virtual-row]') ?? [])]
    // Learn the current shelf's responsive row height before estimating unseen books.
    // Use the median so a few taller recommendation rows do not inflate the whole shelf.
    const sizes = elements.filter((element) => element.hasAttribute('data-first-book'))
      .map((element) => element.offsetHeight).filter((size) => size > 0).sort((left, right) => left - right)
    const measuredEstimate = sizes[Math.floor(sizes.length / 2)]
    if (measuredEstimate && measuredEstimate !== rowEstimate) {
      setRowEstimate(measuredEstimate)
      return
    }
    virtualizer.measure()
    virtualizer.getTotalSize()
    // Resetting estimates does not resize an unchanged row, so measure mounted rows now.
    elements.forEach((element) => {
      virtualizer.resizeItem(Number(element.dataset.index), element.offsetHeight)
    })
  }, [virtualizer, virtual, columns, layout.width, grid, rowEstimate])

  useEffect(() => {
    const onDrag = (event: Event) => setDragged((event as CustomEvent<string | undefined>).detail)
    const onReveal = (event: Event) => {
      const { shelf, bookId } = (event as CustomEvent<{ shelf: string; bookId: string }>).detail
      if (root.current?.closest('.shelf')?.id === shelf) setReveal(bookId)
    }
    window.addEventListener('library-drag-change', onDrag)
    window.addEventListener(REVEAL_EVENT, onReveal)
    return () => {
      window.removeEventListener('library-drag-change', onDrag)
      window.removeEventListener(REVEAL_EVENT, onReveal)
    }
  }, [])

  useLayoutEffect(() => {
    if (!reveal) return
    const index = rows.findIndex((row) => row.items.some((item) => getKey(item) === reveal))
    if (index < 0) return // A transfer may still be waiting for its erase/write animation.
    if (virtual) virtualizer.scrollToIndex(index, { align: 'center', behavior: 'auto' })
    else root.current?.querySelector(`[data-library-book="${CSS.escape(reveal)}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' })
    const frame = requestAnimationFrame(() => setReveal(undefined))
    return () => cancelAnimationFrame(frame)
  }, [reveal, rows, getKey, virtual, virtualizer, layout.margin])

  let itemIndex = 0
  return (
    <div
      ref={root}
      className={tw(`${grid ? 'book-grid' : ''} ${className}`)}
      data-virtual-book-list={virtual ? '' : undefined}
      onFocusCapture={(event) => setFocused(event.target.closest('[data-virtual-row]')?.getAttribute('data-first-book') ?? event.target.closest('[data-library-book]')?.getAttribute('data-library-book') ?? undefined)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(undefined) }}
    >
      {virtual ? <>
        {grid && <span ref={probe} aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', width: 'clamp(4.75rem, 22vw, 6rem)', height: 0, pointerEvents: 'none' }} />}
        <div style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize(), overflowAnchor: 'none' }}>
          {virtualizer.getVirtualItems().map((row) => {
            const entry = rows[row.index]
            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                data-virtual-row=""
                data-row-border={!grid && row.index > 0 && !entry.header ? '' : undefined}
                data-first-book={entry.items[0] ? getKey(entry.items[0]) : undefined}
                className={tw(grid && !entry.header ? 'virtual-book-grid-row' : 'virtual-book-list-row')}
                style={{ position: 'absolute', top: row.start - layout.margin, left: 0, width: '100%' }}
              >
                {entry.header ?? entry.items.map((item, index) => <Fragment key={getKey(item)}>{children(item, entry.start + index)}</Fragment>)}
              </div>
            )
          })}
        </div>
      </> : sections.map((group) => <Fragment key={group.key}>
        {group.header}
        {group.items.map((item) => <Fragment key={getKey(item)}>{children(item, itemIndex++)}</Fragment>)}
      </Fragment>)}
    </div>
  )
}
