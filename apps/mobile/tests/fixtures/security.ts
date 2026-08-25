import {
  credentialGrantSchema,
  credentialRefSchema,
} from '../../src/security'

export const securityFixtureSecrets = {
  refreshToken: 'test-only-refresh-token-never-real',
  libraryPin: '739152',
  password: 'test-only-password-never-real',
} as const

export const securityFixtureRefs = {
  current: credentialRefSchema.parse(
    'credential:readwise:fixture-current-001',
  ),
  replacement: credentialRefSchema.parse(
    'credential:readwise:fixture-replacement-002',
  ),
} as const

export const readOnlyCredentialGrant = credentialGrantSchema.parse({
  integrationKey: 'readwise',
  credentialRef: securityFixtureRefs.current,
  kind: 'oauth-refresh-token',
  capabilities: ['annotations:read'],
  remoteScopes: ['highlights.read'],
  state: 'active',
  createdAt: '2026-08-25T10:00:00.000Z',
})

export const adversarialDiagnosticFixture = {
  operation: 'integration-refresh',
  credentialRef: securityFixtureRefs.current,
  request: {
    headers: {
      authorization: `Bearer ${securityFixtureSecrets.refreshToken}`,
      cookie: `session=${securityFixtureSecrets.refreshToken}`,
    },
    url: `https://reader.example/sync?access_token=${securityFixtureSecrets.refreshToken}`,
    body: {
      libraryCardNumber: 'CARD-001-PRIVATE',
      pin: securityFixtureSecrets.libraryPin,
      password: securityFixtureSecrets.password,
    },
  },
  response: {
    currentPage: 134,
    note: 'A private note about this chapter.',
    nested: {
      accessToken: securityFixtureSecrets.refreshToken,
    },
  },
}
