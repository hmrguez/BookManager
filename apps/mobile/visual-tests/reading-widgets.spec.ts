import { expect, test } from '@playwright/test'

test('widget recording uses final values, switches books, and counts a reading day', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Books', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((url) => url.includes('/src/storage/runtime.ts'))!
    const { library } = await (await import(/* @vite-ignore */ path)).getStorageRuntime()
    const at = new Date().toISOString()
    for (const [id, title] of [['widget-one', 'The Left Hand of Darkness'], ['widget-two', 'A Wizard of Earthsea']]) {
      await library.save({ id, title, authors: ['Ursula K. Le Guin'], pageCount: 1000, shelf: 'reading', progress: 10,
        currentPage: 100, rating: 0, notes: '', addedAt: at, lastUpdatedAt: at })
    }
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'My Books', exact: true })).toBeVisible()
  const open = async (url: string) => page.evaluate(async (url) => {
    const bridge = (window as unknown as { Capacitor: { Plugins: { App: { notifyListeners: (name: string, event: { url: string }) => Promise<void> } } } }).Capacitor
    await bridge.Plugins.App.notifyListeners('appUrlOpen', { url })
  }, url)
  const events = () => page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((url) => url.includes('/src/storage/runtime.ts'))!
    const { database } = await (await import(/* @vite-ignore */ path)).getStorageRuntime()
    return database.query('SELECT * FROM reading_activity_events')
  })
  await open('wovenleaf://widgets/reading?book=widget-one')
  const dialog = page.getByRole('dialog', { name: 'Record progress' })
  const input = dialog.getByLabel('Which page are you on?')
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('100')
  await input.fill('1')
  await input.fill('101')
  expect(await events()).toHaveLength(0)
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('reading-mobile.png') })
  await dialog.getByRole('button', { name: 'Save progress' }).click()
  await expect(dialog).toBeHidden()
  expect(await events()).toHaveLength(1)
  await open('wovenleaf://widgets/streak')
  await expect(page.getByText('You’ve read today.')).toBeVisible()
  await expect(page.locator('.reading-widget-streak__count')).toHaveText('1')
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('streak-mobile.png') })
  await page.getByRole('button', { name: 'Record progress', exact: true }).click()
  await expect(input).toHaveValue('101')
  await dialog.getByRole('button', { name: 'Next book' }).click()
  await expect(dialog.getByRole('heading', { name: 'A Wizard of Earthsea' })).toBeVisible()
  await input.fill('50')
  await dialog.getByRole('button', { name: 'Save progress' }).click()
  await expect(dialog).toBeHidden()
  expect(await events()).toHaveLength(1)
  await open('wovenleaf://widgets/reading?book=widget-one')
  await expect(input).toHaveValue('101')
  await page.setViewportSize({ width: 320, height: 568 })
  await page.evaluate(() => { document.documentElement.dataset.typeScale = 'x-large'; document.documentElement.dataset.paperMode = 'night' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(dialog.getByRole('button', { name: 'Save progress' })).toBeInViewport()
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('reading-large-type-night.png') })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(errors).toEqual([])
})
