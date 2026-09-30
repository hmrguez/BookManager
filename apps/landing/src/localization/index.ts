import en from './catalogs/en.json';
import es from './catalogs/es.json';
import de from './catalogs/de.json';
import it from './catalogs/it.json';
import fr from './catalogs/fr.json';

export const languages = ['en', 'es', 'de', 'it', 'fr'] as const;
export type Language = (typeof languages)[number];
export const languageNames = {
  en: 'English',
  es: 'Español',
  de: 'Deutsch',
  it: 'Italiano',
  fr: 'Français',
};
const catalogs: Record<Language, Record<string, string>> = {
  en,
  es,
  de,
  it,
  fr,
};
export function localeFromPath(path: string): Language {
  const segment = path.split('/')[1];
  return languages.includes(segment as Language) ? (segment as Language) : 'en';
}
export function regionalLocale(language: Language) {
  return { en: 'en-US', es: 'es-ES', de: 'de-DE', it: 'it-IT', fr: 'fr-FR' }[
    language
  ];
}
export function localizedPath(language: Language, path: string) {
  const unprefixed = path.replace(/^\/(?:es|de|it|fr)(?=\/|$)/, '') || '/';
  return language === 'en' ? unprefixed : `/${language}${unprefixed}`;
}
export function screenshotPath(
  language: Language,
  name: 'library' | 'reader' | 'audiobook',
) {
  return `/screenshots/${language}/${name}.jpg`;
}
function escapeHtml(value: unknown) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
}
/** Catalog HTML is versioned app-authored content; interpolated public operator values are escaped. */
export function createTranslator(language: Language) {
  return (key: keyof typeof en, parameters: Record<string, unknown> = {}) => {
    let result = catalogs[language][key] ?? en[key];
    result = result.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      escapeHtml(parameters[name] ?? ''),
    );
    return result.replace(
      /href="\/(privacy|terms)\/"/g,
      (_, page: string) => `href="${localizedPath(language, `/${page}/`)}"`,
    );
  };
}
