/**
 * QUI-54 feasibility experiment, not a Libby importer or a regression contract.
 * Run: bun scripts/spikes/libby-boundaries.ts
 * All inputs are synthetic; no network, credentials, files, or database writes.
 * Assertions describe the inspected baseline and may change as Libby support lands.
 */
import assert from 'node:assert/strict'
import { loanSchema } from '../../src/domain/catalog/access'
import { canonicalImportAdapterFor } from '../../src/imports/canonical-adapters'
import { wovenleafCsvParser } from '../../src/imports/csv-parser'
import { importEntityProposalSchema } from '../../src/imports/model'
import { createImportPreview } from '../../src/imports/pipeline'
import { parseHandoffDeepLink } from '../../src/security/handoff'

// Deliberately NOT a claimed Libby export schema. These rows test whether the
// existing book-oriented pipeline could safely carry circulation events as-is.
const syntheticCsv = [
  'external_id,title,authors,action,event_at',
  'synthetic-title,Synthetic Book,Synthetic Author,borrow,2026-09-01T12:00:00Z',
  'synthetic-title,Synthetic Book,Synthetic Author,return,2026-09-10T12:00:00Z',
].join('\n')

const preview = await createImportPreview({
  id: 'libby-spike:book-keys',
  fileName: 'synthetic-events.csv',
  content: syntheticCsv,
  createdAt: '2026-09-15T12:00:00Z',
  parser: wovenleafCsvParser,
  existingBooks: [],
})
assert.equal(preview.proposals.length, 2)
assert.equal(preview.proposals[0]?.kind, 'add')
assert.equal(preview.proposals[1]?.kind, 'error')
assert.equal(preview.proposals[0]?.rowHash, preview.proposals[1]?.rowHash)
assert.equal(preview.proposals[0]?.raw.action, 'borrow')
assert.equal(preview.proposals[1]?.raw.action, 'return')
assert.equal(preview.proposals[0]?.record?.shelf, undefined)

// Making every event a new book identity avoids the duplicate-key error but
// proposes two book additions. Event identity and bibliographic identity differ.
const eventKeyPreview = await createImportPreview({
  id: 'libby-spike:event-keys',
  fileName: 'synthetic-events.csv',
  content: syntheticCsv
    .replace('synthetic-title,Synthetic Book', 'synthetic-borrow,Synthetic Book')
    .replace('synthetic-title,Synthetic Book', 'synthetic-return,Synthetic Book'),
  createdAt: '2026-09-15T12:00:00Z',
  parser: wovenleafCsvParser,
  existingBooks: [],
})
assert.deepEqual(eventKeyPreview.proposals.map(({ kind }) => kind), ['add', 'add'])

const incompleteLoan = {
  id: 'loan:synthetic',
  editionId: 'edition:synthetic',
  lenderName: 'Synthetic Library',
  borrowedAt: '2026-09-01T12:00:00Z',
  renewalCount: 0,
}
assert.equal(loanSchema.safeParse(incompleteLoan).success, false)
assert.equal(loanSchema.safeParse({
  ...incompleteLoan,
  dueAt: '2026-09-22T12:00:00Z',
}).success, true)

const entityProposal = {
  entityId: 'synthetic',
  action: 'add',
  label: 'Synthetic entity',
  sourceKey: 'libby-timeline',
  confidence: 'exact',
  rationale: 'Synthetic feasibility probe',
}
for (const entityType of ['loan', 'hold', 'access-grant']) {
  assert.equal(importEntityProposalSchema.safeParse({ ...entityProposal, entityType }).success, false)
}
assert.equal(canonicalImportAdapterFor('libby-timeline'), undefined)
assert.equal(canonicalImportAdapterFor('libby-tags'), undefined)

const link = 'wovenleaf://handoff?request=11111111-1111-4111-8111-111111111111&nonce=synthetic-nonce-0000000000'
assert.deepEqual(parseHandoffDeepLink(link), parseHandoffDeepLink(link))
assert.throws(() => parseHandoffDeepLink(`${link}&payload=synthetic`))
assert.throws(() => parseHandoffDeepLink(`${link}&token=synthetic`))

console.log(JSON.stringify({
  fixture: 'synthetic; not a real Libby export',
  observations: {
    titleKeyForTwoEvents: 'second row quarantined',
    circulationOnlyChanges: 'raw rows differ but normalized hashes are identical',
    separateEventKeys: 'two book additions proposed; needs grouping by title/edition',
    missingDueDate: 'cannot construct a canonical loan; retain incomplete source evidence',
    importProposalEntities: 'loan, hold, and access-grant are not supported',
    libbyCanonicalAdapters: 'not implemented',
    deepLink: 'opaque reference accepted; payload and token rejected',
    replay: 'parser alone is stateless; delivery needs a durable replay check and transport',
  },
  assertions: 'passed',
}, null, 2))
