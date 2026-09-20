import { z } from 'zod'
import type { EpubCompatibilityProfile } from '../epub/compatibility'

const fractionSchema = z.number().min(0).max(1)

export const readiumLocatorSchema = z.object({
  href: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1).optional(),
  locations: z.object({
    fragments: z.array(z.string().min(1)).default([]),
    progression: fractionSchema.optional(),
    totalProgression: fractionSchema.optional(),
    position: z.number().int().positive().optional(),
    pageCount: z.number().int().positive().optional(),
  }).passthrough().default({ fragments: [] }),
  text: z.object({
    before: z.string().optional(),
    highlight: z.string().optional(),
    after: z.string().optional(),
  }).default({}),
}).passthrough()

export const readerLayoutSchema = z.enum(['paginated', 'scroll'])

export const readerThemeSchema = z.enum(['paper', 'white', 'graphite'])
export const readerFontFamilySchema = z.enum(['literary', 'sans', 'mono', 'accessible'])
export const readerTextAlignmentSchema = z.enum(['start', 'justify'])
export const readerColumnCountSchema = z.enum(['auto', 'one', 'two'])

export const readerAnnotationColorSchema = z.enum(['ochre', 'sage', 'blue', 'rose'])

export const readerAnnotationAnchorSchema = z.object({
  status: z.enum(['exact', 'reanchored', 'review']),
  previousAssetFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  reason: z.enum(['asset-revision', 'ambiguous', 'missing']).optional(),
})

export const readerAnnotationSchema = z.object({
  id: z.string().min(1),
  bookId: z.string().min(1),
  editionId: z.string().min(1),
  assetId: z.string().min(1),
  assetFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  locator: readiumLocatorSchema,
  quote: z.string().trim().min(1).max(10_000),
  prefix: z.string().max(1_000),
  suffix: z.string().max(1_000),
  chapter: z.string().max(500).optional(),
  color: readerAnnotationColorSchema,
  note: z.string().max(50_000),
  tags: z.array(z.string().trim().min(1).max(64)).max(32),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  deletedAt: z.string().datetime({ offset: true }).optional(),
  anchor: readerAnnotationAnchorSchema,
  provenance: z.object({
    source: z.literal('epub-reader'),
    platform: z.enum(['ios', 'android']),
    toolkitVersion: z.string().min(1),
  }),
})

export const readerAnnotationStateSchema = z.object({
  version: z.literal(1),
  bookId: z.string().min(1),
  editionId: z.string().min(1),
  annotations: z.array(readerAnnotationSchema),
  updatedAt: z.string().datetime({ offset: true }),
})

export const readerPreferencesSchema = z.object({
  version: z.literal(1),
  fontFamily: readerFontFamilySchema,
  fontSize: z.number().min(0.8).max(2),
  fontWeight: z.number().min(0.75).max(1.5),
  lineHeight: z.number().min(1.2).max(1.9),
  pageMargins: z.number().min(0.4).max(2.5),
  textAlign: readerTextAlignmentSchema,
  hyphens: z.boolean(),
  columnCount: readerColumnCountSchema,
  layout: readerLayoutSchema,
  theme: readerThemeSchema,
  publisherStyles: z.boolean(),
})

export const DEFAULT_READER_PREFERENCES = readerPreferencesSchema.parse({
  version: 1,
  fontFamily: 'literary',
  fontSize: 1,
  fontWeight: 1,
  lineHeight: 1.5,
  pageMargins: 1.15,
  textAlign: 'justify',
  hyphens: true,
  columnCount: 'auto',
  layout: 'paginated',
  theme: 'paper',
  publisherStyles: false,
})

const nativeReaderEventBaseSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  bookId: z.string().min(1),
  editionId: z.string().min(1),
  assetId: z.string().min(1),
  assetFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sessionId: z.string().min(1),
  emittedAt: z.string().datetime({ offset: true }),
  platform: z.enum(['ios', 'android']),
  toolkitVersion: z.string().min(1),
})

export const nativeReaderEventSchema = z.discriminatedUnion('kind', [
  nativeReaderEventBaseSchema.extend({
    kind: z.enum(['start', 'location']),
    locator: readiumLocatorSchema.optional(),
    reachedEnd: z.boolean().optional(),
  }),
  nativeReaderEventBaseSchema.extend({
    kind: z.literal('session'),
    startedAt: z.string().datetime({ offset: true }).optional(),
    endedAt: z.string().datetime({ offset: true }).optional(),
    activeDurationMs: z.number().int().nonnegative().optional(),
    locator: readiumLocatorSchema.optional(),
    reachedEnd: z.boolean().optional(),
  }),
  nativeReaderEventBaseSchema.extend({
    kind: z.literal('preference'),
    preferenceScope: z.enum(['global', 'book']),
    preferences: readerPreferencesSchema.nullable(),
  }).refine(
    ({ preferenceScope, preferences }) => preferenceScope === 'book' || preferences !== null,
    { message: 'Global reader preferences cannot be removed.', path: ['preferences'] },
  ),
  nativeReaderEventBaseSchema.extend({
    kind: z.literal('bookmark'),
    action: z.enum(['upsert', 'delete']),
    bookmarkId: z.string().min(1),
    locator: readiumLocatorSchema.optional(),
    createdAt: z.string().datetime({ offset: true }).optional(),
  }).refine(
    ({ action, locator, createdAt }) => action === 'delete' || (locator !== undefined && createdAt !== undefined),
    { message: 'A saved bookmark needs a locator and creation time.', path: ['locator'] },
  ),
  nativeReaderEventBaseSchema.extend({
    kind: z.literal('toc'),
    locator: readiumLocatorSchema.nullable(),
  }),
  nativeReaderEventBaseSchema.extend({
    kind: z.literal('annotation'),
    action: z.enum(['upsert', 'delete', 'restore']),
    annotationId: z.string().min(1),
    annotation: readerAnnotationSchema.optional(),
  }).refine(
    ({ action, annotation }) => action !== 'upsert' || annotation !== undefined,
    { message: 'An annotation upsert needs the complete annotation.', path: ['annotation'] },
  ),
])

