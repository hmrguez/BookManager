function enabled(value: string | undefined): boolean {
  return value?.trim().toLocaleLowerCase() === 'true'
}

/** Advanced surfaces stay available while the default experience remains quiet. */
export const FEATURES = Object.freeze({
  devTools: import.meta.env.DEV || enabled(import.meta.env.VITE_FEATURE_DEV_TOOLS),
  assistedUpNext: enabled(import.meta.env.VITE_FEATURE_ASSISTED_UP_NEXT),
  smartLists: enabled(import.meta.env.VITE_FEATURE_SMART_LISTS),
  advancedBookDetails: enabled(import.meta.env.VITE_FEATURE_ADVANCED_BOOK_DETAILS),
  advancedFileManagement: enabled(import.meta.env.VITE_FEATURE_ADVANCED_FILE_MANAGEMENT),
})
