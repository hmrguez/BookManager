import { describe, expect, test } from 'bun:test'
import type { KeychainAccess } from '@aparajita/capacitor-secure-storage'
import {
  CREDENTIAL_STORAGE_POLICY,
  CredentialAccessError,
  CredentialLeakError,
  CredentialStoreUnavailableError,
  CredentialVault,
  DIAGNOSTIC_CHANNELS,
  REDACTED_PRIVATE_DATA,
  REDACTED_SECRET,
  assertCredentialFree,
  createCredentialVault,
  createDiagnosticRecord,
  credentialGrantSchema,
  parseHandoffDeepLink,
  requireIntegrationCapabilities,
  revokeCredentialGrant,
  rotateCredentialGrant,
} from '../src/security'
import type { CredentialStorageDriver } from '../src/security'
import {
  adversarialDiagnosticFixture,
  readOnlyCredentialGrant,
  securityFixtureRefs,
  securityFixtureSecrets,
} from './fixtures/security'

class MemoryCredentialDriver implements CredentialStorageDriver {
  readonly calls: string[] = []
  readonly values = new Map<string, string>()

  async setSynchronize(sync: boolean) {
    this.calls.push(`sync:${sync}`)
  }

  async setDefaultKeychainAccess(access: KeychainAccess) {
    this.calls.push(`access:${access}`)
  }

  async setKeyPrefix(prefix: string) {
    this.calls.push(`prefix:${prefix}`)
  }

  async get(key: string, _convertDate?: boolean, sync?: boolean) {
    this.calls.push(`get:${sync}`)
    return this.values.get(key) ?? null
  }

  async set(
    key: string,
    data: string,
    _convertDate?: boolean,
    sync?: boolean,
    access?: KeychainAccess,
  ) {
    this.calls.push(`set:${sync}:${access}`)
    this.values.set(key, data)
  }

  async remove(key: string, sync?: boolean) {
    this.calls.push(`remove:${sync}`)
    return this.values.delete(key)
  }
}

describe('credential and least-privilege contract', () => {
  test('stores credentials only through a native, device-only, non-synchronizing vault', async () => {
    const driver = new MemoryCredentialDriver()
    const vault = new CredentialVault('ios', driver)

    await vault.store(securityFixtureRefs.current, securityFixtureSecrets.refreshToken)
    const used = await vault.use(securityFixtureRefs.current, (value) => `used:${value.length}`)
    await vault.remove(securityFixtureRefs.current)

    expect(used).toBe(`used:${securityFixtureSecrets.refreshToken.length}`)
    expect(driver.calls).toEqual([
      'prefix:wovenleaf.credentials.v1.',
      'sync:false',
      'access:1',
      'set:false:1',
      'get:false',
      'remove:false',
    ])
    expect(driver.values.size).toBe(0)
    expect(CREDENTIAL_STORAGE_POLICY).toMatchObject({
      web: 'unavailable',
      cloudSync: false,
      automaticBackup: false,
    })
  })

  test('refuses browser persistence and does not expose a local-storage fallback', () => {
    expect(() => createCredentialVault('web')).toThrow(CredentialStoreUnavailableError)
  })

  test('requires explicit capabilities and rejects wildcard remote scopes', () => {
    expect(() =>
      requireIntegrationCapabilities(readOnlyCredentialGrant, ['annotations:read']),
    ).not.toThrow()
    expect(() =>
      requireIntegrationCapabilities(readOnlyCredentialGrant, ['annotations:write']),
    ).toThrow(CredentialAccessError)
    expect(() =>
      credentialGrantSchema.parse({
        ...readOnlyCredentialGrant,
        remoteScopes: ['*'],
      }),
    ).toThrow('Wildcard remote scopes are forbidden')
  })

  test('rotates and revokes credential metadata without putting secret values in it', () => {
    const rotatedAt = '2026-08-25T11:00:00.000Z'
    const rotated = rotateCredentialGrant(
      readOnlyCredentialGrant,
      securityFixtureRefs.replacement,
      rotatedAt,
    )

    expect(rotated.previous).toMatchObject({ state: 'revoked', revokedAt: rotatedAt })
    expect(rotated.replacement).toMatchObject({
      state: 'active',
      credentialRef: securityFixtureRefs.replacement,
      rotatedFrom: securityFixtureRefs.current,
      createdAt: rotatedAt,
    })
    expect(revokeCredentialGrant(rotated.replacement, rotatedAt).state).toBe('revoked')
    expect(JSON.stringify(rotated)).not.toContain(securityFixtureSecrets.refreshToken)
  })
})

