const STORAGE_PREFIX = 'wovenleaf.shelf-collapsed.v1.'

export function readShelfCollapsed(shelfKey: string, bookCount: number): boolean {
  try {
    const saved = window.localStorage.getItem(`${STORAGE_PREFIX}${shelfKey}`)
    if (saved === 'true' || saved === 'false') return saved === 'true'
  } catch {
    // Use the default when device storage is unavailable.
  }
  return bookCount >= 30
}

export function saveShelfCollapsed(shelfKey: string, collapsed: boolean) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${shelfKey}`, String(collapsed))
  } catch {
    // The hook keeps the choice in memory when device storage is unavailable.
  }
}
