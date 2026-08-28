import { z } from 'zod'

export const captureMethodSchema = z.enum([
  'manual-entry',
  'isbn-camera',
  'isbn-paste',
  'share-sheet',
])

export const capturedFieldSchema = z.enum(['title', 'authors', 'pageCount'])

export const bookCaptureSchema = z.object({
  method: captureMethodSchema,
  capturedAt: z.iso.datetime({ offset: true }),
  manualOverrides: z.array(capturedFieldSchema),
  enrichedAt: z.iso.datetime({ offset: true }).optional(),
})

export type CaptureMethod = z.infer<typeof captureMethodSchema>
export type CapturedField = z.infer<typeof capturedFieldSchema>
export type BookCapture = z.infer<typeof bookCaptureSchema>
