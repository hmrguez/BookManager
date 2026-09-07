# ADR 0004: Private reading data and integration credentials

- **Status:** Accepted
- **Date:** 2026-08-25
- **Issue:** QUI-23
- **Depends on:** [ADR 0001: Canonical catalog and access boundaries](0001-canonical-catalog-boundaries.md)
- **Revisit:** Before every write-capable adapter, cloud transport, or change to backup behavior

## Outcome

Wovenleaf treats the library, reading activity, annotations, account identifiers, and integration
credentials as private even though the application is local-first. This decision establishes one
contract for credential storage, diagnostics, exports, screen surfaces, deep links, browser
handoffs, backups, and future transports.

The executable contract is `apps/mobile/src/security/`. Its adversarial fixtures and proofs are in
`apps/mobile/tests/fixtures/security.ts` and `apps/mobile/tests/security-contract.test.ts`.

## Security goals and limits

Wovenleaf must:

1. keep tokens, PINs, passwords, private keys, and provider session material out of the application
   database, browser storage, URLs, logs, crash reports, analytics, and exports;
2. disclose no reading activity or private content through diagnostics, notifications, task-switcher
   snapshots, automatic backups, or implicit clipboard operations;
3. give every integration only the remote scopes and local capabilities needed for its current job;
4. make disconnect, credential rotation, remote revocation, and local erasure explicit and testable;
5. treat every import, deep link, extension message, remote response, and restored archive as
   untrusted input at a schema boundary.

The app does not claim to protect data from an attacker who can run code inside the unlocked app
process, a rooted/jailbroken device, a malicious operating system, coerced device unlock, or a
compromised upstream provider. Those are residual platform/provider risks. The controls below still
minimize recoverable secrets, transported data, and accidental disclosure in those conditions.

## Assets and classification

| Class | Assets | At-rest/export rule |
| --- | --- | --- |
| Public | App binaries, design assets, public bibliographic facts considered without user association | May appear in normal build diagnostics; never assume a user's query or selection is public |
| Private activity | Library membership, searches, shelves/lists, loans, holds, reading events, locations, sessions, ratings, goals, reminders, integration health | Local app store only; lossless encrypted backup or explicit private export; excluded from telemetry and share-safe export |
| Private content | Notes, annotations, highlights, quotes, journal text, library-card/account identifiers, local filenames, imported source payloads | Same as private activity, with text redacted even from structural share-safe output and support diagnostics |
| Secret | OAuth access/refresh tokens, API tokens, passwords, PINs, cookies, private keys, backup keys, authorization codes while redeemable | Native credential vault only; never database/export/clipboard/URL/diagnostic data; device-only and non-synchronizing |

Stable `CredentialRef` values and integration IDs are operational metadata, not secrets. They may be
stored in the application database and diagnostics, but must not contain usernames, provider account
IDs, token fragments, or other personal data.

The Google Books key currently compiled into the client is a restricted public-client identifier,
not a recoverable secret. It must remain restricted to the Books API and approved app identifiers or
origins. A provider secret that grants user or write access may never use that mechanism.

## Actors and trust boundaries

### Actors

- the device owner using the foreground app;
- another person with physical or screen access;
- iOS/Android and their backup, lock-screen, clipboard, sharing, notification, and accessibility
  services;
- Wovenleaf code, third-party dependencies, and future diagnostic/crash infrastructure;
- metadata, library, annotation, audiobook, and backup providers;
- the least-privilege browser extension and the web content it observes;
- a future Wovenleaf cloud relay or user-owned storage transport;
- an attacker controlling a deep link, imported file, provider response, network peer, or compromised
  provider account.

### Trust boundaries and flows

```text
Provider / browser page / imported file
              │ untrusted payload, URL, scope and timing
              ▼
Adapter parser + capability gate ──▶ canonical database ──▶ explicit export/backup
              │                            │                       │
              │ CredentialRef only         │ private data          │ new trust boundary
              ▼                            ▼                       ▼
iOS Keychain / Android Keystore     foreground UI          chosen destination
              │
              └── raw secret exists only inside a bounded request callback

External browser / extension ── opaque request + one-time nonce ──▶ handoff inbox
OS task switcher / lock screen ── opaque privacy shield, no private notification text
Diagnostics / crash / analytics ── mandatory redaction ──▶ non-sensitive event metadata
```

