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

export const nativeReaderEventSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  kind: z.enum(['start', 'location', 'session']),
  bookId: z.string().min(1),
  editionId: z.string().min(1),
  assetId: z.string().min(1),
  assetFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sessionId: z.string().min(1),
  emittedAt: z.string().datetime({ offset: true }),
  startedAt: z.string().datetime({ offset: true }).optional(),
  endedAt: z.string().datetime({ offset: true }).optional(),
  activeDurationMs: z.number().int().nonnegative().optional(),
  locator: readiumLocatorSchema.optional(),
  platform: z.enum(['ios', 'android']),
  toolkitVersion: z.string().min(1),
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
