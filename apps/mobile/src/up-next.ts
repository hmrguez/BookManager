import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createDefaultUpNextState,
  upNextStateSchema,
  type UpNextCriterion,
  type UpNextPreferences,
  type UpNextState,
} from './up-next-model'
import type { UpNextRepository } from './storage/up-next-repository'
import { getStorageRuntime } from './storage/runtime'
import type { LibraryBook } from './library-model'

export function useUpNext(books: readonly LibraryBook[]) {
  const [upNext, setUpNext] = useState<UpNextState>(createDefaultUpNextState)
  const [hydrated, setHydrated] = useState(false)
  const [upNextError, setUpNextError] = useState<string>()
  const stateRef = useRef(upNext)
  const hasMutatedRef = useRef(false)
  const persistenceTailRef = useRef(Promise.resolve())

  const showState = useCallback((next: UpNextState) => {
    const validated = upNextStateSchema.parse(next)
    stateRef.current = validated
    setUpNext(validated)
  }, [])

  const enqueuePersistence = useCallback(
    (operation: (repository: UpNextRepository) => Promise<void>) => {
      const write = persistenceTailRef.current
        .then(async () => operation((await getStorageRuntime()).upNext))
      persistenceTailRef.current = write
        .catch((error: unknown) => {
          setUpNextError(error instanceof Error ? error.message : String(error))
        })
      return write
    },
    [],
  )

  useEffect(() => {
    let active = true
    void getStorageRuntime()
      .then(({ upNext: repository }) => repository.read())
      .then((stored) => {
        if (active && !hasMutatedRef.current) showState(stored)
      })
      .catch((error: unknown) => {
        if (active) setUpNextError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { if (active) setHydrated(true) })
    return () => {
      active = false
    }
  }, [showState])

  const changeState = useCallback((update: (current: UpNextState) => UpNextState) => {
    const changed = upNextStateSchema.parse({
      ...update(stateRef.current),
      updatedAt: new Date().toISOString(),
    })
    hasMutatedRef.current = true
    showState(changed)
    return enqueuePersistence((repository) => repository.save(changed))
  }, [enqueuePersistence, showState])

  const savePreferences = useCallback((
    mode: UpNextState['mode'],
    preferences: UpNextPreferences,
  ) => {
    return changeState((current) => ({ ...current, mode, preferences,
      ...(preferences.preset !== 'custom' ? { pinnedCriteria: [], dismissedCriteria: [] } : {}),
    }))
  }, [changeState])

  const addQueueBook = useCallback((bookId: string) => {
    changeState((current) => current.queueBookIds.includes(bookId)
      ? current
      : { ...current, queueBookIds: [
        ...new Set([
          ...current.queueBookIds,
          ...books.filter(({ id, shelf }) => shelf === 'next' && id !== bookId).map(({ id }) => id),
        ]),
        bookId,
      ] })
  }, [books, changeState])

  const removeQueueBook = useCallback((bookId: string) => {
    changeState((current) => ({
      ...current,
      queueBookIds: current.queueBookIds.filter((id) => id !== bookId),
      pinnedBookId: current.pinnedBookId === bookId ? null : current.pinnedBookId,
    }))
  }, [changeState])

  const moveQueueBook = useCallback((bookId: string, targetIndex: number, visibleIds: readonly string[]) => {
    changeState((current) => {
      const ordered = [...visibleIds]
      const sourceIndex = ordered.indexOf(bookId)
      if (sourceIndex === -1) return current
      const [moved] = ordered.splice(sourceIndex, 1)
      ordered.splice(Math.max(0, Math.min(ordered.length, targetIndex)), 0, moved)
      const visible = new Set(visibleIds)
      return {
        ...current,
        queueBookIds: [
          ...ordered,
          ...current.queueBookIds.filter((id) => !visible.has(id)),
        ],
      }
    })
  }, [changeState])

  const togglePinnedBook = useCallback((bookId: string) => {
    changeState((current) => ({
      ...current,
      pinnedBookId: current.pinnedBookId === bookId ? null : bookId,
    }))
  }, [changeState])

  const setReasonState = useCallback((
    criterion: UpNextCriterion,
    state: 'neutral' | 'pinned' | 'dismissed',
  ) => {
    changeState((current) => ({
      ...current,
      preferences: { ...current.preferences, preset: 'custom' },
      pinnedCriteria: state === 'pinned'
        ? [...current.pinnedCriteria.filter((item) => item !== criterion), criterion]
        : current.pinnedCriteria.filter((item) => item !== criterion),
      dismissedCriteria: state === 'dismissed'
        ? [...current.dismissedCriteria.filter((item) => item !== criterion), criterion]
        : current.dismissedCriteria.filter((item) => item !== criterion),
    }))
  }, [changeState])

  const dismissSuggestion = useCallback((bookId: string) => {
    changeState((current) => ({
      ...current,
      dismissedSuggestions: [
        ...current.dismissedSuggestions.filter((dismissal) => dismissal.bookId !== bookId),
        { bookId, dismissedAt: new Date().toISOString() },
      ],
    }))
  }, [changeState])

  const restoreSuggestion = useCallback((bookId: string) => {
    changeState((current) => ({
      ...current,
      dismissedSuggestions: current.dismissedSuggestions.filter(
        (dismissal) => dismissal.bookId !== bookId,
      ),
    }))
  }, [changeState])

  const reloadUpNext = useCallback(async () => {
    await persistenceTailRef.current
    const stored = await (await getStorageRuntime()).upNext.read()
    hasMutatedRef.current = false
    showState(stored)
    setUpNextError(undefined)
    return stored
  }, [showState])

  return {
    upNext,
    hydrated,
    upNextError,
    savePreferences,
    addQueueBook,
    removeQueueBook,
    moveQueueBook,
    togglePinnedBook,
    setReasonState,
    dismissSuggestion,
    restoreSuggestion,
    reloadUpNext,
  }
}
