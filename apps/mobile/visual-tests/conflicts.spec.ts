import { expect, test } from '@playwright/test'

test('the conflict inbox is operable by keyboard with named review controls', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto('/__conflicts')
  await page.evaluate(() => document.fonts.ready)

  await expect(page.getByRole('heading', { name: 'Conflict inbox', level: 1 })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Needs your eye' })).toBeVisible()

  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Back to Wovenleaf' })).toBeFocused()

  await page.getByRole('button', { name: /Two honest places in one story/ }).click()
  const group = page.getByRole('group', { name: 'Which should Wovenleaf use?' })
  const radios = group.getByRole('radio')
  await expect(radios).toHaveCount(2)
  await radios.first().focus()
  await page.keyboard.press('ArrowDown')
  await expect(radios.nth(1)).toBeChecked()

  await page.getByRole('button', { name: 'Apply decision' }).click()
  await expect(page.getByRole('status')).toContainText('Two honest places in one story resolved')
  await expect(page.getByRole('button', { name: 'Undo last decision' })).toBeEnabled()

  await page.getByRole('button', { name: 'Undo last decision' }).click()
  await expect(page.getByRole('status')).toContainText('restored to the conflict inbox')
  await expect(page.getByRole('button', { name: 'Apply decision' })).toBeEnabled()
  expect(consoleErrors).toEqual([])
})
