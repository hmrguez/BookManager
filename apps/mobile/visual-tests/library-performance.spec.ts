import { expect, test, type Page } from '@playwright/test'

let browserErrors: string[] = []

const timestamp = '2026-09-01T10:00:00.000Z'
const books = Array.from({ length: 1800 }, (_, index) => ({
  id: `large-${index}`, title: `Library volume ${String(index).padStart(4, '0')}`, authors: ['Library Author'],
  shelf: index < 1200 ? 'tbr' : index < 1400 ? 'next' : index < 1600 ? 'reading' : 'finished',
  pageCount: 300, currentPage: 0, progress: 0, rating: 0, notes: '',
  addedAt: timestamp, lastUpdatedAt: timestamp,
}))

test.beforeEach(async ({ page }) => {
  browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  await page.addInitScript((seed) => {
    if (!localStorage.getItem('large-test-seeded')) {
      localStorage.setItem('wovenleaf.library.v1', JSON.stringify(seed))
      // Large shelves default to collapsed; these tests exercise their open contents.
      for (const shelf of ['status:tbr', 'status:next', 'status:reading', 'status:finished', 'custom:large-custom', 'smart:large-smart']) {
        localStorage.setItem(`wovenleaf.shelf-collapsed.v1.${shelf}`, 'false')
      }
      localStorage.setItem('large-test-seeded', 'true')
    }
  }, books)
  await page.goto('/')
  await expect(page.locator('#shelf-tbr h2')).toContainText('1200', { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
})

test.afterEach(() => { expect(browserErrors).toEqual([]) })

async function scrollToEnd(page: Page, shelf: string) {
  await page.locator(shelf).evaluate((element) => {
    window.scrollTo({ top: element.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 100, behavior: 'instant' })
  })
}

async function expectBoundedRows(page: Page) {
  // A wide grid overscans whole rows of covers on each open shelf.
  const grid = await page.getByRole('button', { name: 'Grid view', exact: true }).getAttribute('aria-pressed') === 'true'
  await expect.poll(() => page.locator('[data-library-book]').count()).toBeLessThan(grid ? 200 : 110)
}

test('1800 books stay windowed in list and responsive cover views, including the last book', async ({ page }, testInfo) => {
  await expectBoundedRows(page)
  await expect(page.locator('#shelf-tbr [data-library-book="large-0"]')).toBeVisible()
  await scrollToEnd(page, '#shelf-tbr')
  await expect(page.locator('[data-library-book="large-1199"]')).toBeInViewport()
  await expectBoundedRows(page)
  await page.screenshot({ path: testInfo.outputPath('large-list-end.png') })

  await page.getByRole('button', { name: 'Grid view', exact: true }).click()
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 850 })
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await expect(page.locator('[data-library-book="large-0"]')).toBeInViewport()
    await expectBoundedRows(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect.poll(() => page.locator('#shelf-tbr [data-virtual-row]').evaluateAll((elements) => {
      const first = elements[0].getBoundingClientRect()
      const second = elements[1].getBoundingClientRect()
      return Math.round(second.top - first.bottom)
    })).toBe(22)
    await page.screenshot({ path: testInfo.outputPath(`large-grid-${width}.png`) })
    await scrollToEnd(page, '#shelf-tbr')
    await expect(page.locator('[data-library-book="large-1199"]')).toBeInViewport()
  }
})

test('a move reveals the destination, indexes one book, and collapsed shelves unmount rows', async ({ page }) => {
  // Wait for the initial bulk index, then record incremental work performed by the actual app.
  await expect(page.locator('.library-search-controls')).toHaveCount(0)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(({ name }) => name).find((name) => name.includes('/src/search/local-search.ts'))!
    const { LocalSearchIndex } = await import(/* @vite-ignore */ path) as typeof import('../src/search/local-search')
    const changes: number[] = []
    Object.assign(window, { __indexChanges: changes })
    const original = LocalSearchIndex.prototype.withChanges
    LocalSearchIndex.prototype.withChanges = function (documents, removed) {
      changes.push(documents.length + (removed?.length ?? 0))
      return original.call(this, documents, removed)
    }
  })
  // Searching for a distant item also proves the initial index is complete.
  await page.getByRole('button', { name: 'Search my library' }).click()
  await page.getByRole('searchbox', { name: 'Search your local library' }).fill('1799')
  await expect(page.locator('[data-library-book="large-1799"]')).toBeVisible()
  await page.getByRole('button', { name: 'Close library search' }).click()
  await page.locator('#shelf-tbr .book-row').first().getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.locator('#shelf-next [data-library-book="large-0"]')).toBeInViewport()
  await expect(page.locator('#shelf-tbr h2')).toContainText('1199')
  await expect(page.locator('#shelf-next h2')).toContainText('201')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __indexChanges: number[] }).__indexChanges)).toEqual([1])
  await expectBoundedRows(page)
  await page.locator('#shelf-tbr .shelf-toggle').click()
  await expect(page.locator('#shelf-tbr [data-library-book]')).toHaveCount(0)
  await page.locator('#shelf-tbr .shelf-toggle').click()
  await expect(page.locator('#shelf-tbr [data-library-book="large-1"]')).toBeVisible()
  await expectBoundedRows(page)
})

