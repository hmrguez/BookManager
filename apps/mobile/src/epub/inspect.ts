import { DOMParser } from '@xmldom/xmldom'
import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom'
import JSZip from 'jszip'
import { FileAccessError, originalFiles, type OriginalFileAccess, type OriginalFileReference } from '../files/original-files'
import {
  createEpubCompatibilityProfile,
  type EpubCompatibilityProfile,
  type EpubContentFeatures,
  type EpubLayout,
} from './compatibility'
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
  readonly localHeaderOffset: number
  readonly directoryRecord: Uint8Array
}

type EpubArchiveFile = { readonly name: string; async(type: 'text'): Promise<string>; async(type: 'uint8array'): Promise<Uint8Array> }
type EpubArchive = { file(path: string): EpubArchiveFile | null }

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

  return inspectArchive(archive, centralEntries, bytes.byteLength, () => sha256(bytes), options)
}

/** Inspect ZIP metadata and selected resources in place, leaving image/font payloads in the original. */
export async function inspectOriginalEpub(reference: OriginalFileReference, options: InspectEpubOptions, access: OriginalFileAccess = originalFiles): Promise<EpubInspection> {
  validateInputIdentity(options.fileName, options.mediaType ?? '')
  if (reference.size > EPUB_SAFETY_LIMITS.maxArchiveBytes) throw new EpubImportError('archive-too-large', 'This EPUB exceeds the 256 MB import limit.')
  validateMimetypeEntry(await access.readRange(reference, 0, Math.min(reference.size, 58)))
  const tailOffset = Math.max(0, reference.size - 65_557)
  const tail = await access.readRange(reference, tailOffset, reference.size - tailOffset)
  const view = dataView(tail)
  let end = tail.length - 22
  while (end >= 0 && (view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== tail.length)) end--
  if (end < 0) throw new EpubImportError('invalid-container', 'The EPUB ZIP directory is missing or truncated.')
  const directorySize = view.getUint32(end + 12, true)
  const directoryOffset = view.getUint32(end + 16, true)
  if (directorySize > 16 * 1024 * 1024 || directoryOffset + directorySize > tailOffset + end) {
    throw new EpubImportError('invalid-container', 'The EPUB ZIP directory has unsafe bounds.')
  }
  const directory = await access.readRange(reference, directoryOffset, directorySize)
  const central = new Uint8Array(directorySize + tail.length - end)
  central.set(directory)
  central.set(tail.subarray(end), directorySize)
  dataView(central).setUint32(directorySize + 16, 0, true)
  const entries = readCentralDirectory(central)
  validateArchiveEntries(entries)
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  const archive: EpubArchive = {
    file(path) {
      const entry = byName.get(path)
      if (!entry || path.endsWith('/')) return null
      return { name: path, async: (async (type: 'text' | 'uint8array') => {
        if (entry.localHeaderOffset + 30 > directoryOffset) throw new EpubImportError('invalid-container', 'An EPUB entry has unsafe bounds.')
        const header = await access.readRange(reference, entry.localHeaderOffset, 30)
        const local = dataView(header)
        if (local.getUint32(0, true) !== 0x04034b50) throw new EpubImportError('invalid-container', 'An EPUB entry header is malformed.')
        const length = 30 + local.getUint16(26, true) + local.getUint16(28, true) + entry.compressedSize
        if (entry.localHeaderOffset + length > directoryOffset) throw new EpubImportError('invalid-container', 'An EPUB entry has unsafe bounds.')
        const payload = await access.readRange(reference, entry.localHeaderOffset, length)
        const record = entry.directoryRecord.slice()
        dataView(record).setUint32(42, 0, true)
        const single = new Uint8Array(payload.length + record.length + 22)
        single.set(payload)
        single.set(record, payload.length)
        const eocd = new DataView(single.buffer, payload.length + record.length)
        eocd.setUint32(0, 0x06054b50, true)
        eocd.setUint16(8, 1, true); eocd.setUint16(10, 1, true)
        eocd.setUint32(12, record.length, true); eocd.setUint32(16, payload.length, true)
        const zip = await JSZip.loadAsync(single, { checkCRC32: true, createFolders: false })
        const file = zip.file(path)
        if (!file) throw new EpubImportError('invalid-container', 'An EPUB entry name does not match its directory.')
        return type === 'text' ? file.async('text') : file.async('uint8array')
      }) as EpubArchiveFile['async'] }
    },
  }
  return inspectArchive(archive, entries, reference.size, async () => {
    const identity = await access.inspect(reference.id)
    if (identity.size !== reference.size || !identity.fingerprint) throw new FileAccessError({ code: 'FILE_CHANGED' })
    return identity.fingerprint
  }, options)
}

