import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createElement, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readShelfCollapsed, saveShelfCollapsed } from '../src/library/shelf-preference'
import { useShelfCascade } from '../src/library/shelf-cascade'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
beforeEach(() => {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    matchMedia: () => ({ matches: true }),
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  } })
})
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

function Shelf({ count, filtering = false, delayed = false, grow = false }: {
  count: number; filtering?: boolean; delayed?: boolean; grow?: boolean
}) {
  const [loaded, setLoaded] = useState(!delayed)
  const [grown, setGrown] = useState(false)
  const cascade = useShelfCascade({
    itemCount: count,
    bookCount: loaded ? (grow && !grown ? 29 : count) : 0,
    preferenceKey: 'status:tbr', ready: loaded,
    forceOpen: filtering, motionMode: 'reduced',
  })
  if (!loaded) setLoaded(true)
  if (grow && !grown) setGrown(true)
  return createElement('div', { 'data-collapsed': cascade.isCollapsed, hidden: cascade.cascadeProps.hidden })
}
const render = (props: Parameters<typeof Shelf>[0]) => renderToStaticMarkup(createElement(Shelf, props))

test('only shelves with at least 30 books start closed', () => {
  expect(render({ count: 29 })).toContain('data-collapsed="false"')
  expect(render({ count: 30 })).toContain('data-collapsed="true" hidden=""')
  expect(render({ count: 100 })).toContain('data-collapsed="true"')
})
test('waits for the loaded collection before applying the default', () => {
  expect(render({ count: 30, delayed: true })).toContain('data-collapsed="true" hidden=""')
})
test('adding the 30th book does not collapse an open shelf', () => {
  expect(render({ count: 30, grow: true })).toContain('data-collapsed="false"')
})
test('remembers choices independently per shelf', () => {
  saveShelfCollapsed('status:tbr', false)
  saveShelfCollapsed('custom:tbr', true)
  expect(readShelfCollapsed('custom:tbr', 1)).toBe(true)
  expect(render({ count: 50 })).toContain('data-collapsed="false"')
  saveShelfCollapsed('status:tbr', true)
  expect(render({ count: 1 })).toContain('data-collapsed="true"')
})
test('search exposes matches and leaves the saved choice intact', () => {
  saveShelfCollapsed('status:tbr', true)
  expect(render({ count: 40, filtering: true })).toContain('data-collapsed="false"')
  expect(readShelfCollapsed('status:tbr', 40)).toBe(true)
  expect(render({ count: 40 })).toContain('data-collapsed="true"')
})
test('invalid or unavailable storage falls back safely', () => {
  window.localStorage.setItem('wovenleaf.shelf-collapsed.v1.status:tbr', 'broken')
  expect(readShelfCollapsed('status:tbr', 30)).toBe(true)
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('unavailable') } })
  expect(readShelfCollapsed('status:tbr', 29)).toBe(false)
  expect(() => saveShelfCollapsed('status:tbr', true)).not.toThrow()
})
