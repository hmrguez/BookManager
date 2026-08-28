import type {
  CapacitorBarcodeScannerOptions,
  CapacitorBarcodeScannerScanResult,
} from '@capacitor/barcode-scanner'
import { inspectIsbnInput, type ValidIsbn } from './isbn'

export type IsbnScanResult =
  | { readonly state: 'scanned'; readonly isbn: ValidIsbn }
  | { readonly state: 'cancelled' }
  | { readonly state: 'denied'; readonly message: string }
  | { readonly state: 'invalid'; readonly message: string }
  | { readonly state: 'unavailable'; readonly message: string }

type BarcodeScanner = {
  scanBarcode(options: CapacitorBarcodeScannerOptions): Promise<CapacitorBarcodeScannerScanResult>
}

export async function scanIsbnBarcode(
  scanner?: BarcodeScanner,
): Promise<IsbnScanResult> {
  try {
    const barcode = await import('@capacitor/barcode-scanner')
    const activeScanner = scanner ?? barcode.CapacitorBarcodeScanner
    const result = await activeScanner.scanBarcode({
      hint: barcode.CapacitorBarcodeScannerTypeHint.ALL,
      cameraDirection: barcode.CapacitorBarcodeScannerCameraDirection.BACK,
      scanInstructions: 'Center the ISBN barcode. Use the torch when the page is dark.',
      scanButton: false,
      cancelButtonAccessibilityLabel: 'Cancel ISBN scan',
      torchButtonOffAccessibilityLabel: 'Turn flashlight on',
      torchButtonOnAccessibilityLabel: 'Turn flashlight off',
      android: { scanningLibrary: barcode.CapacitorBarcodeScannerAndroidScanningLibrary.MLKIT },
      web: { showCameraSelection: true, scannerFPS: 10 },
    })
    if (!result.ScanResult) return { state: 'cancelled' }
    const inspection = inspectIsbnInput(result.ScanResult)
    if (inspection.state === 'valid') return { state: 'scanned', isbn: inspection.isbn }
    return {
      state: 'invalid',
      message: inspection.state === 'invalid'
        ? inspection.message
        : 'No ISBN was found in that barcode.',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/permission|denied|not allowed|notallowed/i.test(message)) {
      return {
        state: 'denied',
        message: 'Camera access is off. Paste or type the ISBN below, or continue with title only.',
      }
    }
    if (/cancel|closed|close/i.test(message)) return { state: 'cancelled' }
    return {
      state: 'unavailable',
      message: 'The camera scanner is unavailable. Paste or type the ISBN below instead.',
    }
  }
}
