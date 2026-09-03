import type { Catalog } from '../domain/catalog'
import { planGoodreadsCatalog, type GoodreadsCatalogPlan } from './goodreads-catalog'
import type { ImportProposal } from './model'

export type CanonicalImportPlanInput = {
  readonly proposal: ImportProposal
  readonly targetBookId: string
  readonly batchId: string
  readonly timestamp: string
  readonly catalog: Catalog
}

export interface CanonicalImportAdapter {
  readonly sourceKey: string
  plan(input: CanonicalImportPlanInput): Promise<GoodreadsCatalogPlan>
}

const adapters: readonly CanonicalImportAdapter[] = [{
  sourceKey: 'goodreads-csv',
  async plan(input) {
    if (!input.proposal.record?.goodreads) return { changes: [], entities: [] }
    return planGoodreadsCatalog({
      record: input.proposal.record,
      raw: input.proposal.raw,
      rowHash: input.proposal.rowHash,
      targetBookId: input.targetBookId,
      batchId: input.batchId,
      timestamp: input.timestamp,
      catalog: input.catalog,
      matchConfidence: input.proposal.match.confidence,
    })
  },
}]

/** Keeps source semantics in versioned adapters while the repository owns one commit boundary. */
export function canonicalImportAdapterFor(sourceKey: string): CanonicalImportAdapter | undefined {
  return adapters.find((adapter) => adapter.sourceKey === sourceKey)
}
