import { expect, test } from '@playwright/test'

test('smart lists compose local rules, preview matches, and explain every result', async ({ context, page }, testInfo) => {
  const consoleErrors: string[] = []
  const networkRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173')) networkRequests.push(request.url())
  })

  await page.setViewportSize({ width: 430, height: 932 })
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState('networkidle')
  await context.setOffline(true)

  await page.getByRole('button', { name: 'New smart list' }).click()
  await expect(page.getByRole('heading', { name: 'New smart list' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Expiring soon/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Unread owned EPUB/ })).toBeVisible()
  await page.getByLabel('List name').fill('Unread queue')
  await expect(page.locator('.smart-list-preview')).toContainText('2of 8 books')
  await expect(page.getByText(/All of: Status is To Be Read/)).toBeVisible()
  await page.getByRole('button', { name: 'Create smart list' }).click()

  await expect(page.getByRole('heading', { name: /Unread queue · 2/ })).toBeVisible()
  await page.locator('.smart-book-reasons').first().locator('summary').click()
  await expect(page.locator('.smart-book-reasons').first().getByText('Why this book is here')).toBeVisible()
  await expect(page.locator('.smart-book-reasons').first().getByText('Status is To Be Read')).toBeVisible()

  await page.getByRole('button', { name: 'Manage Unread queue' }).click()
  await page.getByRole('button', { name: 'Add rule' }).click()
  await page.getByLabel('Field for rule 2').selectOption('rating')
  await page.getByLabel('Operator for rule 2').selectOption('at-least')
  await page.getByLabel('Value for rule 2').fill('5')
  await expect(page.locator('.smart-list-preview')).toContainText('0of 8 books')
  await page.screenshot({ path: testInfo.outputPath('smart-list-editor.png'), fullPage: true })
  await page.getByRole('button', { name: 'Save smart list' }).click()
  await expect(page.getByText('No books match right now')).toBeVisible()

  expect(networkRequests).toEqual([])
  expect(consoleErrors.filter((error) => !error.includes('ERR_INTERNET_DISCONNECTED'))).toEqual([])
})
