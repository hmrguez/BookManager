export const REDACTED_SECRET = '[REDACTED:secret]'
export const REDACTED_PRIVATE_DATA = '[REDACTED:private]'
export const DIAGNOSTIC_CHANNELS = [
  'application-log',
  'crash-report',
  'analytics',
  'support-export',
] as const

export type DiagnosticChannel = (typeof DIAGNOSTIC_CHANNELS)[number]
export type DiagnosticPrimitive = boolean | number | string | null
export type DiagnosticValue =
  | DiagnosticPrimitive
  | readonly DiagnosticValue[]
  | { readonly [key: string]: DiagnosticValue }

export interface DiagnosticRecord {
  readonly channel: DiagnosticChannel
  readonly event: string
  readonly context: DiagnosticValue
}

export class CredentialLeakError extends Error {
  constructor() {
    super('Credential material is forbidden at this persistence or export boundary')
    this.name = 'CredentialLeakError'
  }
}

const SAFE_REFERENCE_KEYS = new Set([
  'credentialref',
  'credentialreference',
  'integrationcheckpointid',
])

const SECRET_KEYS = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'apikey',
  'secret',
  'clientsecret',
  'password',
  'passcode',
  'pin',
  'librarypin',
  'privatekey',
  'credential',
])

const PRIVATE_KEYS = new Set([
  'annotation',
  'annotations',
  'author',
  'authors',
  'booktitle',
  'currentpage',
  'email',
  'isbn',
  'librarycard',
  'librarycardnumber',
  'note',
  'notes',
  'progress',
  'query',
  'quote',
  'rating',
  'readinghistory',
  'reviewtext',
  'username',
])

const AUTHORIZATION_PATTERN = /\b(Bearer|Basic)\s+[^\s,;]+/gi
const CREDENTIAL_QUERY_PATTERN =
  /([?&#](?:access_token|refresh_token|id_token|api_key|apikey|client_secret|password|passcode|pin|code)=)[^&#\s]*/gi
const URL_PASSWORD_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi

export function createDiagnosticRecord(
  channel: DiagnosticChannel,
  event: string,
  context: unknown,
  knownSecrets: readonly string[] = [],
): DiagnosticRecord {
  return {
    channel,
    event: sanitizeString(event, knownSecrets),
    context: redactDiagnosticValue(context, knownSecrets),
  }
}

/** Produces JSON-safe diagnostic data while removing credentials and private reading content. */
export function redactDiagnosticValue(
  value: unknown,
  knownSecrets: readonly string[] = [],
): DiagnosticValue {
  return redactValue(value, normalizeKnownSecrets(knownSecrets), new WeakSet<object>(), 0)
}

/** Fails closed before a provider payload, fixture, or export can persist credential material. */
export function assertCredentialFree(
  value: unknown,
  knownSecrets: readonly string[] = [],
): void {
  if (
    containsCredentialMaterial(
      value,
      normalizeKnownSecrets(knownSecrets),
      new WeakSet<object>(),
      0,
    )
  ) {
    throw new CredentialLeakError()
  }
}

function redactValue(
  value: unknown,
  knownSecrets: readonly string[],
  ancestors: WeakSet<object>,
  depth: number,
): DiagnosticValue {
  if (depth > 20) return '[REDACTED:depth-limit]'
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return sanitizeString(value, knownSecrets)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined') return '[undefined]'
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`

  if (ancestors.has(value)) return '[Circular]'
  ancestors.add(value)

  let result: DiagnosticValue
  if (value instanceof Error) {
    result = {
      name: sanitizeString(value.name, knownSecrets),
      message: sanitizeString(value.message, knownSecrets),
      ...(value.stack ? { stack: sanitizeString(value.stack, knownSecrets) } : {}),
    }
  } else if (Array.isArray(value)) {
    result = value.map((item) => redactValue(item, knownSecrets, ancestors, depth + 1))
  } else {
    result = Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const classification = classifyKey(key)
        if (classification === 'secret') return [key, REDACTED_SECRET]
        if (classification === 'private') return [key, REDACTED_PRIVATE_DATA]
        return [key, redactValue(item, knownSecrets, ancestors, depth + 1)]
      }),
    )
  }

  ancestors.delete(value)
  return result
}

function classifyKey(key: string): 'secret' | 'private' | undefined {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (SAFE_REFERENCE_KEYS.has(normalized)) return undefined
  if (
    SECRET_KEYS.has(normalized) ||
    normalized.endsWith('token') ||
    normalized.endsWith('password') ||
    normalized.endsWith('passcode') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('apikey')
  ) {
    return 'secret'
  }
  if (PRIVATE_KEYS.has(normalized)) return 'private'
  return undefined
}

function containsCredentialMaterial(
  value: unknown,
  knownSecrets: readonly string[],
  ancestors: WeakSet<object>,
  depth: number,
): boolean {
  if (depth > 20) return true
  if (typeof value === 'string') return sanitizeString(value, knownSecrets) !== value
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return false
  }
  if (ancestors.has(value)) return false
  ancestors.add(value)

  let containsCredential = false
  if (value instanceof Error) {
    containsCredential =
      sanitizeString(value.message, knownSecrets) !== value.message ||
      (value.stack !== undefined && sanitizeString(value.stack, knownSecrets) !== value.stack)
  } else if (Array.isArray(value)) {
    containsCredential = value.some((item) =>
      containsCredentialMaterial(item, knownSecrets, ancestors, depth + 1),
    )
  } else {
    containsCredential = Object.entries(value).some(
      ([key, item]) =>
        classifyKey(key) === 'secret' ||
        containsCredentialMaterial(item, knownSecrets, ancestors, depth + 1),
    )
  }

  ancestors.delete(value)
  return containsCredential
}

function normalizeKnownSecrets(knownSecrets: readonly string[]): readonly string[] {
  return [...new Set(knownSecrets.filter((secret) => secret.length > 0))].sort(
    (left, right) => right.length - left.length,
  )
}

function sanitizeString(value: string, knownSecrets: readonly string[]): string {
  let sanitized = value
  for (const secret of knownSecrets) sanitized = sanitized.replaceAll(secret, REDACTED_SECRET)
  return sanitized
    .replace(AUTHORIZATION_PATTERN, '$1 [REDACTED:secret]')
    .replace(CREDENTIAL_QUERY_PATTERN, '$1[REDACTED:secret]')
    .replace(URL_PASSWORD_PATTERN, '$1[REDACTED:secret]@')
}
