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

  const advanced = page.locator('details.settings-advanced')
  await expect(advanced.locator('summary > .lucide-chevron-down')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your library, with a way home.' })).toBeHidden()
  await advanced.locator('summary').click()
  await expect(advanced.locator('summary > .lucide-chevron-up')).toBeVisible()
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
  await expect(page.getByRole('status')).toContainText('Portable archive verified; EPUB bytes are excluded')

  await page.locator('.recovery-picker input').setInputFiles(path!)
  await expect(page.getByText('Ready for an atomic restore.')).toBeVisible()
  await expect(page.getByText('Checksums, schema, relationships, and redaction boundary are valid.')).toBeVisible()
  await expect(page.getByText('Contract 1 · Schema 7', { exact: true })).toBeVisible()
  await expect(page.getByText('0 files · 0 to relink')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore this backup' })).toBeEnabled()
  await expect(page.getByLabel('Local recovery points')).toBeVisible()
  expect(consoleErrors).toEqual([])
})
