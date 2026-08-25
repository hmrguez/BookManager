import { describe, expect, test } from 'bun:test'
import {
  COMPOSITE_STORIES,
  GALLERY_CATALOG,
  REQUIRED_GALLERY_STATES,
  REVIEW_SCENARIOS,
} from '../src/gallery/catalog'

const componentsUrl = new URL('../src/design-system/components.tsx', import.meta.url)
const galleryUrl = new URL('../src/gallery/ComponentGallery.tsx', import.meta.url)
const mainUrl = new URL('../src/main.tsx', import.meta.url)

describe('living component gallery contract', () => {
  test('requires every exported reusable component to have a default gallery story', async () => {
    const source = await Bun.file(componentsUrl).text()
    const reusableComponents = [...source.matchAll(/^export function ([A-Z][A-Za-z0-9]+)/gm)]
      .map(([, name]) => name)
      .sort()
    const catalogComponents = GALLERY_CATALOG.map(({ component }) => component).sort()

    expect(catalogComponents).toEqual(reusableComponents)
    GALLERY_CATALOG.forEach((entry) => expect(entry.states, entry.component).toContain('default'))
  })

  test('covers the complete interaction and environment state matrix', () => {
    const coveredStates = new Set(
      [...GALLERY_CATALOG, ...COMPOSITE_STORIES].flatMap(({ states }) => states),
    )

    REQUIRED_GALLERY_STATES.forEach((state) => expect(coveredStates.has(state), state).toBe(true))
  })

  test('keeps story identifiers and screenshot scenarios unique', () => {
    const storyIds = [...GALLERY_CATALOG, ...COMPOSITE_STORIES].map(({ story }) => story)
    const scenarioIds = REVIEW_SCENARIOS.map(({ id }) => id)

    expect(new Set(storyIds).size).toBe(storyIds.length)
    expect(new Set(scenarioIds).size).toBe(scenarioIds.length)
    expect(REVIEW_SCENARIOS).toHaveLength(3)
  })

  test('uses deterministic fixtures and a review gate', async () => {
    const source = await Bun.file(galleryUrl).text()

    expect(source).not.toMatch(/Math\.random|Date\.now|new Date|https?:\/\//)
    expect(source).toContain('data-testid="review-gate"')
    for (const check of ['Keyboard', 'Semantics', 'Contrast', 'Text', 'Motion', 'Performance']) {
      expect(source).toContain(`['${check}'`)
    }
  })

  test('loads the gallery only behind the development route gate', async () => {
    const source = await Bun.file(mainUrl).text()

    expect(source).toContain("import.meta.env.DEV && window.location.pathname === '/__gallery'")
    expect(source).toContain("await import('./gallery/ComponentGallery')")
  })
})
