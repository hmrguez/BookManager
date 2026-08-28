import { canonicalEditionIsbn, normalizeIsbn } from '../metadata/model'

export type ValidIsbn = {
  readonly normalized: string
  readonly canonical: string
  readonly scheme: 'isbn-10' | 'isbn-13'
}

export type IsbnInspection =
  | { readonly state: 'empty' }
  | { readonly state: 'valid'; readonly isbn: ValidIsbn }
  | { readonly state: 'invalid'; readonly normalized: string; readonly message: string }

/**
 * Validates pasted or typed ISBN content entirely on-device. The input may be a
 * bare ISBN, a labelled sentence, or a URL copied from a bookseller.
 */
export function inspectIsbnInput(input: string): IsbnInspection {
  const cleanInput = input.trim()
  if (!cleanInput) return { state: 'empty' }

  const embedded = extractValidIsbn(cleanInput)
  if (embedded) return { state: 'valid', isbn: embedded }

  const normalized = cleanInput.toLocaleUpperCase().replace(/[^0-9X]/g, '')
  if (normalized.length === 10 || normalized.length === 13) {
    return {
      state: 'invalid',
      normalized,
      message: `That ${normalized.length}-digit ISBN has an invalid checksum. Check the printed number and try again.`,
    }
  }

  return {
    state: 'invalid',
    normalized,
    message: 'Enter an ISBN-10 or ISBN-13. Spaces and hyphens are fine.',
  }
}

export function extractValidIsbn(input: string): ValidIsbn | undefined {
  const candidates = candidateStrings(input)
  for (const candidate of candidates) {
    const normalized = normalizeIsbn(candidate)
    const canonical = normalized ? canonicalEditionIsbn(normalized) : undefined
    if (!normalized || !canonical) continue
    return {
      normalized,
      canonical,
      scheme: normalized.length === 10 ? 'isbn-10' : 'isbn-13',
    }
  }
  return undefined
}

export function isbnLabel(isbn: ValidIsbn): string {
  return `${isbn.scheme === 'isbn-10' ? 'ISBN-10' : 'ISBN-13'} · ${isbn.normalized}`
}

function candidateStrings(input: string): readonly string[] {
  const upper = input.toLocaleUpperCase()
  const candidates: string[] = [upper]

  for (const match of upper.matchAll(/97[89](?:[\s-]*\d){10}/g)) {
    candidates.push(match[0])
  }
  for (const match of upper.matchAll(/(?:^|[^0-9])((?:\d[\s-]*){9}[\dX])(?=$|[^0-9X])/g)) {
    if (match[1]) candidates.push(match[1])
  }
  for (const match of upper.matchAll(/\d{13}|\d{9}[\dX]/g)) {
    candidates.push(match[0])
  }

  return candidates
}
