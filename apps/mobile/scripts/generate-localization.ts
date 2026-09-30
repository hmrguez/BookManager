import { mkdir, readFile, writeFile } from 'node:fs/promises'
const languages = ['en', 'es', 'de', 'it', 'fr']
const output = new URL('../public/locales/', import.meta.url)
await mkdir(output, { recursive: true })
for (const language of languages) {
  const source = await readFile(new URL(`../src/localization/catalogs/${language}.json`, import.meta.url), 'utf8')
  await writeFile(new URL(`${language}.json`, output), source)
}
