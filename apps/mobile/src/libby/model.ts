import { z } from 'zod'
import { shelfIdSchema } from '../library-model'

export const LIBBY_SHARE_PREFIX = 'Wovenleaf Libby progress\n'
export const LIBBY_MAX_BYTES = 128 * 1024
export const libbyCoverUrlSchema = z.string().max(2048).regex(/^https:\/\/(?:img[1-9][0-9]*\.od-cdn\.com|images\.contentreserve\.com)\/ImageType-[0-9]+\/[a-z0-9%_./~{}-]+\.(?:jpe?g|png|webp)$/i)
export const libbyObservationSchema = z.object({
  titleId: z.string().regex(/^\d{1,20}$/),
  format: z.enum(['ebook', 'audiobook']),
  title: z.string().trim().min(1).max(500),
  author: z.string().trim().max(500),
  percent: z.number().finite().min(0).max(100),
  coverUrl: libbyCoverUrlSchema.optional(),
}).strict()
export const libbySnapshotSchema = z.object({
  kind: z.literal('wovenleaf-libby'),
  version: z.literal(1),
  id: z.uuid(),
  capturedAt: z.iso.datetime(),
  observations: z.array(libbyObservationSchema).min(1).max(100),
}).strict()
export type LibbyObservation = z.infer<typeof libbyObservationSchema>
export type LibbySnapshot = z.infer<typeof libbySnapshotSchema>
export const libbyKey = (observation: Pick<LibbyObservation, 'format' | 'titleId'>) =>
  `${observation.format}:${observation.titleId}`

export function parseLibbySnapshot(text: string, now = Date.now()): LibbySnapshot {
  if (new TextEncoder().encode(text).byteLength > LIBBY_MAX_BYTES) throw new Error('This progress file is too large (128 KB maximum).')
  const body = text.startsWith(LIBBY_SHARE_PREFIX) ? text.slice(LIBBY_SHARE_PREFIX.length) : text
  let snapshot: LibbySnapshot
  try { snapshot = libbySnapshotSchema.parse(JSON.parse(body)) }
  catch { throw new Error('This is not a supported Wovenleaf Libby progress file. Capture your shelf again.') }
  if (Date.parse(snapshot.capturedAt) > now + 300_000) throw new Error('This capture is dated in the future. Check the time on your devices.')
  if (new Set(snapshot.observations.map(libbyKey)).size !== snapshot.observations.length) {
    throw new Error('This capture contains conflicting copies of a title. Capture your shelf again.')
  }
  return snapshot
}

const mappingSchema = z.object({
  key: z.string(), bookId: z.string(), baseline: z.string(), paused: z.boolean(),
  observedAt: z.iso.datetime(),
})
const itemSchema = z.object({
  key: z.string(), snapshotId: z.uuid(), capturedAt: z.iso.datetime(),
  observation: libbyObservationSchema,
  status: z.enum(['pending', 'applied', 'ignored']), reason: z.string(),
})
const receiptSchema = z.object({
  id: z.uuid(), bookId: z.string(), key: z.string(), title: z.string(), at: z.iso.datetime(),
  before: z.object({ progress: z.number(), currentPage: z.number(), shelf: shelfIdSchema.optional(), thumbnail: z.url().optional(), finishedAt: z.iso.datetime({ offset: true }).optional() }),
  after: z.object({ progress: z.number(), currentPage: z.number(), lastUpdatedAt: z.string(), shelf: shelfIdSchema.optional(), thumbnail: z.url().optional() }),
  undone: z.boolean(),
})
export const libbyStateSchema = z.object({
  enabled: z.boolean(), automatic: z.boolean(), lastReceivedAt: z.iso.datetime().optional(),
  autoAdd: z.boolean().default(false),
  excluded: z.array(z.string()).max(500).default([]),
  mappings: z.array(mappingSchema).max(500), items: z.array(itemSchema).max(100),
  receipts: z.array(receiptSchema).max(50), seen: z.array(z.uuid()).max(200),
})
export type LibbyState = z.infer<typeof libbyStateSchema>
export type LibbyItem = LibbyState['items'][number]
export const emptyLibbyState = (): LibbyState => ({ enabled: false, automatic: true, autoAdd: true, excluded: [], mappings: [], items: [], receipts: [], seen: [] })
