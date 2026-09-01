import { expect, test } from '@playwright/test'

test('bottom sheets keep their close button fixed while content scrolls', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await page.setViewportSize({ width: 390, height: 500 })
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Add Book' }).click()

  const sheet = page.getByRole('dialog')
  const sheetContent = sheet.locator('.sheet-content')
  const closeButton = sheet.getByRole('button', { name: 'Close' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: /No ISBN\? No problem/ }).click()
  await expect(sheet).toHaveAccessibleName('Add a book manually')

  const initialCloseTop = await closeButton.evaluate((element) => element.getBoundingClientRect().top)
  await sheetContent.evaluate((element) => { element.scrollTop = element.scrollHeight })

  await expect.poll(() => sheetContent.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await expect(closeButton).toBeInViewport()
  await expect.poll(() => closeButton.evaluate((element) => element.getBoundingClientRect().top)).toBe(initialCloseTop)

  await closeButton.click()
  await expect(sheet).toBeHidden()
  expect(consoleErrors).toEqual([])
})
