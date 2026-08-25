import { expect, test, type Page } from '@playwright/test'

interface GalleryScenario {
  id: string
  query: string
  viewport: { width: number; height: number }
}

const scenarios: GalleryScenario[] = [
  {
    id: 'warm-interactions',
    query: 'view=primitives&paper=warm&contrast=standard&type=standard&motion=reduced&texture=off',
    viewport: { width: 1180, height: 900 },
  },
  {
    id: 'night-high-composites',
    query: 'view=composites&paper=night&contrast=high&type=standard&motion=reduced&texture=off',
    viewport: { width: 430, height: 932 },
  },
  {
    id: 'large-feedback',
    query: 'view=feedback&paper=print&contrast=standard&type=x-large&motion=reduced&texture=off',
    viewport: { width: 430, height: 932 },
  },
]

async function settleGallery(page: Page, scenario: GalleryScenario) {
  await page.setViewportSize(scenario.viewport)
  await page.goto(`/__gallery?${scenario.query}`)
  await page.evaluate(() => document.fonts.ready)
  await expect(page.getByText('Development only')).toBeVisible()
}

for (const scenario of scenarios) {
  test(`${scenario.id} stays visually stable`, async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await settleGallery(page, scenario)

    await expect(page.getByTestId('gallery-canvas')).toHaveScreenshot(`${scenario.id}.png`)
    expect(consoleErrors).toEqual([])
  })
}

test('the gallery keyboard path exposes named controls and focus', async ({ page }) => {
  await settleGallery(page, scenarios[0])

  await page.keyboard.press('Tab')
  const focusedName = await page.locator(':focus').getAttribute('aria-label')
  expect(focusedName).toBe('Back to Wovenleaf')

  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'All specimens' })).toBeFocused()
})
