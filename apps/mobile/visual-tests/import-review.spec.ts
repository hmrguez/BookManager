import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
test.setTimeout(30_000)

const csv = (count: number) => Buffer.from([
  'Book Id,Title,Author,Exclusive Shelf,Date Added',
  ...Array.from({ length: count }, (_, index) => `${index + 1},Import book ${index + 1},Author ${index + 1},to-read,2026/01/01`),
].join('\n'))

test.beforeEach(async ({ page }) => {
  await page.route('https://openlibrary.org/**', (route) => route.abort())
  await page.route('https://covers.openlibrary.org/**', (route) => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
})

test('large previews use compact pages and only mount details after expansion', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const start = Date.now()
  await page.locator('.goodreads-migration__picker input').setInputFiles({ name: 'library.csv', mimeType: 'text/csv', buffer: csv(1_820) })
  const commit = page.getByRole('button', { name: 'Import 1,820 books', exact: true })
  await expect(commit).toBeEnabled({ timeout: 10_000 })
  expect(Date.now() - start).toBeLessThan(10_000)
  await expect(page.locator('.import-book-row')).toHaveCount(100)
  await expect(page.locator('.import-book-details')).toHaveCount(0)
  expect(await page.locator('.import-book-line').first().evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(64)
  await page.locator('.import-book-expand').first().click()
  await expect(page.locator('.import-book-details')).toHaveCount(1)
  await expect(page.locator('.import-book-expand').first()).toHaveAttribute('aria-expanded', 'true')
  await page.locator('.import-book-expand').first().click()
  await expect(page.locator('.import-book-details')).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Include Import book 1', exact: true }).uncheck()
  await expect(page.getByRole('button', { name: 'Import 1,819 books', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Next books', exact: true }).click()
  await expect(page.locator('.import-book-identity').first()).toContainText('Import book 101')
  await page.getByRole('button', { name: 'Previous books', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Include Import book 1', exact: true })).not.toBeChecked()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('compact-import.png') })
  expect(errors).toEqual([])
})

test('offline commit shows durable completion, survives reload, and remains undoable', async ({ page }, testInfo) => {
  await page.locator('.goodreads-migration__picker input').setInputFiles({ name: 'library.csv', mimeType: 'text/csv', buffer: csv(12) })
  await page.getByRole('button', { name: 'Import 12 books', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your library is here.' })).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.import-book-row.is-imported')).toHaveCount(12)
  await expect(page.locator('.import-action-bar').getByRole('button', { name: 'View library', exact: true })).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('completed-import.png') })
  await page.locator('.import-action-bar').getByRole('button', { name: 'View library', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('.import-history__row').first()).toContainText('12 books')
  await page.locator('.import-history__row').first().getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.import-history__row').first()).toContainText('undone', { timeout: 10_000 })
})
