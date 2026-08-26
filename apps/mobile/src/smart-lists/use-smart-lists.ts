import { useCallback, useEffect, useRef, useState } from 'react'
import {
  savedSmartListSchema,
  SMART_LIST_POSITION_STEP,
  smartListId,
  type SavedSmartList,
  type SmartListDefinition,
} from './model'
import type { SmartListRepository } from '../storage/smart-list-repository'
import { getStorageRuntime } from '../storage/runtime'

export type SmartListDraft = {
  readonly id?: string
  readonly name: string
  readonly description: string
  readonly pinned: boolean
  readonly archived?: boolean
  readonly definition: SmartListDefinition
}

export function useSmartLists() {
  const [smartLists, setSmartLists] = useState<SavedSmartList[]>([])
  const [smartListError, setSmartListError] = useState<string>()
  const smartListsRef = useRef(smartLists)
  const hasMutatedRef = useRef(false)
  const persistenceTailRef = useRef(Promise.resolve())

  const showSmartLists = useCallback((next: SavedSmartList[]) => {
    const validated = next.map((list) => savedSmartListSchema.parse(list))
    smartListsRef.current = validated
    setSmartLists(validated)
  }, [])

  const enqueuePersistence = useCallback(
    (operation: (repository: SmartListRepository) => Promise<void>) => {
      persistenceTailRef.current = persistenceTailRef.current
        .then(async () => operation((await getStorageRuntime()).smartLists))
        .catch((error: unknown) => {
          setSmartListError(error instanceof Error ? error.message : String(error))
        })
    },
    [],
  )

  useEffect(() => {
    let active = true
    void getStorageRuntime()
      .then(({ smartLists: repository }) => repository.read())
      .then((stored) => {
        if (active && !hasMutatedRef.current) showSmartLists(stored)
      })
      .catch((error: unknown) => {
        if (active) setSmartListError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      active = false
    }
  }, [showSmartLists])

  const saveSmartList = useCallback((draft: SmartListDraft): string => {
    const current = smartListsRef.current
    const previous = draft.id ? current.find(({ id }) => id === draft.id) : undefined
    const timestamp = new Date().toISOString()
    const list = savedSmartListSchema.parse({
      id: previous?.id ?? smartListId('smart-list'),
      name: draft.name.trim(),
      description: draft.description.trim(),
      pinned: draft.pinned,
      archived: draft.archived ?? previous?.archived ?? false,
      position: previous?.position
        ?? current.reduce((maximum, item) => Math.max(maximum, item.position), 0)
          + SMART_LIST_POSITION_STEP,
      definition: draft.definition,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
    hasMutatedRef.current = true
    showSmartLists(previous
      ? current.map((item) => item.id === list.id ? list : item)
      : [...current, list])
    enqueuePersistence((repository) => repository.save(list))
    return list.id
  }, [enqueuePersistence, showSmartLists])

  const saveStoredSmartList = useCallback((list: SavedSmartList) => {
    const validated = savedSmartListSchema.parse(list)
    const current = smartListsRef.current
    hasMutatedRef.current = true
    showSmartLists(current.map((item) => item.id === validated.id ? validated : item))
    enqueuePersistence((repository) => repository.save(validated))
  }, [enqueuePersistence, showSmartLists])

  const removeSmartList = useCallback((id: string) => {
    const current = smartListsRef.current
    if (!current.some((list) => list.id === id)) return
    hasMutatedRef.current = true
    showSmartLists(current.filter((list) => list.id !== id))
    enqueuePersistence((repository) => repository.remove(id))
  }, [enqueuePersistence, showSmartLists])

  return {
    smartLists,
    smartListError,
    saveSmartList,
    saveStoredSmartList,
    removeSmartList,
  }
}
