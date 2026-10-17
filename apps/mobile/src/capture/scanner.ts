import { Capacitor, registerPlugin } from '@capacitor/core'
import { inspectIsbnInput, type ValidIsbn } from './isbn'

export type IsbnScanResult =
  | { readonly state: 'scanned'; readonly isbn: ValidIsbn }
  | { readonly state: 'cancelled' }
  | { readonly state: 'denied'; readonly message: string }
  | { readonly state: 'invalid'; readonly message: string }
  | { readonly state: 'unavailable'; readonly message: string }

export interface IsbnScanner {
  scan(): Promise<{ content: string | null }>
}
const nativeScanner = registerPlugin<IsbnScanner>('WovenleafScanner')

export async function scanIsbnBarcode(scanner?: IsbnScanner): Promise<IsbnScanResult> {
  try {
    const active = scanner ?? (Capacitor.isNativePlatform()
      ? nativeScanner : (await import('./web-scanner')).webScanner)
    const result = await active.scan()
    if (!result.content) return { state: 'cancelled' }
    const inspection = inspectIsbnInput(result.content)
    if (inspection.state === 'valid') return { state: 'scanned', isbn: inspection.isbn }
    return {
      state: 'invalid',
      message: inspection.state === 'invalid' ? inspection.message : 'No ISBN was found in that barcode.',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/permission|denied|not allowed|notallowed/i.test(message)) {
      return { state: 'denied', message: 'Camera access is off. Paste or type the ISBN below, or continue with title only.' }
    }
    if (/cancel|closed|close/i.test(message)) return { state: 'cancelled' }
    return { state: 'unavailable', message: 'The camera scanner is unavailable. Paste or type the ISBN below instead.' }
  }
}
