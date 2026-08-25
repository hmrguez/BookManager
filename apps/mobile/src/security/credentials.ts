import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage'
import { Capacitor } from '@capacitor/core'
import { z } from 'zod'

const CREDENTIAL_KEY_PREFIX = 'wovenleaf.credentials.v1.'
const MAX_CREDENTIAL_BYTES = 64 * 1024

export const credentialRefSchema = z
  .string()
  .regex(
    /^credential:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?:[A-Za-z0-9_-]{16,128}$/,
    'Expected a credential:<integration>:<opaque-id> reference',
  )
  .brand<'CredentialRef'>()

export const integrationCapabilitySchema = z.enum([
  'catalog:read',
  'library:read',
  'library:write',
  'reading:read',
  'reading:write',
  'annotations:read',
  'annotations:write',
  'files:read',
  'files:write',
  'backup:read',
  'backup:write',
])

export const credentialKindSchema = z.enum([
  'oauth-refresh-token',
  'oauth-access-token',
  'api-token',
  'password',
  'library-pin',
  'private-key',
])

export const credentialGrantSchema = z
  .object({
    integrationKey: z
      .string()
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/),
    credentialRef: credentialRefSchema,
    kind: credentialKindSchema,
    capabilities: integrationCapabilitySchema.array().nonempty(),
    remoteScopes: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^*]+$/, 'Wildcard remote scopes are forbidden')
      .array(),
    state: z.enum(['active', 'revoked']),
    createdAt: z.iso.datetime({ offset: true }),
    rotatedFrom: credentialRefSchema.optional(),
    revokedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .superRefine((grant, context) => {
    if (new Set(grant.capabilities).size !== grant.capabilities.length) {
      context.addIssue({
        code: 'custom',
        message: 'Capabilities must be unique',
        path: ['capabilities'],
      })
    }
    if (new Set(grant.remoteScopes).size !== grant.remoteScopes.length) {
      context.addIssue({
        code: 'custom',
        message: 'Remote scopes must be unique',
        path: ['remoteScopes'],
      })
    }
    if (grant.state === 'active' && grant.revokedAt) {
      context.addIssue({
        code: 'custom',
        message: 'An active credential cannot have a revocation time',
        path: ['revokedAt'],
      })
    }
    if (grant.state === 'revoked' && !grant.revokedAt) {
      context.addIssue({
        code: 'custom',
        message: 'A revoked credential needs a revocation time',
        path: ['revokedAt'],
      })
    }
    const refIntegration = grant.credentialRef.split(':')[1]
    if (refIntegration !== grant.integrationKey) {
      context.addIssue({
        code: 'custom',
        message: 'Credential reference must belong to the same integration',
        path: ['credentialRef'],
      })
    }
  })

export type CredentialRef = z.infer<typeof credentialRefSchema>
export type CredentialGrant = z.infer<typeof credentialGrantSchema>
export type CredentialKind = z.infer<typeof credentialKindSchema>
export type IntegrationCapability = z.infer<typeof integrationCapabilitySchema>
export type CredentialPlatform = 'ios' | 'android'

export const CREDENTIAL_STORAGE_POLICY = {
  ios: 'keychain-when-unlocked-this-device-only',
  android: 'keystore-aes-gcm-app-private-preferences',
  web: 'unavailable',
  cloudSync: false,
  automaticBackup: false,
} as const

export class CredentialStoreUnavailableError extends Error {
  constructor() {
    super('Secure credential storage is available only in the native iOS and Android apps')
    this.name = 'CredentialStoreUnavailableError'
  }
}

export class CredentialAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialAccessError'
  }
}

export interface CredentialStorageDriver {
  setSynchronize(sync: boolean): Promise<void>
  setDefaultKeychainAccess(access: KeychainAccess): Promise<void>
  setKeyPrefix(prefix: string): Promise<void>
  get(key: string, convertDate?: boolean, sync?: boolean): Promise<unknown>
  set(
    key: string,
    data: string,
    convertDate?: boolean,
    sync?: boolean,
    access?: KeychainAccess,
  ): Promise<void>
  remove(key: string, sync?: boolean): Promise<boolean>
}

/**
 * The only application boundary allowed to persist integration secrets.
 * It intentionally exposes neither key enumeration nor the driver's clear operation.
 */
