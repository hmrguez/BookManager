import { LibraryUpgradeRequired, requiresUpgrade, type PurchaseStatus, type PurchaseStore } from './model'
import type { ReviewAccessService } from './review-access'

export type PurchaseView = PurchaseStatus & {
  readonly loading: boolean
  readonly busy: boolean
  readonly message?: string
  readonly error?: string
}

/** Store receipts stay native. A library export never grants a purchase. */
export class PurchaseService {
  readonly #store: PurchaseStore
  readonly #reviewAccess?: Pick<ReviewAccessService, 'hasAccess'>
  readonly #listeners = new Set<() => void>()
  readonly #upgradeListeners = new Set<() => void>()
  #refreshing?: Promise<void>
  #view: PurchaseView

  constructor(store: PurchaseStore, platform: PurchaseStatus['platform'], reviewAccess?: Pick<ReviewAccessService, 'hasAccess'>) {
    this.#store = store
    this.#reviewAccess = reviewAccess
    this.#view = { platform, owned: false, pending: false, available: false, loading: true, busy: false }
  }

  getSnapshot = (): PurchaseView => this.#view
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
  onUpgradeRequired = (listener: () => void): (() => void) => {
    this.#upgradeListeners.add(listener)
    return () => { this.#upgradeListeners.delete(listener) }
  }

  #update(patch: Partial<PurchaseView>) {
    this.#view = { ...this.#view, ...patch }
    this.#listeners.forEach((listener) => listener())
  }

  refresh = (): Promise<void> => {
    this.#refreshing ??= storeStatusWithTimeout(this.#store.getStatus())
      .then((status) => this.#update({ ...status, price: status.price, error: undefined }))
      .catch(() => this.#update({ available: false, error: 'The store could not be reached. Please try again.' }))
      .finally(() => {
        this.#refreshing = undefined
        this.#update({ loading: false })
      })
    return this.#refreshing
  }

  refreshAfterChange = async (): Promise<void> => {
    // A transaction may arrive while an older status query is still loading prices.
    // Always perform a fresh query after that request, rather than losing the update.
    await this.#refreshing
    await this.refresh()
  }

  assertCapacity = async (currentCount: number, resultingCount: number, newBookCount: number): Promise<void> => {
    if (!requiresUpgrade(currentCount, resultingCount, newBookCount)) return
    // A verified review grant works even when the store is offline or unavailable.
    if (await this.#reviewAccess?.hasAccess()) return
    if (this.#view.loading) await this.refresh()
    if (this.#view.owned) return
    this.#upgradeListeners.forEach((listener) => listener())
    throw new LibraryUpgradeRequired()
  }

  purchase = async (): Promise<void> => {
    if (this.#view.busy || this.#view.loading || !this.#view.available || this.#view.owned) return
    await this.#perform(async () => {
      const { outcome } = await this.#store.purchase()
      await this.refresh()
      this.#update({ message: this.#view.owned ? 'Unlimited books are yours. Continue adding to your library.'
        : outcome === 'pending' ? 'Your purchase is awaiting approval. Your library will unlock when it completes.'
          : outcome === 'cancelled' ? undefined : 'Checking your purchase. You can also restore it below.' })
    })
  }

  restore = async (): Promise<void> => {
    if (this.#view.busy) return
    await this.#perform(async () => {
      const status = await this.#store.restore()
      this.#update({ ...status, loading: false, message: status.owned
        ? 'Purchase restored. Unlimited books are yours.'
        : status.pending ? 'Your purchase is still awaiting approval.'
          : 'No purchase was found. Use the same store account you purchased with.' })
    })
  }

  redeem = async (): Promise<void> => {
    if (this.#view.busy) return
    await this.#perform(async () => {
      await this.#store.redeem()
      await this.refresh()
    })
  }

  async #perform(operation: () => Promise<void>) {
    this.#update({ busy: true, error: undefined, message: undefined })
    try {
      // Do not let an earlier status request overwrite a restore or purchase result.
      await this.#refreshing
      await operation()
    } catch {
      this.#update({ error: 'The store could not complete this request. Please try again.' })
    } finally {
      this.#update({ busy: false })
    }
  }
}

function storeStatusWithTimeout(status: Promise<PurchaseStatus>): Promise<PurchaseStatus> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Store status timed out')), 20_000)
    status.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}
