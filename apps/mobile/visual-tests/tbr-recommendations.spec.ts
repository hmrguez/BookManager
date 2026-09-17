import { expect, test } from '@playwright/test'

const books = [
  { id: 'long', title: 'A long waiting book', pageCount: 900 },
  { id: 'sequel', title: 'An unread sequel (Earthsea, #2)', pageCount: 180 },
  { id: 'first', title: 'A Wizard of Earthsea (Earthsea, #1)', pageCount: 205 },
  { id: 'short', title: 'A Psalm for the Wild-Built', pageCount: 160 },
  { id: 'medium', title: 'Piranesi', pageCount: 272 },
  { id: 'queued', title: 'The Left Hand of Darkness', pageCount: 304, shelf: 'next' },
].map((book) => ({
  authors: ['A Reader'], shelf: 'tbr', progress: 0, currentPage: 0, rating: 0,
  notes: '', addedAt: '2026-01-01T12:00:00.000Z', lastUpdatedAt: '2026-09-17T12:00:00.000Z', ...book,
}))

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript((seed) => {
    if (!localStorage.getItem('tbr-redesign-seeded')) {
      localStorage.setItem('wovenleaf.library.v1', JSON.stringify(seed))
      localStorage.setItem('tbr-redesign-seeded', 'true')
    }
  }, books)
  await page.goto('/')
  await expect(page.locator('#shelf-tbr [data-library-book]')).toHaveCount(5)
})

test('default picks lead the TBR, explain on demand, and append to the manual queue', async ({ page }) => {
  await expect(page.locator('#shelf-tbr [data-recommended]')).toHaveCount(3)
  await expect(page.locator('#shelf-tbr [data-library-book]').first()).toHaveAttribute('data-library-book', 'first')
  await expect(page.locator('[data-library-book="sequel"]').locator('..')).not.toHaveAttribute('data-recommended')
  await expect(page.locator('#shelf-next .choice-notes, #shelf-next .up-next__principle')).toHaveCount(0)
  await expect(page.locator('.recommendation-reasons')).toHaveCount(0)
  await page.getByRole('button', { name: 'Why A Wizard of Earthsea (Earthsea, #1) is recommended', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Why this book?', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Start Earthsea', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Preferences', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Reading suggestions', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Why A Wizard of Earthsea (Earthsea, #1) is recommended', exact: true }).click()
  const score = await dialog.locator('.recommendation-score strong').textContent()
  await dialog.getByRole('button', { name: 'Pin Length explanation', exact: true }).click()
  await expect(dialog.locator('.recommendation-score strong')).toHaveText(score!)
  await dialog.getByRole('button', { name: 'Add to Up Next', exact: true }).click()
  await expect(page.locator('#shelf-next [data-library-book]')).toHaveCount(2)
  await expect(page.locator('#shelf-next [data-library-book]').first()).toHaveAttribute('data-library-book', 'queued')
  await expect(page.locator('#shelf-next [data-library-book]').last()).toHaveAttribute('data-library-book', 'first')
  await page.reload()
  await expect(page.locator('#shelf-next [data-library-book]').last()).toHaveAttribute('data-library-book', 'first')
})

test('preset defaults are simple; advanced tag input preserves spaces/commas and saves', async ({ page }) => {
  await page.getByRole('button', { name: 'Recommendation preferences', exact: true }).click()
  await expect(page.getByRole('button', { name: /Balanced Recommended/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: 'Mood & tags importance' })).toHaveCount(0)
  await page.getByRole('button', { name: /A shorter read/ }).click()
  await page.getByRole('button', { name: 'Fine-tune the details', exact: true }).click()
  const tags = page.getByRole('textbox', { name: 'Preferred tags, separated by commas' })
  await tags.pressSequentially('Cozy, Hopeful fantasy')
  await expect(tags).toHaveValue('Cozy, Hopeful fantasy')
  await expect(tags).toHaveCSS('font-size', '16px')
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const cachedAt = await page.evaluate(() => JSON.parse(localStorage.getItem('wovenleaf.tbr-recommendations.v1')!).createdAt)
  await page.reload()
  await page.getByRole('button', { name: 'Recommendation preferences', exact: true }).click()
  await page.getByRole('button', { name: 'Custom preferences', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Preferred tags, separated by commas' })).toHaveValue('Cozy, Hopeful fantasy')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wovenleaf.tbr-recommendations.v1')!).createdAt)).toBe(cachedAt)
})

test('grid and list stay compact at mobile widths, and disabling recommendations persists', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Grid view', exact: true }).click()
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.locator('#shelf-tbr .book-tile--recommended')).toHaveCount(3)
    const tile = page.locator('#shelf-tbr .book-tile--recommended').first()
    await expect(tile.locator('.recommendation-star')).toBeInViewport()
    expect((await tile.boundingBox())!.height).toBeGreaterThan(130)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`tbr-grid-${width}.png`) })
  }
  await page.getByRole('button', { name: 'List view', exact: true }).click()
  expect((await page.locator('#shelf-tbr .book-row--recommended').first().boundingBox())!.height).toBeLessThan(120)
  await page.getByRole('button', { name: 'Recommendation preferences', exact: true }).click()
  await page.getByRole('switch', { name: 'Recommend books', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[data-recommended]')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('[data-recommended]')).toHaveCount(0)
  await expect(page.locator('#shelf-tbr [data-library-book]').first()).toHaveAttribute('data-library-book', 'long')
})
