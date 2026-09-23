import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useWideLayout } from '../../responsive/useWideLayout'
import { X } from 'lucide-react'
import { tw } from '../../tailwind/styles'
import { motionStyles } from '../../tailwind/motion'

export function Sheet({
  title,
  onClose,
  children,
  tall = false,
  adaptiveDetail = false,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  tall?: boolean
  adaptiveDetail?: boolean
  wide?: boolean
}) {
  const wideLayout = useWideLayout()
  const docked = adaptiveDetail && wideLayout
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)

  useLayoutEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    if (!docked) document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) onCloseRef.current()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      if (!docked) document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [docked])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.contains(document.activeElement)) return
    const target = dialog.querySelector<HTMLElement>('[autofocus], button, input, textarea, select')
    target?.focus({ preventScroll: true })
  }, [docked])

  const containFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (docked || event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])',
    ) ?? [])].filter((element) => {
      if (element.hidden || element.getClientRects().length === 0) return false
      // Closed <details> descendants can retain layout boxes while being unfocusable.
      for (let parent = element.parentElement; parent && parent !== dialogRef.current; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement && !parent.open
          && !parent.querySelector(':scope > summary')?.contains(element)) return false
      }
      return true
    })
    if (!focusable.length) return

    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className={tw('sheet-layer', motionStyles.sheetVeil)} data-wide={wideLayout || undefined} data-docked={docked || undefined} data-wide-sheet={wide || undefined} data-motion-event="reveal" role="presentation" onMouseDown={docked ? undefined : onClose}>
      <section
        ref={dialogRef}
        className={tw(`bottom-sheet${tall ? ' bottom-sheet--tall' : ''}`, motionStyles.sheetReveal)}
        data-motion-event="reveal"
        role="dialog"
        aria-modal={docked ? undefined : true}
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={containFocus}
      >
        <div className={tw('sheet-handle')} aria-hidden="true" />
        <header className={tw('sheet-header')}>
          <h2>{title}</h2>
          <button className={tw('icon-button')} type="button" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className={tw('sheet-content')}>
          {children}
        </div>
      </section>
    </div>
  )
}
