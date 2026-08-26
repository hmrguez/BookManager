import { DOMParser } from '@xmldom/xmldom'
import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom'
import JSZip, { type JSZipObject } from 'jszip'
import {
  EPUB_MEDIA_TYPE,
  EpubImportError,
  MAX_EPUB_ARCHIVE_BYTES,
  throwIfEpubImportCanceled,
  type EpubIdentifier,
  type EpubInspection,
  type EpubImportProgress,
} from './model'

export const EPUB_SAFETY_LIMITS = {
  maxArchiveBytes: MAX_EPUB_ARCHIVE_BYTES,
  maxEntries: 10_000,
  maxEntryBytes: 256 * 1024 * 1024,
  maxExpandedBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxContainerBytes: 1024 * 1024,
  maxPackageBytes: 4 * 1024 * 1024,
  maxCoverBytes: 16 * 1024 * 1024,
} as const

type InspectEpubOptions = {
  readonly fileName: string
  readonly mediaType?: string
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: EpubImportProgress) => void
}

type CentralEntry = {
  readonly name: string
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly encrypted: boolean
}

const ALLOWED_INPUT_MEDIA_TYPES = new Set([
  '',
  EPUB_MEDIA_TYPE,
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
])
const ALLOWED_OBFUSCATION_ALGORITHMS = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC',
])