test('custom shelves and grouped smart lists window their complete collections', async ({ page }, testInfo) => {
  await page.route('**/src/app/feature-flags.ts*', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()).replace(/smartLists:\s*enabled\([^)]*\)/, 'smartLists: true') })
  })
  await page.evaluate(async ({ ids, timestamp }) => {
    const path = performance.getEntriesByType('resource').map(({ name }) => name).find((name) => name.includes('/src/storage/runtime.ts'))!
    const { getStorageRuntime } = await import(/* @vite-ignore */ path) as typeof import('../src/storage/runtime')
    const storage = await getStorageRuntime()
    await storage.organization.saveShelf({ id: 'large-custom', name: 'Whole collection', notes: '', pinned: false, archived: false, position: 0, createdAt: timestamp, updatedAt: timestamp })
    await storage.organization.replaceShelfMembers('large-custom', ids)
    await storage.smartLists.save({
      id: 'large-smart', name: 'By reading status', description: '', pinned: false, archived: false, position: 0, createdAt: timestamp, updatedAt: timestamp,
      definition: {
        schemaVersion: 1,
        root: { id: 'all', kind: 'group', combinator: 'all', negate: false, rules: [{ id: 'rated', kind: 'condition', field: 'rating', operator: 'at-least', value: 0, negate: false }] },
        sort: { field: 'title', direction: 'ascending' }, groupBy: 'status',
      },
    })
  }, { ids: books.map(({ id }) => id), timestamp })
  await page.reload()
  await expect(page.locator('#custom-shelf-large-custom h2')).toContainText('1800')
  await expect(page.locator('#smart-list-large-smart h2')).toContainText('1800')
  await expect.poll(() => page.locator('[data-library-book]').count()).toBeLessThan(150)
  await scrollToEnd(page, '#custom-shelf-large-custom')
  await expect(page.locator('#custom-shelf-large-custom [data-library-book="large-1799"]')).toBeInViewport()
  await scrollToEnd(page, '#smart-list-large-smart')
  await expect(page.locator('#smart-list-large-smart [data-library-book="large-1399"]')).toBeInViewport()
  await page.locator('#smart-list-large-smart .smart-book-reasons').last().locator('summary').click()
  await expect(page.locator('#smart-list-large-smart .smart-book-reasons[open]')).toContainText('Why this book is here')
  await page.getByRole('button', { name: 'Grid view', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 850 })
  await scrollToEnd(page, '#smart-list-large-smart')
  await expect(page.locator('#smart-list-large-smart [data-library-book="large-1399"]')).toBeInViewport()
  await expect.poll(() => page.locator('[data-library-book]').count()).toBeLessThan(150)
  await page.screenshot({ path: testInfo.outputPath('large-grouped-smart-grid.png') })
  await page.locator('#smart-list-large-smart .shelf-toggle').click()
  await expect(page.locator('#smart-list-large-smart [data-library-book]')).toHaveCount(0)
  await scrollToEnd(page, '#custom-shelf-large-custom')
  await expect(page.locator('#custom-shelf-large-custom [data-library-book="large-1799"]')).toBeInViewport()
})

test('keyboard focus crosses the render window and a drag source survives scrolling', async ({ page }) => {
  await expect(page.locator('#shelf-tbr .recommendation-star')).toHaveCount(3)
  await page.locator('[data-library-book="large-0"]').focus()
  // The first three recommended books each add a "Why recommended" Tab stop.
  for (let index = 0; index < 58; index++) await page.keyboard.press('Tab')
  await expect(page.locator('#shelf-tbr [data-library-book="large-27"]').locator('..').getByRole('button', { name: 'Next', exact: true })).toBeFocused()
  await expectBoundedRows(page)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  const source = page.locator('[data-library-book="large-0"]')
  await source.dispatchEvent('dragstart', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) })
  await page.evaluate(() => window.scrollTo({ top: 20000, behavior: 'instant' }))
  await expect(source).toHaveCount(1)
  await expect(source).toHaveAttribute('data-book-dragging', '')
  await expectBoundedRows(page)
  await page.keyboard.press('Escape')
  await expect(source).toHaveCount(0)
})

test('animated transfers keep DOM measurements bounded and reveal the moved book', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => {
    const original = Element.prototype.getBoundingClientRect
    let measurements = 0
    Object.defineProperty(window, '__bookMeasurements', { get: () => measurements })
    Element.prototype.getBoundingClientRect = function () {
      if (this.matches('article')) measurements++
      return original.call(this)
    }
  })
  await page.locator('#shelf-tbr .book-row').first().getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.locator('#shelf-next [data-library-book="large-0"]')).toBeInViewport()
  await expect(page.locator('#shelf-tbr [aria-busy=true], #shelf-next [aria-busy=true]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __bookMeasurements: number }).__bookMeasurements)).toBeLessThan(150)
  await expectBoundedRows(page)
})
