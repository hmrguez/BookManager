import { catalogSchema, type Catalog } from '../domain/catalog'
import { planGoodreadsCatalog, type GoodreadsCatalogPlan } from './goodreads-catalog'
import type { ImportProposal } from './model'
import { ImportCatalogIndex, importCatalogCollections } from './catalog-index'

export type CanonicalImportPlanInput = {
  readonly proposal: ImportProposal
  readonly targetBookId: string
  readonly batchId: string
  readonly timestamp: string
  readonly catalog: Catalog
  readonly deferValidation?: boolean
  readonly index?: ImportCatalogIndex
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
      deferValidation: input.deferValidation,
      index: input.index,
    })
  },
}]

/** Keeps source semantics in versioned adapters while the repository owns one commit boundary. */
export function canonicalImportAdapterFor(sourceKey: string): CanonicalImportAdapter | undefined {
  return adapters.find((adapter) => adapter.sourceKey === sourceKey)
}

/** Reuse one evolving snapshot instead of reading and validating the entire DB for every row. */
export class CanonicalImportSession {
  readonly #adapter: CanonicalImportAdapter
  readonly #catalog: Catalog
  readonly #positions = new Map<string, Map<string, number>>()
  readonly #index: ImportCatalogIndex

  constructor(adapter: CanonicalImportAdapter, catalog: Catalog) {
    this.#adapter = adapter
    this.#catalog = { ...catalog }
    this.#index = new ImportCatalogIndex(catalog)
    for (const key of Object.values(importCatalogCollections)) {
      const entries = [...catalog[key]]
      Object.assign(this.#catalog, { [key]: entries })
      this.#positions.set(key, new Map(entries.map(({ id }, position) => [id, position])))
    }
  }

  async plan(input: Omit<CanonicalImportPlanInput, 'catalog' | 'deferValidation'>): Promise<GoodreadsCatalogPlan> {
    const plan = await this.#adapter.plan({ ...input, catalog: this.#catalog, deferValidation: true, index: this.#index })
    for (const change of plan.changes) {
      const key = importCatalogCollections[change.entityType]
      const positions = this.#positions.get(key)!
      const entries = this.#catalog[key] as unknown[]
      const position = positions.get(change.entityId)
      if (position === undefined) {
        positions.set(change.entityId, entries.length)
        entries.push(change.after)
      } else entries[position] = change.after
      this.#index.set(change.entityType, change.entityId, change.after)
    }
    return plan
  }

  validate(): void { catalogSchema.parse(this.#catalog) }
}