export async function inspectEpub(
  bytes: Uint8Array,
  options: InspectEpubOptions,
): Promise<EpubInspection> {
  const { fileName, mediaType = '', signal, onProgress } = options
  throwIfEpubImportCanceled(signal)
  onProgress?.({ stage: 'validating', fileName, detail: 'Checking the EPUB container' })
  validateInputIdentity(fileName, mediaType)
  if (bytes.byteLength > EPUB_SAFETY_LIMITS.maxArchiveBytes) {
    throw new EpubImportError(
      'archive-too-large',
      `This EPUB is larger than the ${formatMegabytes(EPUB_SAFETY_LIMITS.maxArchiveBytes)} MB import limit.`,
    )
  }
  validateMimetypeEntry(bytes)
  const centralEntries = readCentralDirectory(bytes)
  validateArchiveEntries(centralEntries)
  throwIfEpubImportCanceled(signal)

  let archive: JSZip
  try {
    archive = await JSZip.loadAsync(bytes, { createFolders: false, checkCRC32: false })
  } catch (error) {
    throw new EpubImportError(
      'invalid-container',
      'The file is not a readable EPUB container. Try a fresh DRM-free copy.',
      { cause: error },
    )
  }

  const centralByName = new Map(centralEntries.map((entry) => [entry.name, entry]))
  const containerFile = requireFile(archive, 'META-INF/container.xml')
  assertExtractableSize(containerFile.name, centralByName, EPUB_SAFETY_LIMITS.maxContainerBytes)
  const containerDocument = parseXml(await containerFile.async('text'), 'EPUB container')
  const rootfile = elements(containerDocument, 'rootfile').find((node) =>
    node.getAttribute('media-type') === 'application/oebps-package+xml',
  ) ?? elements(containerDocument, 'rootfile')[0]
  const packagePath = normalizeArchivePath(rootfile?.getAttribute('full-path') ?? '', 'package path')
  const packageFile = requireFile(archive, packagePath)
  assertExtractableSize(packageFile.name, centralByName, EPUB_SAFETY_LIMITS.maxPackageBytes)
  const packageDocument = parseXml(await packageFile.async('text'), 'EPUB package')
  await validateProtection(archive, centralByName)
  throwIfEpubImportCanceled(signal)

  const packageElement = elements(packageDocument, 'package')[0]
  const rawVersion = packageElement?.getAttribute('version')?.trim() ?? ''
  const packageVersion = rawVersion.startsWith('2') ? '2' : rawVersion.startsWith('3') ? '3' : undefined
  if (!packageVersion) {
    throw new EpubImportError(
      'unsupported-version',
      `This package declares EPUB ${rawVersion || 'without a version'}. Wovenleaf supports DRM-free EPUB 2 and EPUB 3.`,
    )
  }

  const title = requiredMetadataText(packageDocument, 'title', 'The EPUB package has no title.')
  const language = requiredMetadataText(packageDocument, 'language', 'The EPUB package has no language.')
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) {
    throw new EpubImportError('invalid-package', `The EPUB language “${language}” is not a valid language tag.`)
  }
  const identifierElements = elements(packageDocument, 'identifier')
  if (identifierElements.length === 0) {
    throw new EpubImportError('invalid-package', 'The EPUB package has no publication identifier.')
  }
  const uniqueIdentifierId = packageElement?.getAttribute('unique-identifier')
  const uniqueIdentifier = identifierElements.find((element) => element.getAttribute('id') === uniqueIdentifierId)
    ?? identifierElements[0]
  const packageIdentifier = textContent(uniqueIdentifier)
  if (!packageIdentifier) {
    throw new EpubImportError('invalid-package', 'The EPUB publication identifier is empty.')
  }

  const manifestItems = elements(packageDocument, 'item')
  const manifestById = new Map(manifestItems.flatMap((item) => {
    const id = item.getAttribute('id')?.trim()
    return id ? [[id, item] as const] : []
  }))
  const spineItems = elements(packageDocument, 'itemref')
  if (spineItems.length === 0 || spineItems.some((item) => !manifestById.has(item.getAttribute('idref') ?? ''))) {
    throw new EpubImportError('invalid-package', 'The EPUB reading order is missing or references unknown content.')
  }

  const coverItem = findCoverItem(packageDocument, manifestItems, manifestById)
  const cover = coverItem ? await extractCover(coverItem, packagePath, archive, centralByName) : undefined
  const identifiers = distinctIdentifiers(identifierElements.map(readIdentifier).filter(isIdentifier))
  const containsScriptedContent = manifestItems.some((item) => {
    const properties = item.getAttribute('properties')?.split(/\s+/) ?? []
    return properties.includes('scripted') || item.getAttribute('media-type') === 'application/javascript'
  })

  onProgress?.({ stage: 'fingerprinting', fileName, detail: 'Fingerprinting the original package' })
  const contentHash = await sha256(bytes)
  throwIfEpubImportCanceled(signal)
  const publicationDate = optionalMetadataText(packageDocument, 'date')

  return {
    contentHash,
    byteSize: bytes.byteLength,
    entryCount: centralEntries.length,
    packagePath,
    packageVersion,
    packageIdentifier,
    title,
    creators: elements(packageDocument, 'creator').map(textContent).filter(Boolean),
    language,
    ...(optionalMetadataText(packageDocument, 'publisher') ? { publisher: optionalMetadataText(packageDocument, 'publisher') } : {}),
    ...(publicationDate && publicationDate.length >= 4 ? { publicationDate } : {}),
    identifiers,
    ...(cover ? { cover } : {}),
    containsScriptedContent,
  }
}

function validateInputIdentity(fileName: string, mediaType: string): void {
  const normalizedMediaType = mediaType.split(';', 1)[0].trim().toLocaleLowerCase()
  const hasEpubExtension = fileName.toLocaleLowerCase().endsWith('.epub')
  if (!hasEpubExtension && normalizedMediaType !== EPUB_MEDIA_TYPE) {
    throw new EpubImportError('wrong-media-type', 'Choose an .epub file. PDF, audiobook, and archive imports stay separate.')
  }
  if (!ALLOWED_INPUT_MEDIA_TYPES.has(normalizedMediaType) && normalizedMediaType !== EPUB_MEDIA_TYPE) {
    throw new EpubImportError('wrong-media-type', `“${fileName}” is labelled ${normalizedMediaType || 'with an unknown type'}, not EPUB.`)
  }
}

