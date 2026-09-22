import {
  useCallback,
  useEffect,
  useState,
  type AnimationEventHandler,
  type CSSProperties,
} from 'react'
import { shouldReduceMotion, type MotionMode } from '../design-system'
import { readShelfCollapsed, saveShelfCollapsed } from './shelf-preference'

const CASCADE_STAGGER_MS = 20
const CASCADE_MAX_ORDER = 7
const CASCADE_FALLBACK_MS = 360

type ShelfCascadePhase = 'open' | 'opening' | 'closing' | 'closed'

type UseShelfCascadeOptions = {
  readonly itemCount: number
  readonly motionMode: MotionMode
  readonly forceOpen?: boolean
  readonly expansionKey?: number
  readonly preferenceKey?: string
  readonly bookCount?: number
  readonly ready?: boolean
}

export function shelfCascadeItem(index: number, itemCount: number) {
  const lastIndex = Math.max(0, itemCount - 1)
  const openOrder = Math.min(index, CASCADE_MAX_ORDER)
  const closeOrder = Math.min(Math.max(0, lastIndex - index), CASCADE_MAX_ORDER)

  return {
    'data-shelf-cascade-item': '',
    'data-shelf-cascade-index': index,
    style: {
      '--shelf-cascade-open-delay': `${openOrder * CASCADE_STAGGER_MS}ms`,
      '--shelf-cascade-close-delay': `${closeOrder * CASCADE_STAGGER_MS}ms`,
    } as CSSProperties,
  }
}

export function useShelfCascade({
  itemCount,
  motionMode,
  forceOpen = false,
  expansionKey,
  preferenceKey,
  bookCount = itemCount,
  ready = true,
}: UseShelfCascadeOptions) {
  const canInitialize = ready && !forceOpen
  const [initialized, setInitialized] = useState(canInitialize)
  const [collapsed, setCollapsed] = useState(() =>
    canInitialize && preferenceKey ? readShelfCollapsed(preferenceKey, bookCount) : false,
  )
  const [phase, setPhase] = useState<ShelfCascadePhase>(collapsed ? 'closed' : 'open')
  const isCollapsed = collapsed && !forceOpen
  const reduceMotion = shouldReduceMotion(motionMode)
  const [renderedCollapsed, setRenderedCollapsed] = useState(isCollapsed)
  const [renderedReduceMotion, setRenderedReduceMotion] = useState(reduceMotion)
  const [handledExpansionKey, setHandledExpansionKey] = useState(expansionKey)

  // Decide once from the loaded, unfiltered collection, never from search results.
  if (!initialized && canInitialize) {
    const initialCollapsed = preferenceKey ? readShelfCollapsed(preferenceKey, bookCount) : false
    setInitialized(true)
    setCollapsed(initialCollapsed)
    setRenderedCollapsed(initialCollapsed)
    setPhase(initialCollapsed ? 'closed' : 'open')
  }

  // Save the first decision too, so crossing 30 books never changes an existing shelf.
  useEffect(() => {
    if (initialized && preferenceKey) saveShelfCollapsed(preferenceKey, collapsed)
  }, [initialized, preferenceKey, collapsed])

  if (expansionKey !== undefined && expansionKey !== handledExpansionKey) {
    setHandledExpansionKey(expansionKey)
    setCollapsed(false)
  }

  if (reduceMotion !== renderedReduceMotion) {
    setRenderedReduceMotion(reduceMotion)
    setRenderedCollapsed(isCollapsed)
    setPhase(isCollapsed ? 'closed' : 'open')
  } else if (isCollapsed !== renderedCollapsed) {
    setRenderedCollapsed(isCollapsed)
    setPhase(reduceMotion ? (isCollapsed ? 'closed' : 'open') : (isCollapsed ? 'closing' : 'opening'))
  }

  useEffect(() => {
    if (phase !== 'opening' && phase !== 'closing') return
    const fallback = window.setTimeout(() => {
      setPhase((current) => current === 'opening' ? 'open' : current === 'closing' ? 'closed' : current)
    }, CASCADE_FALLBACK_MS)
    return () => window.clearTimeout(fallback)
  }, [phase])

  const onAnimationEnd = useCallback<AnimationEventHandler<HTMLElement>>((event) => {
    const itemIndex = Number((event.target as HTMLElement).dataset.shelfCascadeIndex)
    if (phase === 'opening'
      && event.animationName === 'motion-shelf-cascade-open'
      && itemIndex === itemCount - 1) {
      setPhase('open')
    }
    if (phase === 'closing'
      && event.animationName === 'motion-shelf-cascade-close'
      && itemIndex === 0) {
      setPhase('closed')
    }
  }, [itemCount, phase])

  return {
    isCollapsed,
    toggle: () => {
      if (!forceOpen) setCollapsed((current) => !current)
    },
    cascadeProps: {
      'data-shelf-cascade': phase,
      hidden: phase === 'closed',
      'aria-hidden': isCollapsed || undefined,
      inert: isCollapsed || undefined,
      onAnimationEnd,
    },
  }
}
