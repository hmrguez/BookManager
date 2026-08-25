import { z } from 'zod'

const handoffRequestSchema = z.object({
  request: z.string().uuid(),
  nonce: z
    .string()
    .min(22)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
})

export type HandoffRequest = z.infer<typeof handoffRequestSchema>

/**
 * Accepts only an opaque, single-use handoff envelope. Provider credentials and payloads must be
 * resolved inside the receiving app after user confirmation; they never travel in a deep link.
 */
export function parseHandoffDeepLink(value: string): HandoffRequest {
  const url = new URL(value)
  if (url.protocol !== 'wovenleaf:' || url.hostname !== 'handoff') {
    throw new Error('Unsupported Wovenleaf deep link')
  }
  if (url.username || url.password || url.hash) throw new Error('Unsafe handoff deep link')
  const keys = [...url.searchParams.keys()]
  if (keys.length !== 2 || new Set(keys).size !== 2) {
    throw new Error('Handoff deep link must contain only request and nonce')
  }
  return handoffRequestSchema.parse({
    request: url.searchParams.get('request'),
    nonce: url.searchParams.get('nonce'),
  })
}