function validateMimetypeEntry(bytes: Uint8Array): void {
  const view = dataView(bytes)
  if (view.byteLength < 30 || view.getUint32(0, true) !== 0x04034b50) {
    throw new EpubImportError('invalid-container', 'The file does not begin with a valid EPUB ZIP entry.')
  }
  const compression = view.getUint16(8, true)
  const flags = view.getUint16(6, true)
  const compressedSize = view.getUint32(18, true)
  const uncompressedSize = view.getUint32(22, true)
  const nameLength = view.getUint16(26, true)
  const extraLength = view.getUint16(28, true)
  const nameStart = 30
  const contentStart = nameStart + nameLength + extraLength
  if (contentStart + EPUB_MEDIA_TYPE.length > bytes.byteLength) {
    throw new EpubImportError('invalid-container', 'The EPUB mimetype entry is truncated.')
  }
  const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength))
  const content = new TextDecoder().decode(bytes.subarray(contentStart, contentStart + EPUB_MEDIA_TYPE.length))
  if (
    name !== 'mimetype'
    || compression !== 0
    || (flags & 0x9) !== 0
    || compressedSize !== EPUB_MEDIA_TYPE.length
    || uncompressedSize !== EPUB_MEDIA_TYPE.length
    || extraLength !== 0
    || content !== EPUB_MEDIA_TYPE
  ) {
    throw new EpubImportError(
      'invalid-container',
      'The package is not a conforming EPUB: its first entry must be the uncompressed EPUB mimetype.',
    )
  }
}

function readCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  const view = dataView(bytes)
  const minimumOffset = Math.max(0, bytes.byteLength - 65_557)
  let endOffset = -1
  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0) throw new EpubImportError('invalid-container', 'The EPUB ZIP directory is missing or truncated.')

  const entryCount = view.getUint16(endOffset + 10, true)
  const directorySize = view.getUint32(endOffset + 12, true)
  const directoryOffset = view.getUint32(endOffset + 16, true)
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new EpubImportError('archive-too-large', 'ZIP64 EPUB packages are outside Wovenleaf’s safe import limits.')
  }
  if (directoryOffset + directorySize > endOffset || entryCount > EPUB_SAFETY_LIMITS.maxEntries) {
    throw new EpubImportError('invalid-container', 'The EPUB ZIP directory contains unsafe bounds or too many entries.')
  }

  const entries: CentralEntry[] = []
  let offset = directoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || view.getUint32(offset, true) !== 0x02014b50) {
      throw new EpubImportError('invalid-container', 'The EPUB ZIP directory is malformed.')
    }
    const flags = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength
    if (nextOffset > endOffset) throw new EpubImportError('invalid-container', 'An EPUB ZIP entry is truncated.')
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    entries.push({ name, compressedSize, uncompressedSize, encrypted: (flags & 0x1) !== 0 })
    offset = nextOffset
  }
  return entries
}

function validateArchiveEntries(entries: readonly CentralEntry[]): void {
  const names = new Set<string>()
  let compressedTotal = 0
  let expandedTotal = 0
  for (const entry of entries) {
    const normalized = normalizeArchivePath(entry.name, 'archive entry')
    const caseKey = normalized.toLocaleLowerCase()
    if (names.has(caseKey)) {
      throw new EpubImportError('unsafe-path', `The EPUB repeats the archive path “${normalized}”.`)
    }
    names.add(caseKey)
    if (entry.encrypted) {
      throw new EpubImportError('encrypted-archive', 'The EPUB ZIP itself is encrypted. Only DRM-free EPUB files can be imported.')
    }
    if (entry.uncompressedSize > EPUB_SAFETY_LIMITS.maxEntryBytes) {
      throw new EpubImportError('archive-bomb', `The EPUB entry “${normalized}” expands beyond the safe per-file limit.`)
    }
    if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > EPUB_SAFETY_LIMITS.maxCompressionRatio) {
      throw new EpubImportError('archive-bomb', `The EPUB entry “${normalized}” has an unsafe compression ratio.`)
    }
    compressedTotal += entry.compressedSize
    expandedTotal += entry.uncompressedSize
  }
  if (expandedTotal > EPUB_SAFETY_LIMITS.maxExpandedBytes
    || (compressedTotal > 0 && expandedTotal / compressedTotal > EPUB_SAFETY_LIMITS.maxCompressionRatio)) {
    throw new EpubImportError('archive-bomb', 'The EPUB would expand beyond Wovenleaf’s safe archive limits.')
  }
  const mimetype = entries.find(({ name }) => name === 'mimetype')
  if (!mimetype || mimetype.compressedSize !== EPUB_MEDIA_TYPE.length || mimetype.uncompressedSize !== EPUB_MEDIA_TYPE.length) {
    throw new EpubImportError('invalid-container', 'The EPUB ZIP directory does not contain a valid mimetype entry.')
  }
}

