import { createContext, useContext, useLayoutEffect } from 'react'

export type DetailDraft = { dirty: boolean; save: () => boolean }
export const DetailDraftContext = createContext<((draft: DetailDraft) => () => void) | null>(null)

// Registers the editor without moving its state out of the mounted detail view.
export function useDetailDraft(dirty: boolean, save: () => boolean) {
  const register = useContext(DetailDraftContext)
  useLayoutEffect(() => {
    return register?.({ dirty, save })
  }, [register, dirty, save])
}