async function inspectArchive(archive: EpubArchive, centralEntries: CentralEntry[], byteSize: number, fingerprint: () => Promise<string>, options: InspectEpubOptions): Promise<EpubInspection> {
  const { fileName, signal, onProgress } = options
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
  const compatibility = await inspectCompatibility({
    archive,
    entries: centralByName,
    packageDocument,
    packagePath,
    language,
    manifestItems,
    spineItems,
    containsScriptedContent,
  })

  onProgress?.({ stage: 'fingerprinting', fileName, detail: 'Fingerprinting the original package' })
  const contentHash = await fingerprint()
  throwIfEpubImportCanceled(signal)
  const publicationDate = optionalMetadataText(packageDocument, 'date')

  return {
    contentHash,
    byteSize,
    entryCount: centralEntries.length,
    packagePath,
    packageVersion,
    packageIdentifier,
    title,
    creators: elements(packageDocument, 'creator').map(textContent).filter(Boolean),
    subjects: [...new Set(Array.from(packageDocument.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'subject')).map(textContent).filter(Boolean))],
    language,
    ...(optionalMetadataText(packageDocument, 'publisher') ? { publisher: optionalMetadataText(packageDocument, 'publisher') } : {}),
    ...(publicationDate && publicationDate.length >= 4 ? { publicationDate } : {}),
    identifiers,
    ...(cover ? { cover } : {}),
    containsScriptedContent,
    compatibility,
  }
}

type ManifestRecord = {
  readonly id: string
  readonly href: string
  readonly mediaType: string
  readonly fallback?: string
  readonly mediaOverlay?: string
}

const READABLE_SPINE_MEDIA_TYPES = new Set([
  'application/xhtml+xml',
  'image/svg+xml',
])
const MAX_COMPATIBILITY_RESOURCE_BYTES = 8 * 1024 * 1024
const MAX_COMPATIBILITY_TOTAL_BYTES = 32 * 1024 * 1024

