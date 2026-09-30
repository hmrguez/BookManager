import { createInstance } from 'i18next'
import { useSyncExternalStore } from 'react'
import { initReactI18next, useTranslation } from 'react-i18next'
import { Capacitor, registerPlugin } from '@capacitor/core'
import en from './catalogs/en.json'
import es from './catalogs/es.json'
import de from './catalogs/de.json'
import it from './catalogs/it.json'
import fr from './catalogs/fr.json'

export const LANGUAGES = ['en', 'es', 'de', 'it', 'fr'] as const
export type Language = typeof LANGUAGES[number]
export type LanguagePreference = Language | 'system'
export type TranslationKey = keyof typeof en
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English', es: 'Español', de: 'Deutsch', it: 'Italiano', fr: 'Français',
}
export const REGIONAL_LOCALES: Record<Language, string> = {
  en: 'en-US', es: 'es-ES', de: 'de-DE', it: 'it-IT', fr: 'fr-FR',
}
export const LANGUAGE_STORAGE_KEY = 'wovenleaf.language.v1'

export function resolveLanguage(preference: unknown, systemLanguages: readonly string[] = []): Language {
  if (LANGUAGES.includes(preference as Language)) return preference as Language
  for (const candidate of systemLanguages) {
    if (typeof candidate !== 'string') continue
    const language = candidate.toLowerCase().split(/[-_]/)[0]
    if (LANGUAGES.includes(language as Language)) return language as Language
  }
  return 'en'
}

function readPreference(): LanguagePreference {
  try {
    const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return value === 'system' || LANGUAGES.includes(value as Language) ? value as LanguagePreference : 'system'
  } catch { return 'system' }
}
let preference = readPreference()
const systemLanguages = () => typeof navigator === 'undefined' ? [] : navigator.languages ?? (navigator.language ? [navigator.language] : [])
let language = resolveLanguage(preference, systemLanguages())
const listeners = new Set<() => void>()
const instance = createInstance()
instance.use(initReactI18next)
void instance.init({
  lng: language, fallbackLng: 'en', supportedLngs: [...LANGUAGES], initAsync: false,
  keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false },
  resources: { en: { translation: en }, es: { translation: es }, de: { translation: de },
    it: { translation: it }, fr: { translation: fr } },
})

const native = registerPlugin<{ setLocale(options: { locale: string }): Promise<void> }>('WovenleafLocalization')
let nativeReady = Promise.resolve()
function applyLanguage() {
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = REGIONAL_LOCALES[language]
  if (Capacitor.isNativePlatform()) {
    nativeReady = native.setLocale({ locale: REGIONAL_LOCALES[language] }).catch(error => {
      console.error('Unable to apply native interface language', error)
      throw error
    })
    // Surface the failure again to native-opening callers without an unhandled rejection.
    void nativeReady.catch(() => {})
  }
}
export function initializeLocalization() { applyLanguage() }

export function getLanguage() { return language }
export function getLocale() { return REGIONAL_LOCALES[language] }
export function getLanguagePreference() { return preference }
export function waitForNativeLanguage() { return nativeReady }
export function subscribeLanguage(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function useLanguage() {
  useTranslation('translation', { i18n: instance })
  useSyncExternalStore(subscribeLanguage, () => `${preference}:${language}`, () => 'system:en')
  return language
}
export function setLanguagePreference(value: LanguagePreference) {
  if (value !== 'system' && !LANGUAGES.includes(value)) return
  preference = value
  language = resolveLanguage(value, systemLanguages())
  try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value) } catch { /* Session preference still applies. */ }
  void instance.changeLanguage(language)
  applyLanguage()
  for (const listener of listeners) listener()
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('languagechange', () => {
    if (preference === 'system') setLanguagePreference('system')
  })
  window.addEventListener('storage', event => {
    if (event.key === LANGUAGE_STORAGE_KEY) setLanguagePreference(readPreference())
  })
}
export function t(key: TranslationKey, parameters: Record<string, unknown> = {}): string {
  return instance.t(key, parameters)
}
export function translateAt(key: TranslationKey, locale: string, parameters: Record<string, unknown> = {}): string {
  return instance.t(key, { ...parameters, lng: resolveLanguage('system', [locale]) })
}
const catalogs: Record<Language, Record<string, string>> = { en, es, de, it, fr }
function escapePattern(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
const historicCopy = LANGUAGES.flatMap(language => Object.entries(catalogs[language]).flatMap(([key, value]) => {
  // Only recognizable app-authored prose qualifies. Generic joins cannot identify an error.
  if (!/[a-zA-Z]/.test(value.replace(/\{\{\w+\}\}/g, ''))) return []
  const names: string[] = []
  let offset = 0, pattern = ''
  for (const match of value.matchAll(/\{\{(\w+)\}\}/g)) {
    pattern += escapePattern(value.slice(offset, match.index))
    const name = match[1]!
    const previous = names.indexOf(name)
    pattern += previous >= 0 ? `\\${previous + 1}` : '(.*?)'
    if (previous < 0) names.push(name)
    offset = match.index + match[0].length
  }
  if (!names.length) return []
  pattern += escapePattern(value.slice(offset))
  return [{ key: key as TranslationKey, names, pattern: new RegExp(`^${pattern}$`, 's') }]
})).sort((left, right) => left.names.length - right.names.length || right.pattern.source.length - left.pattern.source.length)
const historicKeys = new Map(LANGUAGES.flatMap(language => Object.entries(catalogs[language]).map(([key, value]) => [value, key as TranslationKey] as const)))
export function translateKnownCopy(value: string, locale = getLocale(), parameters: Record<string, unknown> = {}): string | undefined {
  if (Object.hasOwn(en, value)) return translateAt(value as TranslationKey, locale, parameters)
  const knownKey = historicKeys.get(value)
  if (knownKey) return translateAt(knownKey, locale, parameters)
  for (const entry of historicCopy) {
    const match = entry.pattern.exec(value)
    if (match) return translateAt(entry.key, locale, { ...parameters, ...Object.fromEntries(entry.names.map((name, index) => [name, match[index + 1]])) })
  }
  return undefined
}
/** Only for app-owned labels and historic app-authored review copy. Never pass book or personal content. */
export function translateCopy(value: string, locale = getLocale(), parameters: Record<string, unknown> = {}): string {
  return translateKnownCopy(value, locale, parameters) ?? value
}
export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(getLocale(), options).format(value)
}