export const readerBookmarkSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  assetFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  locator: readiumLocatorSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
})

export const readerNavigationStateSchema = z.object({
  version: z.literal(1),
  bookId: z.string().min(1),
  editionId: z.string().min(1),
  toc: z.object({
    assetFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    locator: readiumLocatorSchema,
  }).optional(),
  bookmarks: z.array(readerBookmarkSchema),
  updatedAt: z.string().datetime({ offset: true }),
})

export const readerCheckpointSchema = z.object({
  bookId: z.string().min(1),
  editionId: z.string().min(1),
  assetId: z.string().min(1),
  assetFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  lastSequence: z.number().int().nonnegative(),
  locator: readiumLocatorSchema.optional(),
  recordedAt: z.string().datetime({ offset: true }),
})

export type ReadiumLocator = z.infer<typeof readiumLocatorSchema>
export type ReaderLayout = z.infer<typeof readerLayoutSchema>
export type ReaderPreferences = z.infer<typeof readerPreferencesSchema>
export type ReaderPreferenceScope = 'global' | 'book'
export type ReaderPreferenceState = {
  readonly global: ReaderPreferences
  readonly book?: ReaderPreferences
}
export type NativeReaderEvent = z.infer<typeof nativeReaderEventSchema>
export type ReaderCheckpoint = z.infer<typeof readerCheckpointSchema>
export type ReaderBookmark = z.infer<typeof readerBookmarkSchema>
export type ReaderNavigationState = z.infer<typeof readerNavigationStateSchema>
export type ReaderAnnotation = z.infer<typeof readerAnnotationSchema>
export type ReaderAnnotationColor = z.infer<typeof readerAnnotationColorSchema>
export type ReaderAnnotationState = z.infer<typeof readerAnnotationStateSchema>

export type EpubReaderCapability = {
  readonly bookId: string
  readonly editionId: string
  readonly assetId: string
  readonly assetFingerprint: string
  readonly referenceId?: string
  readonly relativePath: string
  readonly format?: 'epub' | 'pdf'
  readonly title: string
  readonly compatibility?: EpubCompatibilityProfile
}

export class EpubReaderError extends Error {
  readonly code: 'unavailable' | 'not-found' | 'missing-asset' | 'corrupt-asset' | 'unsupported-content' | 'open-failed'

  constructor(code: EpubReaderError['code'], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EpubReaderError'
    this.code = code
  }
}

export const READER_CHECKPOINT_DEBOUNCE_MS = 750
export const MAX_FORCE_QUIT_POSITION_LOSS_MS = READER_CHECKPOINT_DEBOUNCE_MS

export function fallbackLocatorForReplacement(locator: ReadiumLocator): ReadiumLocator {
  return readiumLocatorSchema.parse({
    href: locator.href,
    type: locator.type,
    ...(locator.title ? { title: locator.title } : {}),
    locations: {
      ...(locator.locations.progression === undefined
        ? {}
        : { progression: locator.locations.progression }),
      ...(locator.locations.totalProgression === undefined
        ? {}
        : { totalProgression: locator.locations.totalProgression }),
      fragments: [],
    },
    text: locator.text,
  })
}

export function annotationForReplacement(
  annotation: ReaderAnnotation,
  capability: Pick<EpubReaderCapability, 'editionId' | 'assetId' | 'assetFingerprint'>,
): ReaderAnnotation {
  if (annotation.assetFingerprint === capability.assetFingerprint) return annotation
  return readerAnnotationSchema.parse({
    ...annotation,
    editionId: capability.editionId,
    assetId: capability.assetId,
    assetFingerprint: capability.assetFingerprint,
    locator: fallbackLocatorForReplacement(annotation.locator),
    anchor: {
      status: 'review',
      previousAssetFingerprint: annotation.assetFingerprint,
      reason: 'asset-revision',
    },
  })
}

export function uniqueAnnotationReanchorCandidate(
  annotation: Pick<ReaderAnnotation, 'quote' | 'prefix' | 'suffix'>,
  candidates: readonly ReadiumLocator[],
): ReadiumLocator | undefined {
  const quote = normalizeAnchorText(annotation.quote)
  const exact = candidates.filter((candidate) =>
    normalizeAnchorText(candidate.text.highlight ?? '') === quote,
  )
  if (exact.length === 1) return exact[0]
  if (exact.length < 2) return undefined

  const before = normalizeAnchorText(annotation.prefix).slice(-80)
  const after = normalizeAnchorText(annotation.suffix).slice(0, 80)
  if (!before && !after) return undefined
  const contextual = exact.filter((candidate) => {
    const candidateBefore = normalizeAnchorText(candidate.text.before ?? '')
    const candidateAfter = normalizeAnchorText(candidate.text.after ?? '')
    return (!before || candidateBefore.endsWith(before))
      && (!after || candidateAfter.startsWith(after))
  })
  return contextual.length === 1 ? contextual[0] : undefined
}

export function normalizeAnnotationTags(tags: readonly string[]): string[] {
  const normalized = new Map<string, string>()
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ')
    if (!tag) continue
    const key = tag.toLocaleLowerCase()
    if (!normalized.has(key)) normalized.set(key, tag)
  }
  return [...normalized.values()]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
    .slice(0, 32)
}

export function sortReaderAnnotations(
  annotations: readonly ReaderAnnotation[],
): ReaderAnnotation[] {
  return [...annotations].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )
}

function normalizeAnchorText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}
