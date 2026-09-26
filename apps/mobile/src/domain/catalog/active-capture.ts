import { z } from 'zod'

// Optional on historical sessions: absence is deliberately NOT upgraded to v1.
export const activeReadingCaptureSchema = z.object({
  version: z.literal(1),
  kind: z.literal('epub-foreground'),
  captureId: z.string().min(1),
  intervalIndex: z.number().int().nonnegative(),
  startReason: z.enum(['open', 'resume', 'checkpoint', 'discontinuity']),
  endReason: z.enum(['checkpoint', 'pause', 'close']),
})

export type ActiveReadingCapture = z.infer<typeof activeReadingCaptureSchema>

export function isExactActiveInterval(value: {
  startedAt?: string
  endedAt?: string
  activeDurationMs?: number
}): boolean {
  if (!value.startedAt || !value.endedAt || value.activeDurationMs === undefined) return false
  const elapsed = Date.parse(value.endedAt) - Date.parse(value.startedAt)
  return elapsed >= 0 && elapsed <= 30_000 && elapsed === value.activeDurationMs
}