async function validateProtection(
  archive: JSZip,
  entries: ReadonlyMap<string, CentralEntry>,
): Promise<void> {
  if (archive.file('META-INF/license.lcpl')) {
    throw new EpubImportError(
      'drm-protected',
      'This EPUB contains a Readium LCP license. Wovenleaf imports only DRM-free books and does not offer circumvention.',
    )
  }
  const encryption = archive.file('META-INF/encryption.xml')
  if (!encryption) return
  assertExtractableSize(encryption.name, entries, EPUB_SAFETY_LIMITS.maxContainerBytes)
  const document = parseXml(await encryption.async('text'), 'EPUB encryption manifest')
  const encryptedData = elements(document, 'EncryptedData')
  for (const record of encryptedData) {
    const method = descendantElements(record, 'EncryptionMethod')[0]
    const algorithm = method?.getAttribute('Algorithm') ?? method?.getAttribute('algorithm') ?? ''
    const reference = descendantElements(record, 'CipherReference')[0]
    const uri = reference?.getAttribute('URI') ?? reference?.getAttribute('uri') ?? ''
    if (!ALLOWED_OBFUSCATION_ALGORITHMS.has(algorithm)) {
      throw new EpubImportError(
        'drm-protected',
        'This EPUB uses protected content. Wovenleaf imports only DRM-free books and does not offer circumvention.',
      )
    }
    if (!uri) throw new EpubImportError('invalid-package', 'The EPUB font-obfuscation record has no resource path.')
    const protectedPath = normalizeArchivePath(uri, 'font-obfuscation path')
    if (!archive.file(protectedPath)) {
      throw new EpubImportError('invalid-package', `The EPUB protects a missing resource “${protectedPath}”.`)
    }
  }
}

async function extractCover(
  item: XmlElement,
  packagePath: string,
  archive: JSZip,
  entries: ReadonlyMap<string, CentralEntry>,
) {
  const href = item.getAttribute('href')?.trim()
  const mediaType = item.getAttribute('media-type')?.trim()
  if (!href || !mediaType?.startsWith('image/')) return undefined
  const path = resolvePackageHref(packagePath, href)
  const file = requireFile(archive, path)
  assertExtractableSize(file.name, entries, EPUB_SAFETY_LIMITS.maxCoverBytes)
  const bytes = await file.async('uint8array')
  return { path, mediaType, bytes, sha256: await sha256(bytes) }
}

function findCoverItem(
  document: XmlDocument,
  manifestItems: readonly XmlElement[],
  manifestById: ReadonlyMap<string, XmlElement>,
): XmlElement | undefined {
  const epub3Cover = manifestItems.find((item) =>
    item.getAttribute('properties')?.split(/\s+/).includes('cover-image'),
  )
  if (epub3Cover) return epub3Cover
  const coverId = elements(document, 'meta').find((meta) =>
    meta.getAttribute('name')?.toLocaleLowerCase() === 'cover',
  )?.getAttribute('content')
  return coverId ? manifestById.get(coverId) : undefined
}

function readIdentifier(element: XmlElement): EpubIdentifier | undefined {
  const value = textContent(element)
  if (!value) return undefined
  const declaredScheme = (element.getAttribute('opf:scheme') ?? element.getAttribute('scheme') ?? '').toLocaleLowerCase()
  const isbnCandidate = value.replace(/^urn:isbn:/i, '').replace(/[\s-]/g, '').toLocaleUpperCase()
  if (declaredScheme.includes('isbn') || /^urn:isbn:/i.test(value) || /^\d{9}[\dX]$|^\d{13}$/.test(isbnCandidate)) {
    if (/^\d{9}[\dX]$/.test(isbnCandidate)) return { scheme: 'isbn-10', value, normalizedValue: isbnCandidate }
    if (/^\d{13}$/.test(isbnCandidate)) return { scheme: 'isbn-13', value, normalizedValue: isbnCandidate }
  }
  return { scheme: 'custom', value, normalizedValue: value.trim() }
}