The WebView/native bridge, secure-store plugin, every adapter, and every transport are separate
boundaries. Successful parsing at one boundary does not make a value trusted at the next.

## Risk register

Probability and impact are qualitative for the current local-first architecture. A risk is high
when it can disclose Secret or broad Private data without another rare failure.

| ID | Threat and exposure | Rating | Owner | Required mitigation and verification |
| --- | --- | --- | --- | --- |
| R1 | Token/PIN is persisted in local storage, SQLite, source payloads, logs, analytics, crash context, URLs, or export fixtures | High | Adapter author; QUI-59 platform owner | Store only `CredentialRef`; use `CredentialVault`; route diagnostics through `createDiagnosticRecord`; adversarial tests search every sink for fixture secrets |
| R2 | Automatic device backup or device-to-device transfer copies private data or recoverable Android ciphertext/key metadata without informed user action | High | Persistence/backup owners; QUI-17 and QUI-64 | Android backup and transfer are excluded; iOS app data is marked excluded from automatic backup; future backup is explicit and encrypted before leaving the app |
| R3 | An integration asks for broad/wildcard scopes or uses a read credential for a new write path | High | Each integration issue owner | Record exact remote scopes and local capabilities; reject wildcards; call `requireIntegrationCapabilities` for every operation; security review before adding any `*:write` capability |
| R4 | Disconnect leaves a reusable token locally or remotely; rotation deletes the only usable credential before replacement is committed | High | Adapter author | Rotation stores/tests replacement, switches metadata, revokes old remote token, then removes old vault item; disconnect stops jobs, revokes remotely when supported, deletes locally, and retains only non-secret provenance |
| R5 | Malicious deep link or browser page injects a credential, commands a write, replays a handoff, or exfiltrates private state through an error URL | High | QUI-54/QUI-56 owners | Only `wovenleaf://handoff`; exact allowlist of `request` and high-entropy one-time `nonce`; no token/payload/command; expiry, replay cache, user confirmation, and origin/tab binding before extension delivery |
| R6 | Provider, extension, or future cloud transport can read/write data beyond the user's selected feature | High | Adapter/transport owner | Data minimization, per-operation capability checks, TLS, explicit preview for writes, checkpoint/reconciliation journal, no silent canonical deletion, and documented provider retention/revocation behavior |
| R7 | Lock screen, task switcher, screenshot, recording, notification, or clipboard reveals library/notes/credentials | High | Native shell and feature UI owners | iOS task-switcher shield; user-controlled Android screenshots and recordings; no secret reveal UI; no private notification text; clipboard is opt-in and secrets are forbidden; screen-capture behavior is disclosed below |
| R8 | Imported filenames, EPUB/OPDS content, archive paths, or provider payloads escape their sandbox or trigger parser/resource exhaustion | High | Import/reader/backup owners | Schema and size limits, normalized paths, no unrestricted absolute paths, no executable content, bounded decompression, isolated parsers, and adversarial fixtures before accepting each format |
| R9 | User assumes local-first means encrypted against someone using their unlocked device | Medium | Product/privacy owner | State the device-lock assumption plainly; optional app lock/database encryption requires a separate reviewed design; provide whole-library erasure and credential disconnect |
| R10 | Dependency or release-pipeline compromise captures credentials at runtime | Medium | Supply-chain/release owner; QUI-82 | Lock dependencies, minimize native plugins, audit updates, protect signing keys, and never send credentials to build/analytics services |

Owners must attach a follow-up issue before accepting a missing mitigation. High risks may not be
accepted silently or deferred inside implementation notes.

## Credential decision

`CredentialVault` is the only allowed persistence API for integration secrets:

- iOS stores them in Keychain with `whenUnlockedThisDeviceOnly`; iCloud Keychain synchronization is
  disabled. Items are unavailable while locked and do not migrate through backup to another device.
- Android encrypts values using AES-GCM with a key generated in Android Keystore and keeps ciphertext
  in app-private preferences. Automatic backup and device-transfer extraction are disabled.
