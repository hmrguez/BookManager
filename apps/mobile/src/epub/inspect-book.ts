import type { EpubInspection, EpubImportProgress } from './model'
import type { PdfInspection } from '../pdf/inspect'

export type EbookInspection = EpubInspection | PdfInspection

export function isPdfBytes(bytes: Uint8Array): boolean {
  return new TextDecoder('ascii').decode(bytes.subarray(0, 1024)).includes('%PDF-')
}

export async function inspectBook(bytes: Uint8Array, options: {
  readonly fileName: string
  readonly mediaType?: string
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: EpubImportProgress) => void
}): Promise<EbookInspection> {
  if (isPdfBytes(bytes) || /\.pdf$/i.test(options.fileName) || options.mediaType === 'application/pdf') {
    const { inspectPdf } = await import('../pdf/inspect')
    return inspectPdf(bytes, options)
  }
  const { inspectEpub } = await import('./inspect')
  return inspectEpub(bytes, options)
}

export function ebookFormat(inspection: EbookInspection): 'epub' | 'pdf' {
  return inspection.packageVersion === 'pdf' ? 'pdf' : 'epub'
}
