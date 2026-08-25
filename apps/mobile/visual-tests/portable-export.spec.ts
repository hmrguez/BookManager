import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('portable export explains its boundary and downloads a valid local archive', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.getByRole('heading', { name: 'My Books', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()

  await expect(page.getByRole('heading', { name: 'Your library, with a way home.' })).toBeVisible()
  await expect(page.getByText('Passwords, API keys, and secure credentials')).toBeVisible()
  await expect(page.getByText('Cover, ebook, and audiobook files')).toBeVisible()
  await expect(page.getByRole('button', { name: /Private notes and ratings/ })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: /Private notes and ratings/ }).click()
  await expect(page.getByText('Redacted from every exported file')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Portable JSON archive/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^wovenleaf-library-\d{4}-\d{2}-\d{2}\.wovenleaf\.json$/)

  const path = await download.path()
  expect(path).not.toBeNull()
  const archive = JSON.parse(await readFile(path!, 'utf8')) as {
    manifest: {
      format: string
      redactions: { privateAnnotations: string; credentialMaterial: string }
      entries: Array<{ path: string; fidelity: string }>
    }
  }
  expect(archive.manifest).toMatchObject({
    format: 'wovenleaf-portable-library',
    redactions: {
      privateAnnotations: 'excluded',
      credentialMaterial: 'excluded',
    },
  })
  expect(archive.manifest.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'data/catalog.json', fidelity: 'canonical' }),
    expect.objectContaining({ path: 'views/library.csv', fidelity: 'lossy' }),
  ]))
  await expect(page.getByRole('status')).toContainText('Portable archive verified and ready')
  expect(consoleErrors).toEqual([])
})
