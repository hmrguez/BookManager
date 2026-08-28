import { z } from 'zod'

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
  }),
  nativeReaderEventBaseSchema.extend({
    kind: z.literal('session'),
    startedAt: z.string().datetime({ offset: true }).optional(),
    endedAt: z.string().datetime({ offset: true }).optional(),
    activeDurationMs: z.number().int().nonnegative().optional(),
    locator: readiumLocatorSchema.optional(),
  }),
  nativeReaderEventBaseSchema.extend({
    kind: z.literal('preference'),
    preferenceScope: z.enum(['global', 'book']),
    preferences: readerPreferencesSchema.nullable(),
  }).refine(
    ({ preferenceScope, preferences }) => preferenceScope === 'book' || preferences !== null,
    { message: 'Global reader preferences cannot be removed.', path: ['preferences'] },
  ),
])

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

export type EpubReaderCapability = {
  readonly bookId: string
  readonly editionId: string
  readonly assetId: string
  readonly assetFingerprint: string
  readonly relativePath: string
  readonly title: string
}

export class EpubReaderError extends Error {
  readonly code: 'unavailable' | 'not-found' | 'missing-asset' | 'corrupt-asset' | 'open-failed'

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
