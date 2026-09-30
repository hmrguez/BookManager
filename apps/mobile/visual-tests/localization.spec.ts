import { readFileSync, mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const languages = ['en', 'es', 'de', 'it', 'fr'] as const
const names = { en: 'My Books', es: 'Mis libros', de: 'Meine Bücher', it: 'I miei libri', fr: 'Mes livres' }
const locales = { en: 'en-US', es: 'es-ES', de: 'de-DE', it: 'it-IT', fr: 'fr-FR' }
const titles = ['Mistborn', "Assassin’s Apprentice", 'The Tainted Cup', 'Piranesi']
const authors = ['Brandon Sanderson', 'Robin Hobb', 'Robert Jackson Bennett', 'Susanna Clarke']
const covers = [1, 2, 4, 3].map(number => `data:image/jpeg;base64,${readFileSync(new URL(`../../../branding/marketing/covers/book-${number}.jpg`, import.meta.url)).toString('base64')}`)
const books = titles.map((title, index) => ({ id: `locale-${index}`, title, authors: [authors[index]], thumbnail: covers[index], pageCount: [541, 448, 400, 272][index], currentPage: index === 2 ? 268 : index === 3 ? 272 : 0, progress: index === 2 ? 67 : index === 3 ? 100 : 0, rating: index === 3 ? 5 : 0, notes: '', shelf: ['tbr', 'next', 'reading', 'finished'][index], addedAt: '2026-09-01T10:00:00.000Z', lastUpdatedAt: '2026-09-01T10:00:00.000Z' }))

for (const language of languages) {
  test(`${language}: localized library, player, and persistent language selection`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(({ language, books }) => {
      if (!localStorage.getItem('locale-capture-seeded')) {
        localStorage.setItem('wovenleaf.language.v1', language)
        localStorage.setItem('wovenleaf.library.v1', JSON.stringify(books))
        localStorage.setItem('wovenleaf.library-view.v1', 'list')
        localStorage.setItem('locale-capture-seeded', 'true')
      }
    }, { language, books })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: names[language], exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', locales[language])
    await expect(page.locator('#shelf-tbr .book-row')).toHaveCount(1)
    await page.evaluate(() => document.fonts.ready)
    const output = new URL(`../../../apps/landing/public/screenshots/${language}/`, import.meta.url)
    mkdirSync(output, { recursive: true })
    await page.screenshot({ path: new URL('library.jpg', output).pathname, type: 'jpeg', quality: 90, animations: 'disabled' })
    await page.setViewportSize({ width: 320, height: 740 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.locator('.bottom-nav button').last().click()
    const choice = page.locator('.appearance-field select').first()
    await expect(choice).toHaveValue(language)
    const alternate = language === 'es' ? 'fr' : 'es'
    await choice.selectOption(alternate)
    await expect(page.locator('html')).toHaveAttribute('lang', locales[alternate])
    await expect(page.locator('.bottom-nav button').last()).toHaveText(alternate === 'fr' ? 'Réglages' : 'Ajustes')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', locales[alternate])
    await page.locator('.bottom-nav button').last().click()
    await page.locator('.appearance-field select').first().selectOption('system')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
    await page.locator('.bottom-nav button').last().click()
    await expect(page.locator('.appearance-field select').first()).toHaveValue('system')
    await page.locator('.appearance-field select').first().selectOption(language)
    await page.locator('.bottom-nav button').first().click()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.locator('.command-trigger').click()
    const verb = { en: 'read', es: 'leer', de: 'lesen', it: 'leggi', fr: 'lire' }[language]
    await page.locator('.command-palette__search input').fill(`${verb} Mistborn`)
    await expect(page.locator('.command-palette__result strong')).toContainText('Mistborn')
    await page.locator('.command-palette__search input').press('Enter')
    await expect(page.locator('#shelf-reading [data-library-book="locale-0"]')).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/__marketing-player')
    await expect(page.locator('.audiobook-player')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', locales[language])
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: new URL('audiobook.jpg', output).pathname, type: 'jpeg', quality: 90, animations: 'disabled' })
    await page.screenshot({ path: testInfo.outputPath(`player-${language}.png`) })
    expect(errors).toEqual([])
  })
}
