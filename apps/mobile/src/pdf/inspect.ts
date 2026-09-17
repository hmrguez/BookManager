import { PDFDocument, PDFName, PDFString, PDFHexString } from 'pdf-lib'
import { EpubImportError, MAX_EPUB_ARCHIVE_BYTES, throwIfEpubImportCanceled, type EpubInspection, type EpubImportProgress } from '../epub/model'
import { sha256 as sha256Hex } from '../audiobooks/binary'

export type PdfInspection = Omit<EpubInspection, 'packageVersion' | 'compatibility'> & {
  readonly packageVersion: 'pdf'
  readonly pageCount: number
  readonly compatibility?: undefined
}

export async function inspectPdf(bytes: Uint8Array, options: {
  readonly fileName: string
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: EpubImportProgress) => void
}): Promise<PdfInspection> {
  throwIfEpubImportCanceled(options.signal)
  if (bytes.byteLength > MAX_EPUB_ARCHIVE_BYTES) {
    throw new EpubImportError('archive-too-large', 'This PDF exceeds the 256 MB import limit.')
  }
  options.onProgress?.({ stage: 'validating', fileName: options.fileName, detail: 'Checking the PDF and reading its metadata' })
  try {
    const document = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true, ignoreEncryption: true })
    throwIfEpubImportCanceled(options.signal)
    if (document.isEncrypted) throw new EpubImportError('drm-protected', 'Password-protected PDFs are not supported. Choose an unprotected copy.')
    const pageCount = document.getPageCount()
    if (pageCount < 1) throw new Error('No pages')
    const rawLanguage = document.catalog.get(PDFName.of('Lang'))
    const language = rawLanguage instanceof PDFString || rawLanguage instanceof PDFHexString
      ? rawLanguage.decodeText() : 'und'
    const contentHash = await sha256Hex(bytes)
    throwIfEpubImportCanceled(options.signal)
    return {
      contentHash,
      byteSize: bytes.byteLength,
      pageCount,
      entryCount: 1,
      packagePath: '',
      packageVersion: 'pdf',
      // PDF metadata is often absent or reused. Only identical bytes or an explicit
      // attachment may associate PDFs; never merge documents by title/author alone.
      packageIdentifier: `pdf:sha256:${contentHash}`,
      title: document.getTitle()?.trim() || options.fileName.replace(/\.pdf$/i, '') || 'Untitled PDF',
      creators: document.getAuthor()?.trim() ? [document.getAuthor()!.trim()] : [],
      language: /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(language) ? language : 'und',
      identifiers: [],
      containsScriptedContent: false,
    }
  } catch (error) {
    if (error instanceof EpubImportError) throw error
    throw new EpubImportError('invalid-package', 'This PDF is damaged or has no readable pages.', { cause: error })
  }
}
