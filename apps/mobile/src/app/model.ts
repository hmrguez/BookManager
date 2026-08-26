import type { ShelfId } from '../library'

export type SheetState =
  | { kind: 'search'; shelf: ShelfId; manual?: boolean }
  | { kind: 'detail'; bookId: string }
  | { kind: 'progress'; bookId: string }
  | { kind: 'finished'; bookId: string }
  | { kind: 'custom-shelf'; shelfId?: string }
  | { kind: 'smart-list'; smartListId?: string }
  | { kind: 'up-next' }
  | null

export type AppView = 'library' | 'settings' | 'import'

export type ToastState = {
  message: string
  undo?: () => void
  family?: 'undo'
} | null

export type ExportFormat = 'archive' | 'csv' | 'markdown'
