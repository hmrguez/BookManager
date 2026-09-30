import { describeSmartListCondition } from '../src/smart-lists/query'
import { parseBookAction } from '../src/search/book-actions'
import { afterEach, describe, expect, test } from 'bun:test'
import en from '../src/localization/catalogs/en.json'
import es from '../src/localization/catalogs/es.json'
import de from '../src/localization/catalogs/de.json'
import it from '../src/localization/catalogs/it.json'
import fr from '../src/localization/catalogs/fr.json'
import { getLanguage, getLanguagePreference, getLocale, resolveLanguage, setLanguagePreference, t, translateAt, translateCopy, translateKnownCopy } from '../src/localization'
import { createLibraryCsv, createLibraryMarkdown } from '../src/storage/portable-archive'
import { createTranslator, localizedPath } from '../../landing/src/localization'
import siteEn from '../../landing/src/localization/catalogs/en.json'
import siteEs from '../../landing/src/localization/catalogs/es.json'
import siteDe from '../../landing/src/localization/catalogs/de.json'
import siteIt from '../../landing/src/localization/catalogs/it.json'
import siteFr from '../../landing/src/localization/catalogs/fr.json'
import type { LibraryBook } from '../src/library-model'

const initial = getLanguagePreference()
afterEach(() => setLanguagePreference(initial))
const placeholders = (value: string) => [...value.matchAll(/\{\{(\w+)\}\}|\{n\}/g)].map(match => match[0]).sort()

describe('interface localization', () => {
  test('matches supported system languages and falls back safely', () => {
    expect(resolveLanguage('system', ['pt-BR', 'de-AT'])).toBe('de')
    expect(resolveLanguage('system', ['es-MX'])).toBe('es')
    expect(resolveLanguage('system', ['ja-JP'])).toBe('en')
    expect(resolveLanguage('fr', ['en-US'])).toBe('fr')
    expect(resolveLanguage('invalid', [])).toBe('en')
  })

  test('all app catalogs contain every source key and preserve runtime values', () => {
    for (const catalog of [es, de, it, fr]) {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort())
      for (const [key, value] of Object.entries(en)) {
        const translated = (catalog as Record<string, string>)[key]!
        expect(translated.trim().length).toBeGreaterThan(0)
        expect(placeholders(translated)).toEqual(placeholders(value))
      }
    }
  })

  test('changes labels and regional formatting immediately and uses plurals', () => {
    setLanguagePreference('es')
    expect(getLanguage()).toBe('es')
    expect(getLocale()).toBe('es-ES')
    expect(t('Library')).toBe('Biblioteca')
    expect(t('bookCount', { count: 1, value: '1' })).toBe('1 libro')
    expect(t('bookCount', { count: 2, value: '2' })).toBe('2 libros')
    setLanguagePreference('de')
    expect(t('Library')).toBe('Bibliothek')
    expect(translateAt('Library', 'fr-FR')).toBe('Bibliothèque')
  })

  test('translates historic app copy without changing unfamiliar personal text', () => {
    setLanguagePreference('es')
    expect(translateCopy('Library')).toBe('Biblioteca')
    expect(translateKnownCopy('Added 4 days ago')).toBe('Añadido hace 4 días')
    expect(translateCopy('My private shelf · Morning light')).toBe('My private shelf · Morning light')
    expect(translateKnownCopy('SQLITE_UNKNOWN_PROVIDER_DIAGNOSTIC')).toBeUndefined()
  })

  test('Markdown follows the interface while CSV and personal content remain stable', () => {
    const book: LibraryBook = { id: 'locale-test', title: 'Unchanged title', authors: ['Original author'], pageCount: 1234, currentPage: 20, progress: 2, rating: 4, notes: 'My private English note', shelf: 'reading', addedAt: '2026-09-01T00:00:00Z', lastUpdatedAt: '2026-09-01T00:00:00Z' }
    setLanguagePreference('en')
    const csv = createLibraryCsv([book])
    setLanguagePreference('es')
    expect(createLibraryCsv([book])).toBe(csv)
    const markdown = createLibraryMarkdown([book], '2026-09-01T00:00:00Z')
    expect(markdown).toContain('Unchanged title')
    expect(markdown).toContain('Original author')
    expect(markdown).toContain('My private English note')
    expect(markdown).toContain('Lectura')
    expect(markdown).not.toContain('Wovenleaf Reading Journal')
  })

  test('smart-list explanations honor an explicit locale without changing stored rules', () => {
    setLanguagePreference('en')
    const rule = { id: 'locale-rule', kind: 'condition' as const, field: 'dateAdded' as const, operator: 'within-last-days' as const, value: 1, negate: false }
    const original = JSON.stringify(rule)
    expect(describeSmartListCondition(rule, 'es-ES')).toContain('1 día')
    expect(describeSmartListCondition(rule, 'de-DE')).toContain('1 Tag')
    expect(getLanguage()).toBe('en')
    expect(JSON.stringify(rule)).toBe(original)
  })

  test('localized book commands retain stable actions and original book queries', () => {
    for (const verb of ['read', 'leer', 'lesen', 'leggi', 'lire']) expect(parseBookAction(`${verb} The Original Title`)?.shelf).toBe('reading')
    for (const verb of ['finish', 'terminar', 'beenden', 'termina', 'terminer']) expect(parseBookAction(`${verb} The Original Title`)?.shelf).toBe('finished')
    for (const verb of ['next', 'próximo', 'nächste', 'prossimo', 'suivant']) expect(parseBookAction(`${verb} The Original Title`)?.shelf).toBe('next')
    expect(parseBookAction('LEER A Title — Original')?.query).toBe('A Title — Original')
    expect(parseBookAction('Unknown book title')).toBeUndefined()
  })

  test('website catalogs preserve all pages, legal markup, and placeholders', () => {
    const tags = (value: string) => value.match(/<\/?[a-z][^>]*>/g) ?? []
    for (const catalog of [siteEs, siteDe, siteIt, siteFr]) {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(siteEn).sort())
      for (const [key, value] of Object.entries(siteEn)) {
        const translated = (catalog as Record<string, string>)[key]!
        expect(translated.trim().length).toBeGreaterThan(0)
        expect(placeholders(translated)).toEqual(placeholders(value))
        expect(tags(translated)).toEqual(tags(value))
      }
    }
  })

  test('website switches the same page and escapes operator values', () => {
    expect(localizedPath('de', '/es/privacy/')).toBe('/de/privacy/')
    expect(localizedPath('en', '/fr/terms/')).toBe('/terms/')
    expect(localizedPath('it', '/')).toBe('/it/')
    const key = Object.keys(siteEn).find(key => key.includes('{{operatorEmail}}'))!
    const translated = createTranslator('es')(key as Parameters<ReturnType<typeof createTranslator>>[0], { operatorEmail: '<script>bad</script>' })
    expect(translated).not.toContain('<script>bad</script>')
    expect(translated).toContain('&lt;script&gt;bad&lt;/script&gt;')
  })
})
