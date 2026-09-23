import { useSyncExternalStore } from 'react'

// Two useful panes need 56 interface ems. Measure the applied type scale as well
// as the window: a tablet with enlarged text can legitimately use one pane.
function snapshot() {
  if (typeof window === 'undefined') return false
  const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  return window.innerWidth >= Math.max(900, rootSize * 56)
    && window.innerHeight >= Math.max(480, rootSize * 30)
}
function subscribe(update: () => void) {
  window.addEventListener('resize', update)
  const observer = new MutationObserver(update)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-type-scale'] })
  return () => { window.removeEventListener('resize', update); observer.disconnect() }
}
export function useWideLayout() {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