async function inspectCompatibility(input: {
  readonly archive: EpubArchive
  readonly entries: ReadonlyMap<string, CentralEntry>
  readonly packageDocument: XmlDocument
  readonly packagePath: string
  readonly language: string
  readonly manifestItems: readonly XmlElement[]
  readonly spineItems: readonly XmlElement[]
  readonly containsScriptedContent: boolean
}): Promise<EpubCompatibilityProfile> {
  const manifest = new Map<string, ManifestRecord>()
  for (const item of input.manifestItems) {
    const id = item.getAttribute('id')?.trim() ?? ''
    const href = item.getAttribute('href')?.trim() ?? ''
    const mediaType = item.getAttribute('media-type')?.trim().toLocaleLowerCase() ?? ''
    if (!id || !href || !mediaType) continue
    manifest.set(id, {
      id,
      href,
      mediaType,
      ...(item.getAttribute('fallback')?.trim()
        ? { fallback: item.getAttribute('fallback')?.trim() }
        : {}),
      ...(item.getAttribute('media-overlay')?.trim()
        ? { mediaOverlay: item.getAttribute('media-overlay')?.trim() }
        : {}),
    })
  }

  const spineMediaTypes: string[] = []
  const unsupportedSpineMediaTypes: string[] = []
  const readableResources: ManifestRecord[] = []
  let fallbackSpineItemCount = 0
  for (const spineItem of input.spineItems) {
    const item = manifest.get(spineItem.getAttribute('idref')?.trim() ?? '')
    if (!item) continue
    spineMediaTypes.push(item.mediaType)
    const resolved = resolveReadableManifestItem(item, manifest)
    if (!resolved) {
      unsupportedSpineMediaTypes.push(item.mediaType)
      continue
    }
    if (resolved.id !== item.id) fallbackSpineItemCount += 1
    const path = resolvePackageHref(input.packagePath, resolved.href)
    requireFile(input.archive, path)
    readableResources.push(resolved)
  }

  const sources = await compatibilitySources(
    input.archive,
    input.entries,
    input.packagePath,
    [...readableResources, ...manifest.values()].filter((item) =>
      READABLE_SPINE_MEDIA_TYPES.has(item.mediaType) || item.mediaType === 'text/css',
    ),
  )
  const combined = sources.join('\n')
  const pageProgressionDirection = readPageProgressionDirection(input.packageDocument)
  const accessibility = readAccessibilityMetadata(input.packageDocument)
  const features: EpubContentFeatures = {
    bidirectionalText: pageProgressionDirection === 'rtl'
      || isRightToLeftLanguage(input.language)
      || /\b(?:dir\s*=\s*["']?(?:rtl|auto)|unicode-bidi\s*:|direction\s*:\s*rtl)|[\u0590-\u08ff]/iu.test(combined),
    verticalWriting: /(?:-epub-|-webkit-)?writing-mode\s*:\s*(?:vertical|sideways)|\bwriting-mode\s*=\s*["']?(?:vertical|tb-)/iu.test(combined),
    ruby: /<(?:[a-z][\w.-]*:)?ruby\b/iu.test(combined),
    footnotes: /(?:epub:type|role)\s*=\s*["'][^"']*(?:noteref|footnote|endnote|doc-noteref|doc-footnote)/iu.test(combined),
    mathml: /<(?:[a-z][\w.-]*:)?math\b/iu.test(combined),
    svg: readableResources.some(({ mediaType }) => mediaType === 'image/svg+xml')
      || /<(?:[a-z][\w.-]*:)?svg\b/iu.test(combined),
    complexTables: /<table\b/iu.test(combined)
      && /\b(?:rowspan|colspan|headers|scope)\s*=/iu.test(combined),
    mediaOverlays: [...manifest.values()].some(({ mediaOverlay, mediaType }) =>
      Boolean(mediaOverlay) || mediaType === 'application/smil+xml',
    ),
    scriptedContent: input.containsScriptedContent || /<script\b/iu.test(combined),
    semanticStructure: /<(?:h[1-6]|main|nav|section|article|aside)\b|(?:epub:type|role)\s*=/iu.test(combined),
  }

  return createEpubCompatibilityProfile({
    layout: readLayout(input.packageDocument, input.spineItems),
    pageProgressionDirection,
    primaryLanguage: input.language,
    spineMediaTypes,
    unsupportedSpineMediaTypes,
    fallbackSpineItemCount,
    readableSpineItemCount: readableResources.length,
    accessibility,
    features,
  })
}

function resolveReadableManifestItem(
  initial: ManifestRecord,
  manifest: ReadonlyMap<string, ManifestRecord>,
): ManifestRecord | undefined {
  const visited = new Set<string>()
  let item: ManifestRecord | undefined = initial
  while (item && !visited.has(item.id)) {
    visited.add(item.id)
    if (READABLE_SPINE_MEDIA_TYPES.has(item.mediaType)) return item
    item = item.fallback ? manifest.get(item.fallback) : undefined
  }
  return undefined
}

async function compatibilitySources(
  archive: EpubArchive,
  entries: ReadonlyMap<string, CentralEntry>,
  packagePath: string,
  resources: readonly ManifestRecord[],
): Promise<string[]> {
  const sources: string[] = []
  const paths = new Set<string>()
  let inspectedBytes = 0
  for (const resource of resources) {
    const path = resolvePackageHref(packagePath, resource.href)
    if (paths.has(path)) continue
    paths.add(path)
    const entry = entries.get(path)
    if (!entry || entry.uncompressedSize > MAX_COMPATIBILITY_RESOURCE_BYTES) continue
    if (inspectedBytes + entry.uncompressedSize > MAX_COMPATIBILITY_TOTAL_BYTES) break
    const file = archive.file(path)
    if (!file) continue
    sources.push(await file.async('text'))
    inspectedBytes += entry.uncompressedSize
  }
  return sources
}

function readLayout(document: XmlDocument, spineItems: readonly XmlElement[]): EpubLayout {
  const globalLayout = metadataPropertyValues(document, 'layout')
    .find((value) => value === 'pre-paginated' || value === 'reflowable')
  const overrides = spineItems.map((item) => item.getAttribute('properties')?.split(/\s+/) ?? [])
  const hasFixedOverride = overrides.some((values) => values.includes('rendition:layout-pre-paginated'))
  const hasReflowableOverride = overrides.some((values) => values.includes('rendition:layout-reflowable'))
  if (globalLayout === 'pre-paginated') return hasReflowableOverride ? 'mixed' : 'fixed-layout'
  return hasFixedOverride ? 'mixed' : 'reflowable'
}

function readPageProgressionDirection(document: XmlDocument): 'default' | 'ltr' | 'rtl' {
  const value = elements(document, 'spine')[0]?.getAttribute('page-progression-direction')?.trim()
  return value === 'ltr' || value === 'rtl' ? value : 'default'
}

function readAccessibilityMetadata(document: XmlDocument) {
  const accessModes = metadataPropertyValues(document, 'accessMode')
  const features = metadataPropertyValues(document, 'accessibilityFeature')
  const hazards = metadataPropertyValues(document, 'accessibilityHazard')
  const summary = metadataPropertyValues(document, 'accessibilitySummary')[0]
  const conformsTo = metadataPropertyValues(document, 'conformsTo')
  return {
    accessModes,
    features,
    hazards,
    ...(summary ? { summary } : {}),
    conformsTo,
    hasDiscoverabilityMetadata: accessModes.length > 0 && features.length > 0 && hazards.length > 0,
  }
}

function metadataPropertyValues(document: XmlDocument, localProperty: string): string[] {
  const expected = localProperty.toLocaleLowerCase()
  return [...new Set(elements(document, 'meta').flatMap((meta) => {
    const property = meta.getAttribute('property') ?? meta.getAttribute('name') ?? ''
    const normalized = property.split(/[:/#]/).at(-1)?.toLocaleLowerCase()
    if (normalized !== expected) return []
    const value = textContent(meta) || meta.getAttribute('content')?.trim() || ''
    return value ? [value] : []
  }))]
}

function isRightToLeftLanguage(language: string): boolean {
  return /^(?:ar|arc|dv|fa|ha|he|khw|ks|ku|ps|sd|ug|ur|yi)(?:-|$)/iu.test(language)
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
    entries.push({ name, compressedSize, uncompressedSize, encrypted: (flags & 0x1) !== 0,
      localHeaderOffset: view.getUint32(offset + 42, true), directoryRecord: bytes.subarray(offset, nextOffset) })
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
  archive: EpubArchive,
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
  archive: EpubArchive,
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

function requireFile(archive: EpubArchive, path: string): EpubArchiveFile {
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
