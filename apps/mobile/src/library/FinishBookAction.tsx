import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const menuRef = useRef<HTMLDivElement>(null)
  const holdRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const originRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const suppressClickRef = useRef(false)
  const firstItemRef = useRef(0)

  const clearHold = useCallback(() => {
    clearTimeout(holdRef.current)
    holdRef.current = undefined
    originRef.current = undefined
  }, [])

  const showMenu = (firstItem = 0) => {
    clearHold()
    suppressClickRef.current = true
    firstItemRef.current = firstItem
    setOpen(true)
  }

  const closeMenu = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => clearHold, [clearHold])

  useLayoutEffect(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!open || !trigger || !menu) return

    const anchor = trigger.getBoundingClientRect()
    const bounds = menu.getBoundingClientRect()
    const inset = 12
    const below = anchor.bottom + 6
    const top = below + bounds.height <= window.innerHeight - inset
      ? below
      : anchor.top - bounds.height - 6
    menu.style.top = `${Math.max(inset, top)}px`
    menu.style.left = `${Math.max(inset, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - inset))}px`
    menu.style.visibility = 'visible'
    menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[firstItemRef.current]?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => {
      if (event.target instanceof Node
        && !menuRef.current?.contains(event.target)
        && !triggerRef.current?.contains(event.target)) closeMenu(false)
    }
    const dismiss = () => closeMenu()
    const blur = () => closeMenu(false)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', blur)
    }
  }, [closeMenu, open])

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
    {open && createPortal(
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label="Reading status"
        className={tw('finish-book-menu')}
        style={{ visibility: 'hidden' }}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
          const index = items.indexOf(document.activeElement as HTMLButtonElement)
          let next: number | undefined
          if (event.key === 'ArrowDown') next = (index + 1) % items.length
          if (event.key === 'ArrowUp') next = (index + items.length - 1) % items.length
          if (event.key === 'Home' || event.key.toLowerCase() === 'f') next = 0
          if (event.key === 'End' || event.key.toLowerCase() === 'd') next = items.length - 1
          if (next !== undefined) {
            event.preventDefault()
            items[next]?.focus()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeMenu()
          } else if (event.key === 'Tab') {
            closeMenu()
          }
        }}
      >
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => { closeMenu(); onFinish() }}>
          <Check aria-hidden="true" />
          <span><strong>Finish</strong><small>Mark as completed</small></span>
        </button>
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => { closeMenu(); onDnf() }}>
          <BookMinus aria-hidden="true" />
          <span><strong>DNF</strong><small>Did not finish</small></span>
        </button>
      </div>,
      document.body,
    )}
  </>
}
