import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

test('older WebViews can open and dismiss the upgrade without showModal support', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: undefined }) })
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByText(/of 30 free books · upgrade once for unlimited books/)).toBeVisible()
  await page.getByRole('button', { name: 'Upgrade or restore purchase', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Let your library grow.', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Let your library grow.', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Upgrade or restore purchase', exact: true })).toBeFocused()
})

async function seedBooks(page: Page, count: number) {
  await page.goto('/')
  await page.evaluate(async (size) => {
    const modulePath = '/src/storage/runtime.ts'
    const { getStorageRuntime } = await import(/* @vite-ignore */ modulePath)
    const runtime = await getStorageRuntime()
    await runtime.library.replace(Array.from({ length: size }, (_, i) => ({
      id: `limit-${i}`, title: `Library book ${i}`, authors: ['A Reader'], pageCount: 100,
      shelf: 'tbr', progress: 0, currentPage: 0, rating: 0, notes: '',
      addedAt: '2026-09-08T12:00:00.000Z', lastUpdatedAt: '2026-09-08T12:00:00.000Z',
    })))
  }, count)
  await page.reload()
  await expect(page.getByRole('button', { name: `TBR ${count}`, exact: true })).toBeVisible()
}

async function enterBook(page: Page, title: string) {
  await page.getByRole('button', { name: 'Add Book', exact: true }).click()
  await page.getByRole('button', { name: /No ISBN\? No problem/ }).click()
  await page.getByRole('textbox', { name: 'Book title', exact: true }).fill(title)
  await page.getByRole('button', { name: /^Add to\s*To Be Read$/ }).click()
}

test('book 30 saves; book 31 opens the upgrade, preserves the draft, and traps focus', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedBooks(page, 29)
  await enterBook(page, 'The thirtieth book')
  await expect(page.getByRole('dialog', { name: 'Add a book manually' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'TBR 30', exact: true })).toBeVisible()
  await enterBook(page, 'The thirty-first book')
  const upgrade = page.getByRole('dialog', { name: 'Let your library grow.', exact: true })
  await expect(upgrade).toBeVisible()
  await expect(upgrade.getByText(/Your first 30 books are free/)).toBeVisible()
  await expect(upgrade.getByRole('button', { name: 'Unlock unlimited', exact: true })).toBeDisabled()
  await expect(upgrade.getByRole('button', { name: 'Close upgrade' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(upgrade.getByRole('button', { name: 'Keep my free library' })).toBeFocused()
  await page.screenshot({ path: info.outputPath('upgrade-mobile.png') })
  await page.keyboard.press('Escape')
  await expect(upgrade).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Book title', exact: true })).toHaveValue('The thirty-first book')
  await expect(page.getByRole('button', { name: /^Add to\s*To Be Read$/ })).toBeFocused()
  await page.reload()
  await expect(page.getByRole('button', { name: 'TBR 30', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('store price, cancellation, purchase, restore, and Settings work through the UI', async ({ page }, info) => {
  // Replace only this test browser's native adapter; no production test-unlock flag exists.
  await page.route(/\/src\/purchases\/runtime\.ts(?:\?.*)?$/, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `import { PurchaseService } from '/src/purchases/service.ts';
      let owned = false, attempts = 0;
      const status = () => ({ platform: 'ios', owned, available: true, pending: false, price: '€10.00' });
      export const purchases = new PurchaseService({
        getStatus: async () => status(),
        purchase: async () => { if (++attempts === 1) return { outcome: 'cancelled' }; owned = true; return { outcome: 'purchased' }; },
        restore: async () => { owned = true; return status(); },
        redeem: async () => {}
      }, 'ios');
      export const startPurchases = () => { void purchases.refresh(); };`,
  }))
  await seedBooks(page, 30)
  await enterBook(page, 'The next chapter')
  const upgrade = page.getByRole('dialog', { name: 'Let your library grow.', exact: true })
  const buy = upgrade.getByRole('button', { name: 'Unlock unlimited · €10.00', exact: true })
  await expect(buy).toBeEnabled()
  await page.screenshot({ path: info.outputPath('upgrade-store-mobile.png') })
  await buy.click()
  await expect(buy).toBeEnabled()
  await expect(upgrade).toBeVisible()
  await buy.click()
  await page.getByRole('button', { name: 'Continue to my library' }).click()
  await page.getByRole('button', { name: /^Add to\s*To Be Read$/ }).click()
  await expect(page.getByRole('button', { name: 'TBR 31', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Upgrade or restore purchase', exact: true }).click()
  await page.getByRole('button', { name: 'Restore purchase', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Room for every book.' })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 568 })
  await page.screenshot({ path: info.outputPath('upgrade-small.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: info.outputPath('upgrade-desktop.png') })
})