- Production web builds have no credential vault. `createCredentialVault('web')` fails closed; the
  plugin's unencrypted web/local-storage implementation must never be used.
- The app database stores a branded `CredentialRef`, credential kind, exact remote scopes, local
  capabilities, lifecycle state, and timestamps. It never stores the credential value.
- Callers can use a secret only inside `CredentialVault.use(ref, callback)`. The vault deliberately
  exposes no enumerate-all or clear-all operation.

The native secure-store dependency is an implementation boundary, not a domain dependency. Adapters
depend on Wovenleaf's vault interface so the plugin can be replaced without changing integration
contracts.

### Least privilege

Every adapter operation declares one or more local capabilities from the closed vocabulary in
`integrationCapabilitySchema`. Examples:

- a metadata search uses `catalog:read` and no user credential when the provider permits it;
- a Readwise import uses `annotations:read`, not annotation write or library write;
- an OPDS catalog fetch uses `catalog:read`; downloading a chosen file additionally needs
  `files:read` after user action;
- backup upload uses `backup:write` for only the user-selected destination, not general file access;
- write/sync scopes are separate from corresponding read scopes and require a new security review.

Wildcard provider scopes are forbidden. If a provider offers only a broad scope, the issue must name
that fact, explain the server-side blast radius, minimize local capabilities, and get an explicit
user confirmation before the integration is enabled.

### Provisioning, rotation, revocation, and disconnect

1. Use an external system browser and OAuth Authorization Code with PKCE where supported. Validate
   redirect scheme/host, state, nonce, and issuer. Client secrets are not embedded in a mobile app.
2. Request the smallest provider scopes; show them in user language before authorization.
3. Exchange a one-time authorization code immediately, put the long-lived credential in the vault,
   and persist only its `CredentialRef` metadata after vault storage succeeds.
4. For rotation, store and validate the replacement first. Mark the previous grant revoked only when
   the replacement is durable, then revoke the previous remote credential and remove its vault item.
5. On disconnect, stop/suppress scheduled work, attempt provider revocation, remove the local vault
   item even if the provider is unavailable, mark the grant revoked, and retain imported canonical
   data plus non-secret provenance unless the user separately requests erasure.
6. Authentication failure never prints provider responses or token fragments. It changes integration
   health to a generic reconnect-required state.

## Diagnostics, exports, and analytics

Application logs, crash reports, analytics, and support exports share one fail-closed redaction
boundary. `createDiagnosticRecord` removes credential-shaped headers/keys/URLs, known in-memory
secret values, library cards, account identifiers, searches, book identifiers/titles, progress,
ratings, notes, and annotations. A stable operation name, integration key, `CredentialRef`, status,
duration bucket, and non-sensitive error code are sufficient for diagnosis.

Do not log raw request/response bodies, headers, URLs, imported rows, thrown provider messages, local
paths, or canonical entities and then rely only on regex redaction. Structured allowlisted events are
the normal design; the redactor is a final guard. No analytics or crash SDK may be enabled until its
collection, retention, deletion, consent, and pre-send filtering pass the security fixture.

Provider payload retention, test fixtures that model persisted data, and every export must call
`assertCredentialFree` before writing. This guard preserves legitimate private library data while
failing closed on secret-shaped fields, authorization material in URLs/headers, and known in-memory
secret values.

Full backups and private exports are data products, not diagnostics. Their schemas must explicitly
exclude credential values, cookies, authorization codes, unrestricted paths, and secure-store files.
Share-safe export remains opt-in and follows the per-event rules in ADR 0003.

## Screen, lock, screenshot, notification, and clipboard behavior

- The app shows an opaque Wovenleaf shield whenever iOS leaves the active foreground, keeping private
  content out of task-switcher and lock-screen snapshots.
- Android allows user-initiated screenshots and screen recordings in both the main app and native
  EPUB reader. Neither activity sets `FLAG_SECURE`; Android may also show the visible content in
  Recents and on external displays. This replaces the original blanket capture restriction following
  the product decision on 2026-09-07. Credential masking and the no-stored-token-display rule below
  still apply.
