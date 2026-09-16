import { createContext, useContext } from 'react'
import type { LibraryView } from './view-preference'

export const ViewContext = createContext<LibraryView>('list')
export const ChangeViewContext = createContext<(view: LibraryView) => void>(() => {})
export const useLibraryView = () => useContext(ViewContext)
