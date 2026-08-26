import { expect, test } from '@playwright/test'

test('work detail keeps manifestations scoped, combines history, and previews reversible identity changes', async ({ context, page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await page.setViewportSize({ width: 430, height: 932 })
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState('networkidle')
  await context.setOffline(true)

  await page.locator('.book-identity').filter({ hasText: 'The Tainted Cup' }).click()
  await expect(page.getByRole('heading', { name: 'Book details' })).toBeVisible()

  const editionTabs = page.getByRole('radiogroup', { name: 'Editions and formats' })
  await expect(editionTabs.getByRole('radio')).toHaveCount(4)
  await expect(editionTabs.getByRole('radio', { name: /EPUB/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('heading', { name: 'Publication ledger' })).toBeVisible()
  await expect(page.getByText('Edition facts, never Work facts')).toBeVisible()

  await editionTabs.getByRole('radio', { name: /Libby/ }).click()
  await expect(page.getByRole('heading', { name: 'Due Sep 4 · 9 days left' })).toBeVisible()
  await expect(page.getByText('Streaming access · connection required')).toBeVisible()
  await expect(page.getByRole('button', { name: /Choose as preferred edition/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('dense-libby-overview.png') })
  await page.evaluate(() => { document.documentElement.dataset.typeScale = 'x-large' })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('dense-large-type.png') })
  await page.evaluate(() => { document.documentElement.dataset.typeScale = 'standard' })

  await page.getByRole('tab', { name: 'Reading', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Reading history' })).toBeVisible()
  await expect(page.locator('.reading-timeline li')).toHaveCount(4)
  await expect(page.getByText('Sessions from print, files, audio, and loans appear once')).toBeVisible()

  await page.getByRole('tab', { name: 'Notes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Annotations' })).toBeVisible()
  await expect(page.locator('.annotation-ledger li')).toHaveCount(3)

  await page.getByRole('tab', { name: 'Library', exact: true }).click()
  await expect(page.getByRole('button', { name: /Merge another Work/ })).toBeVisible()
  await page.getByRole('button', { name: /Split selected edition/ }).click()
  const preview = page.getByRole('dialog')
  await expect(preview.getByRole('heading', { name: 'Split Libby loan into a new Work?' })).toBeVisible()
  await expect(preview.getByText('Attached sessions')).toBeVisible()
  await expect(preview.getByText('Undo restores the exact Edition → Work assignment.')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('identity-preview.png') })
  await preview.getByRole('button', { name: 'Split edition' }).click()
  await expect(page.locator('.work-detail [role="status"]')).toContainText('Libby loan moved to a new Work')
  await expect(page.getByText('Split into a separate Work')).toBeVisible()
  await page.locator('.identity-actions').getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.work-detail [role="status"]')).toContainText('Undone')
  await expect(page.getByText('Belongs to this Work')).toBeVisible()

  await page.getByRole('button', { name: 'Close' }).click()
  await page.locator('.book-identity').filter({ hasText: 'Mistborn' }).click()
  await expect(page.getByRole('radiogroup', { name: 'Editions and formats' }).getByRole('radio')).toHaveCount(1)
  await page.getByRole('tab', { name: 'Reading', exact: true }).click()
  await expect(page.getByText('No reading sessions yet')).toBeVisible()

  await page.evaluate(() => { document.documentElement.dataset.typeScale = 'x-large' })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('sparse-large-type.png') })

  expect(consoleErrors.filter((error) => !error.includes('ERR_INTERNET_DISCONNECTED'))).toEqual([])
})