- iOS provides no supported guarantee that prevents a user-initiated screenshot. Wovenleaf shields
  background snapshots and must react to active capture for future high-sensitivity screens, but does
  not claim that visible content cannot be photographed or captured on a compromised device.
- Credentials/PINs are masked during entry, have no reveal-by-default state, never appear in
  accessibility labels, and disappear from component state after vault storage. No screen displays a
  stored token.
- Lock-screen notifications use generic text such as “Wovenleaf has an update”; titles, progress,
  loans, quotes, notes, and integration/account names require an explicit preview preference.
- Copying private reading content is an explicit user action. Tokens, PINs, passwords, backup keys,
  and library-card numbers are never copied by the app. Future timed clipboard clearing is defense in
  depth, not the primary control.

## Deep links and browser extension

The registered native route is restricted to `wovenleaf://handoff`. `parseHandoffDeepLink` accepts
exactly an opaque UUID request reference and a high-entropy base64url nonce. Links containing a token,
authorization code, provider payload, target path, command, URL fragment, or extra field are rejected.

The future extension may observe only fields the user enabled for the active supported site. It must
not read browser cookies, passwords, arbitrary history, or page content outside the narrow adapter.
Each handoff is initiated by a user gesture, bound to the extension origin and source tab, expires
quickly, is accepted once, enters a reconciliation inbox, and requires confirmation before any write.
The extension stores no long-lived Wovenleaf or provider credential.

## Database, device lock, and backup stance

The default local database is not separately passphrase-encrypted in this decision. Wovenleaf relies
on the OS app sandbox and device data protection while locked, recommends a device passcode, and is
clear that data is readable to the running app after unlock. App-layer database encryption would add
key recovery, background access, migration, indexing, and data-loss tradeoffs; it requires a separate
ADR and migration plan before it can be presented as an option.

Automatic app backup is disabled/excluded on both platforms until QUI-64 provides a user-controlled
transport. A future backup must be encrypted inside Wovenleaf before any file or network boundary,
authenticate its manifest and contents, use a unique random data-encryption key and nonce, and protect
that key with either a user recovery secret or a non-exportable device key. Device-only protection is
not called a backup unless recovery behavior is explained. Plain portable export is a distinct,
explicit user action with a destination warning and never contains credentials.

## Integration issue gate

Every integration, extension, import, export, backup, or transport issue must link QUI-23 / this ADR
and answer these before implementation:

1. What Private and Secret assets cross which trust boundaries?
2. What exact provider scopes and local capabilities are required? Why is each write scope needed?
3. Where is the `CredentialRef` metadata stored, and how are rotation, remote revocation, disconnect,
   and provider outage handled?
4. What can appear in logs, errors, health UI, notifications, screenshots, clipboard, exports, and
   fixtures?
5. How are payloads, sizes, origins, redirects, paths, replay, and partial failure validated?
6. What adversarial test proves least privilege and absence of credentials/private content from every
   unintended sink?

At minimum this gate applies to QUI-54 through QUI-67 and any later write-capable adapter. Adding a
write capability is a security contract change even when the provider credential already has that
scope.

## Verification and follow-ups

The current tests prove that:

- the production web path fails closed and the vault selects device-only, non-synchronizing storage;
- wildcard scopes, revoked grants, and missing local capabilities cannot authorize operations;
- rotation/revocation metadata contains references rather than secret values;
- adversarial token, PIN, password, library-card, and reading-note fixtures do not survive any
  diagnostic channel;
- credential-bearing or over-broad handoff URLs are rejected;
- Android backup/transfer, file sharing, and deep-link configuration remain constrained;
- Android main and reader activities allow screenshots without `FLAG_SECURE`;
- iOS retains the task-switcher shield and automatic-backup exclusion.

QUI-17 must apply the same classification to SQLite and verify OS data-protection behavior on real
devices. QUI-54/QUI-56 must implement nonce expiry/replay state and extension origin binding. QUI-59
must make capability checks and safe diagnostic events mandatory adapter interfaces. QUI-64 must
define the archive cryptography, recovery model, corrupt/tampered archive behavior, and restore drill.