describe('diagnostic and handoff boundaries', () => {
  test('redacts credentials, PINs, and private reading data from every diagnostic sink', () => {
    for (const channel of DIAGNOSTIC_CHANNELS) {
      const record = createDiagnosticRecord(
        channel,
        `refresh failed for Bearer ${securityFixtureSecrets.refreshToken}`,
        adversarialDiagnosticFixture,
        Object.values(securityFixtureSecrets),
      )
      const serialized = JSON.stringify(record)

      expect(serialized).toContain(REDACTED_SECRET)
      expect(serialized).toContain(REDACTED_PRIVATE_DATA)
      expect(serialized).toContain(securityFixtureRefs.current)
      expect(serialized).not.toContain(securityFixtureSecrets.refreshToken)
      expect(serialized).not.toContain(securityFixtureSecrets.libraryPin)
      expect(serialized).not.toContain(securityFixtureSecrets.password)
      expect(serialized).not.toContain('CARD-001-PRIVATE')
      expect(serialized).not.toContain('A private note about this chapter.')
    }
  })

  test('fails closed before credentials enter provider payloads, fixtures, or exports', () => {
    expect(() =>
      assertCredentialFree(adversarialDiagnosticFixture, Object.values(securityFixtureSecrets)),
    ).toThrow(CredentialLeakError)
    expect(() => assertCredentialFree(readOnlyCredentialGrant)).not.toThrow()
    expect(() =>
      assertCredentialFree({
        library: [{ bookTitle: 'Private but valid in an explicit private export' }],
        credentialRef: securityFixtureRefs.current,
      }),
    ).not.toThrow()
  })

  test('accepts only opaque handoff references and rejects credential-bearing links', () => {
    const safe = parseHandoffDeepLink(
      'wovenleaf://handoff?request=55f5ea1a-94b0-4f72-a2d7-6fc226fc9dca&nonce=RklydHVyZVNpbmdsZVVzZU5vbmNl',
    )
    expect(safe.request).toBe('55f5ea1a-94b0-4f72-a2d7-6fc226fc9dca')

    expect(() =>
      parseHandoffDeepLink(
        'wovenleaf://handoff?request=55f5ea1a-94b0-4f72-a2d7-6fc226fc9dca&nonce=RklydHVyZVNpbmdsZVVzZU5vbmNl&token=secret',
      ),
    ).toThrow('Handoff deep link must contain only request and nonce')
    expect(() =>
      parseHandoffDeepLink(
        'wovenleaf://other?request=55f5ea1a-94b0-4f72-a2d7-6fc226fc9dca&nonce=RklydHVyZVNpbmdsZVVzZU5vbmNl',
      ),
    ).toThrow('Unsupported Wovenleaf deep link')
  })
})

describe('native privacy configuration', () => {
  test('disables Android backup, limits deep links and sharing, and allows screenshots', async () => {
    const manifest = await Bun.file(
      new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url),
    ).text()
    const activity = await Bun.file(
      new URL(
        '../android/app/src/main/java/com/hmrguez/wovenleaf/MainActivity.java',
        import.meta.url,
      ),
    ).text()
    const filePaths = await Bun.file(
      new URL('../android/app/src/main/res/xml/file_paths.xml', import.meta.url),
    ).text()
    const extractionRules = await Bun.file(
      new URL('../android/app/src/main/res/xml/data_extraction_rules.xml', import.meta.url),
    ).text()

    expect(manifest).toContain('android:allowBackup="false"')
    expect(manifest).toContain('android:host="handoff"')
    expect(manifest).toContain('android:mimeType="text/csv"')
    expect(manifest).toContain('android:mimeType="application/csv"')
    const readerActivity = await Bun.file(
      new URL(
        '../android/app/src/main/java/com/hmrguez/wovenleaf/WovenleafReaderActivity.kt',
        import.meta.url,
      ),
    ).text()
    expect(activity).not.toContain('FLAG_SECURE')
    expect(readerActivity).not.toContain('FLAG_SECURE')
    expect(filePaths).toContain('path="shared-exports/"')
    expect(filePaths).not.toContain('<external-path')
    expect(extractionRules).toContain('<cloud-backup>')
    expect(extractionRules).toContain('<device-transfer>')
  })

  test('shields iOS task-switcher snapshots and excludes app data from automatic backup', async () => {
    const sceneDelegate = await Bun.file(
      new URL('../ios/App/App/SceneDelegate.swift', import.meta.url),
    ).text()
    const appDelegate = await Bun.file(
      new URL('../ios/App/App/AppDelegate.swift', import.meta.url),
    ).text()

    expect(sceneDelegate).toContain('func sceneWillResignActive')
    expect(sceneDelegate).toContain('privacyShield')
    expect(sceneDelegate).toContain('func sceneDidBecomeActive')
    expect(appDelegate).toContain('values.isExcludedFromBackup = true')
  })

  test('limits the iOS share handoff to one selected file and app-group storage', async () => {
    const shareInfo = await Bun.file(
      new URL('../ios/App/ShareExtension/Info.plist', import.meta.url),
    ).text()
    const shareController = await Bun.file(
      new URL('../ios/App/ShareExtension/ShareViewController.swift', import.meta.url),
    ).text()

    expect(shareInfo).toContain('NSExtensionActivationSupportsFileWithMaxCount')
    expect(shareController).toContain('group.com.hmrguez.wovenleaf')
    expect(shareController).toContain('UTType.commaSeparatedText')
    expect(shareController).toContain('IncomingShares')
  })

  test('handles native file opens on both cold launch and while the app is running', async () => {
    const app = await Bun.file(new URL('../src/App.tsx', import.meta.url)).text()
    const incoming = await Bun.file(new URL('../src/imports/incoming.ts', import.meta.url)).text()

    expect(app).toContain('CapacitorApp.getLaunchUrl()')
    expect(app).toContain("CapacitorApp.addListener('appUrlOpen'")
    expect(app).toContain('file|content|capacitor')
    expect(app).toContain('IncomingFileDeliveryGuard')
    expect(incoming).toContain('Filesystem.deleteFile')
    expect(incoming).toContain('IncomingShares')
  })
})
