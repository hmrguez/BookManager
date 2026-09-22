import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AnchoredMenu } from '../design-system/AnchoredMenu'
import { BookMinus, Check } from 'lucide-react'
import { tw } from '../tailwind/styles'

const HOLD_MS = 450
const MOVE_TOLERANCE = 8

export function FinishBookAction({ onFinish, onDnf }: {
  onFinish: () => void
  onDnf: () => void
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const holdRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const originRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const suppressClickRef = useRef(false)
  const [firstItem, setFirstItem] = useState(0)

  const clearHold = useCallback(() => {
    clearTimeout(holdRef.current)
    holdRef.current = undefined
    originRef.current = undefined
  }, [])

  const showMenu = (firstItem = 0) => {
    clearHold()
    suppressClickRef.current = true
    setFirstItem(firstItem)
    setOpen(true)
  }

  const closeMenu = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => clearHold, [clearHold])


  return <>
    <button
      ref={triggerRef}
      className={tw('row-action row-action--finish finish-book-trigger')}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      aria-description="Tap to finish. Hold for Finish or DNF, or press the down arrow for options."
      aria-keyshortcuts="ArrowDown ArrowUp Shift+F10"
      title="Tap to finish · Hold for more options"
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return
        clearHold()
        suppressClickRef.current = false
        if (open) return
        originRef.current = { x: event.clientX, y: event.clientY }
        holdRef.current = setTimeout(() => showMenu(), HOLD_MS)
      }}
      onPointerMove={(event) => {
        const origin = originRef.current
        if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > MOVE_TOLERANCE) {
          suppressClickRef.current = true
          clearHold()
        }
      }}
      onPointerUp={clearHold}
      onPointerLeave={() => {
        if (originRef.current) suppressClickRef.current = true
        clearHold()
      }}
      onPointerCancel={() => {
        suppressClickRef.current = true
        clearHold()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        showMenu()
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          showMenu(event.key === 'ArrowUp' ? 1 : 0)
        } else if (event.key === 'Enter' || event.key === ' ') {
          suppressClickRef.current = false
        }
      }}
      onClick={() => {
        // Releasing a hold also dispatches a click; leave the newly opened menu in place.
        if (suppressClickRef.current) return
        if (open) closeMenu()
        else onFinish()
      }}
    >
      Finish <Check aria-hidden="true" />
    </button>
    {open && <AnchoredMenu id={menuId} label="Reading status" triggerRef={triggerRef} initialFocus={firstItem} onClose={closeMenu}>
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => { closeMenu(); onFinish() }}>
        <Check aria-hidden="true" />
        <span><strong>Finish</strong><small>Mark as completed</small></span>
      </button>
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => { closeMenu(); onDnf() }}>
        <BookMinus aria-hidden="true" />
        <span><strong>DNF</strong><small>Did not finish</small></span>
      </button>
    </AnchoredMenu>}
  </>
}