function distinctIdentifiers(identifiers: readonly EpubIdentifier[]): EpubIdentifier[] {
  const seen = new Set<string>()
  return identifiers.filter((identifier) => {
    const key = `${identifier.scheme}:${identifier.normalizedValue}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isIdentifier(value: EpubIdentifier | undefined): value is EpubIdentifier {
  return value !== undefined
}

function parseXml(source: string, label: string): XmlDocument {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new EpubImportError('invalid-package', `${label} uses a document type or entity declaration, which is not allowed.`)
  }
  try {
    const document = new DOMParser({ onError: () => { throw new Error('Malformed XML') } })
      .parseFromString(source, 'application/xml')
    const error = elements(document, 'parsererror')[0]
    if (error) throw new Error('Malformed XML')
    return document
  } catch (error) {
    throw new EpubImportError('invalid-package', `${label} XML is malformed.`, { cause: error })
  }
}

function elements(document: XmlDocument, localName: string): XmlElement[] {
  return Array.from(document.getElementsByTagName('*')).filter((element) =>
    (element.localName || element.nodeName.split(':').at(-1)) === localName,
  )
}

function descendantElements(element: XmlElement, localName: string): XmlElement[] {
  return Array.from(element.getElementsByTagName('*')).filter((candidate) =>
    (candidate.localName || candidate.nodeName.split(':').at(-1)) === localName,
  )
}

function requiredMetadataText(document: XmlDocument, localName: string, message: string): string {
  const value = optionalMetadataText(document, localName)
  if (!value) throw new EpubImportError('invalid-package', message)
  return value
}

function optionalMetadataText(document: XmlDocument, localName: string): string | undefined {
  return elements(document, localName).map(textContent).find(Boolean)
}

function textContent(element: XmlElement | undefined): string {
  return element?.textContent?.trim().replace(/\s+/g, ' ') ?? ''
}

function requireFile(archive: JSZip, path: string): JSZipObject {
  const file = archive.file(path)
  if (!file) throw new EpubImportError('invalid-package', `The EPUB is missing “${path}”.`)
  return file
}

function assertExtractableSize(
  path: string,
  entries: ReadonlyMap<string, CentralEntry>,
  limit: number,
): void {
  const entry = entries.get(path)
  if (!entry || entry.uncompressedSize > limit) {
    throw new EpubImportError('archive-bomb', `The EPUB entry “${path}” is missing or too large to inspect safely.`)
  }
}

function normalizeArchivePath(input: string, label: string): string {
  const decoded = safelyDecode(input).replace(/\\/g, '/')
  const segments = decoded.split('/')
  if (!decoded || decoded.startsWith('/') || decoded.includes('\0') || segments.includes('..') || /^[a-z]:/i.test(decoded)) {
    throw new EpubImportError('unsafe-path', `The EPUB ${label} “${input || '(empty)'}” could escape managed storage.`)
  }
  return segments.filter((segment) => segment !== '.' && segment !== '').join('/')
}

function resolvePackageHref(packagePath: string, href: string): string {
  const withoutFragment = href.split('#', 1)[0]
  const packageDirectory = packagePath.includes('/') ? packagePath.slice(0, packagePath.lastIndexOf('/') + 1) : ''
  const combined = `${packageDirectory}${safelyDecode(withoutFragment)}`
  const resolved: string[] = []
  for (const segment of combined.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (resolved.length === 0) throw new EpubImportError('unsafe-path', `The package reference “${href}” escapes the EPUB root.`)
      resolved.pop()
    } else {
      resolved.push(segment)
    }
  }
  return normalizeArchivePath(resolved.join('/'), 'package reference')
}

function safelyDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new EpubImportError('unsafe-path', `The EPUB path “${value}” uses invalid escaping.`)
  }
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digestInput = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', digestInput)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function formatMegabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024))
}
