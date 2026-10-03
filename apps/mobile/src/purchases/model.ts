export const FREE_BOOK_LIMIT = 30
export const UNLIMITED_PRODUCT_ID = 'com.hmrguez.wovenleaf.unlimited'

export type PurchaseStatus = {
  readonly platform: 'ios' | 'android' | 'web'
  readonly owned: boolean
  readonly pending: boolean
  readonly available: boolean
  readonly price?: string
  readonly canRedeem?: boolean
}

export type PurchaseOutcome = 'purchased' | 'pending' | 'cancelled'

export interface PurchaseStore {
  getStatus(): Promise<PurchaseStatus>
  purchase(): Promise<{ outcome: PurchaseOutcome }>
  restore(): Promise<PurchaseStatus>
  redeem(): Promise<void>
}

export class LibraryUpgradeRequired extends Error {
  constructor() {
    super(`Your free library includes ${FREE_BOOK_LIMIT} books. Upgrade once to add more, or keep using your current library.`)
    this.name = 'LibraryUpgradeRequired'
  }
}

export function requiresUpgrade(_currentCount: number, resultingCount: number, newBookCount: number): boolean {
  return newBookCount > 0 && resultingCount > FREE_BOOK_LIMIT
}