export class CredentialVault {
  readonly #driver: CredentialStorageDriver
  readonly #platform: CredentialPlatform
  #initialization: Promise<void> | undefined

  constructor(platform: CredentialPlatform, driver: CredentialStorageDriver) {
    this.#platform = platform
    this.#driver = driver
  }

  async store(ref: CredentialRef, value: string): Promise<void> {
    validateCredentialValue(value)
    await this.#initialize()
    try {
      await this.#driver.set(
        ref,
        value,
        false,
        false,
        KeychainAccess.whenUnlockedThisDeviceOnly,
      )
    } catch {
      throw new CredentialAccessError('Credential store operation failed')
    }
  }

  async use<T>(ref: CredentialRef, operation: (value: string) => T | Promise<T>): Promise<T> {
    await this.#initialize()
    let value: unknown
    try {
      value = await this.#driver.get(ref, false, false)
    } catch {
      throw new CredentialAccessError('Credential read operation failed')
    }
    if (value === null) throw new CredentialAccessError('Credential is unavailable or revoked')
    if (typeof value !== 'string') {
      throw new CredentialAccessError('Credential store returned invalid data')
    }
    return operation(value)
  }

  async remove(ref: CredentialRef): Promise<void> {
    await this.#initialize()
    try {
      await this.#driver.remove(ref, false)
    } catch {
      throw new CredentialAccessError('Credential removal operation failed')
    }
  }

  async #initialize(): Promise<void> {
    if (!this.#initialization) {
      this.#initialization = this.#configureDriver()
    }
    return this.#initialization
  }

  async #configureDriver(): Promise<void> {
    try {
      await this.#driver.setKeyPrefix(CREDENTIAL_KEY_PREFIX)
      await this.#driver.setSynchronize(false)
      await this.#driver.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly)
    } catch {
      this.#initialization = undefined
      throw new CredentialAccessError(
        `Credential store could not initialize on ${this.#platform}`,
      )
    }
  }
}

export function createCredentialVault(
  platform: string = Capacitor.getPlatform(),
  driver: CredentialStorageDriver = SecureStorage,
): CredentialVault {
  if (platform !== 'ios' && platform !== 'android') {
    throw new CredentialStoreUnavailableError()
  }
  return new CredentialVault(platform, driver)
}

export function requireIntegrationCapabilities(
  grant: CredentialGrant,
  requested: readonly IntegrationCapability[],
): void {
  const parsed = credentialGrantSchema.parse(grant)
  if (parsed.state !== 'active') {
    throw new CredentialAccessError('Credential is revoked')
  }
  const missing = requested.filter((capability) => !parsed.capabilities.includes(capability))
  if (missing.length > 0) {
    throw new CredentialAccessError(`Credential lacks required capabilities: ${missing.join(', ')}`)
  }
}

export function rotateCredentialGrant(
  previous: CredentialGrant,
  replacementRef: CredentialRef,
  rotatedAt: string,
): { previous: CredentialGrant; replacement: CredentialGrant } {
  const current = credentialGrantSchema.parse(previous)
  if (current.state !== 'active') {
    throw new CredentialAccessError('Only an active credential can be rotated')
  }
  const revoked = credentialGrantSchema.parse({
    ...current,
    state: 'revoked',
    revokedAt: rotatedAt,
  })
  const replacement = credentialGrantSchema.parse({
    ...current,
    credentialRef: replacementRef,
    state: 'active',
    createdAt: rotatedAt,
    rotatedFrom: current.credentialRef,
    revokedAt: undefined,
  })
  return { previous: revoked, replacement }
}

export function revokeCredentialGrant(
  grant: CredentialGrant,
  revokedAt: string,
): CredentialGrant {
  const current = credentialGrantSchema.parse(grant)
  if (current.state === 'revoked') return current
  return credentialGrantSchema.parse({ ...current, state: 'revoked', revokedAt })
}

function validateCredentialValue(value: string): void {
  const size = new TextEncoder().encode(value).byteLength
  if (size === 0) throw new CredentialAccessError('Credential value cannot be empty')
  if (size > MAX_CREDENTIAL_BYTES) {
    throw new CredentialAccessError('Credential value exceeds the secure-store limit')
  }
}
