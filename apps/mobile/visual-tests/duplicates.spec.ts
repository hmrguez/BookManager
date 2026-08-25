import { expect, test } from '@playwright/test'

test('duplicate review explains evidence, previews destinations, and keeps undo in reach', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto('/__duplicates')
  await page.evaluate(() => document.fonts.ready)

  await expect(page.getByRole('heading', { name: 'Duplicate review', level: 1 })).toBeVisible()
  await expect(page.getByText('Low-confidence matches wait here')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Evidence ledger' })).toBeVisible()
  await expect(page.getByText('Exact ISBN-13')).toBeVisible()
  await expect(page.getByText('Identifier crosses formats')).toBeVisible()

  const preview = page.getByRole('region', { name: 'Choose the destination' })
  await expect(preview.getByText('Progress')).toBeVisible()
  await expect(preview.getByText('Annotations')).toBeVisible()
  await expect(preview.getByText('Lists')).toBeVisible()
  await expect(preview.getByText('Loans')).toBeVisible()
  await expect(preview.getByText('Assets')).toBeVisible()

  await page.getByRole('button', { name: /Merge into The Left Hand of Darkness/ }).click()
  await expect(page.getByRole('status')).toContainText('Edition identities and attached reader data stayed intact')
  await expect(page.getByRole('button', { name: 'Undo last decision' })).toBeEnabled()
  await page.getByRole('button', { name: 'Undo last decision' }).click()
  await expect(page.getByRole('status')).toContainText('exact Work and Edition assignments are restored')

  await page.getByRole('button', { name: /Piranesi/ }).click()
  await page.getByRole('button', { name: 'Keep separate' }).click()
  await expect(page.getByRole('status')).toContainText('Kept as separate Works')
  expect(consoleErrors).toEqual([])
})
