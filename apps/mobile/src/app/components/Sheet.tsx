import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { tw } from '../../tailwind/styles'
import { motionStyles } from '../../tailwind/motion'

export function Sheet({
  title,
  onClose,
  children,
  tall = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  tall?: boolean
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)

  useLayoutEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.contains(document.activeElement)) return
    const target = dialog.querySelector<HTMLElement>('[autofocus], button, input, textarea, select')
    target?.focus({ preventScroll: true })
  }, [])

  const containFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? [])].filter((element) => !element.hidden)
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
    <div className={tw('sheet-layer', motionStyles.sheetVeil)} data-motion-event="reveal" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className={tw(`bottom-sheet${tall ? ' bottom-sheet--tall' : ''}`, motionStyles.sheetReveal)}
        data-motion-event="reveal"
        role="dialog"
        aria-modal="true"
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
