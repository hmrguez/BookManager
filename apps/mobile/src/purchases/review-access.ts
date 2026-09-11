export type ReviewAccessView = {
  readonly active: boolean
  readonly loading: boolean
  readonly busy: boolean
  readonly error?: string
}

export interface ReviewAccessStore {
  getReviewAccess(): Promise<{ active: boolean }>
  activateReviewAccess(options: { token: string }): Promise<{ active: boolean }>
  endReviewAccess(): Promise<{ active: boolean }>
}

/** Review grants never change store ownership or enter library backups. */
export class ReviewAccessService {
  readonly #store: ReviewAccessStore
  readonly #listeners = new Set<() => void>()
  #view: ReviewAccessView = { active: false, loading: true, busy: false }
  #queue: Promise<void> = Promise.resolve()

  constructor(store: ReviewAccessStore) { this.#store = store }

  getSnapshot = (): ReviewAccessView => this.#view
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  #update(patch: Partial<ReviewAccessView>) {
    this.#view = { ...this.#view, ...patch }
    this.#listeners.forEach((listener) => listener())
  }

  refresh = (): Promise<void> => this.#run(
    () => this.#store.getReviewAccess(), 'Review access could not be checked. Please try again.',
  )

  hasAccess = async (): Promise<boolean> => {
    if (this.#view.loading && !this.#view.busy) await this.refresh()
    await this.#queue
    return this.#view.active
  }

  activate = (token: string): Promise<void> => this.#run(
    () => this.#store.activateReviewAccess({ token: token.trim() }),
    'This review token could not be activated. Check that you pasted the complete token and try again.',
  )

  end = (): Promise<void> => this.#run(
    () => this.#store.endReviewAccess(), 'Review access could not be ended. Please try again.',
  )

  #run(operation: () => Promise<{ active: boolean }>, error: string): Promise<void> {
    // Serialize refresh, activation, and ending access so stale results cannot restore a grant.
    this.#update({ busy: true, error: undefined })
    const next = this.#queue.then(async () => {
      try {
        const status = await operation()
        this.#update({ active: status.active, error: undefined })
      } catch {
        this.#update({ active: false, error })
      } finally {
        this.#update({ loading: false })
      }
    })
    this.#queue = next
    return next.finally(() => {
      if (this.#queue === next) this.#update({ busy: false })
    })
  }
}
