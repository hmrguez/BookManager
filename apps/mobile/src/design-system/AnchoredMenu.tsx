import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { tw } from '../tailwind/styles'

const menuItems = '[role="menuitem"], [role="menuitemradio"]'

export function AnchoredMenu({ id, label, triggerRef, initialFocus = 0, followScroll = false, onClose, children }: {
  readonly id: string
  readonly label: string
  readonly triggerRef: RefObject<HTMLButtonElement | null>
  readonly initialFocus?: number
  readonly followScroll?: boolean
  readonly onClose: (restoreFocus?: boolean) => void
  readonly children: ReactNode
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return

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
  }, [triggerRef])

  useLayoutEffect(() => {
    positionMenu()
    menuRef.current?.querySelectorAll<HTMLButtonElement>(menuItems)[initialFocus]?.focus({ preventScroll: true })
  }, [initialFocus, positionMenu])

  useEffect(() => {
    const outside = (event: Event) => {
      if (event.target instanceof Node
        && !menuRef.current?.contains(event.target)
        && !triggerRef.current?.contains(event.target)) onClose(false)
    }
    const dismiss = () => onClose()
    const scroll = () => followScroll ? positionMenu() : onClose()
    const blur = () => onClose(false)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', blur)
    }
  }, [followScroll, onClose, positionMenu, triggerRef])

  return createPortal(
    <div ref={menuRef} id={id} role="menu" aria-label={label}
      className={tw('finish-book-menu')} style={{ visibility: 'hidden' }}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(menuItems))
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        let next: number | undefined
        if (event.key === 'ArrowDown') next = (index + 1) % items.length
        if (event.key === 'ArrowUp') next = (index + items.length - 1) % items.length
        if (event.key === 'Home') next = 0
        if (event.key === 'End') next = items.length - 1
        if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
          const match = items.findIndex(item => item.querySelector('strong')?.textContent?.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()))
          if (match >= 0) next = match
        }
        if (next !== undefined) {
          event.preventDefault()
          items[next]?.focus({ preventScroll: true })
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        } else if (event.key === 'Tab') onClose()
      }}>
      {children}
    </div>, document.body,
  )
}
