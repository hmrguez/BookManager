export type LibraryView = 'list' | 'grid'

const STORAGE_KEY = 'wovenleaf.library-view.v1'

export function readLibraryView(): LibraryView {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

export function saveLibraryView(view: LibraryView) {
  try {
    window.localStorage.setItem(STORAGE_KEY, view)
  } catch {
    // Keep the selection for this session when device storage is unavailable.
  }
}
