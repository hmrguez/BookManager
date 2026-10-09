import type { ShelfId } from '../library'
import type { ValidIsbn } from '../capture'

export type SheetState =
  | {
      kind: 'search'
      shelf: ShelfId
      manual?: boolean
      initialCapture?: { readonly isbn: ValidIsbn; readonly method: 'share-sheet' }
    }
  | { kind: 'detail'; bookId: string }
  | { kind: 'progress'; bookId: string }
  | { kind: 'finished'; bookId: string }
  | { kind: 'audiobook-player'; bookId: string }
  | { kind: 'custom-shelf'; shelfId?: string }
  | { kind: 'smart-list'; smartListId?: string }
  | { kind: 'quarterly-reviews'; period?: import('../reviews/keepsake-model').ReviewPeriod }
  | { kind: 'up-next' }
  | { kind: 'recommendation'; bookId: string }
  | null

export type AppView = 'library' | 'settings' | 'import' | 'reviews' | 'stats'

export type ToastState = {
  message: string
  undo?: () => void
  family?: 'undo'
} | null

export type ExportFormat = 'archive' | 'csv' | 'markdown'
