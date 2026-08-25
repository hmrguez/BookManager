import { useEffect, useRef, useState } from 'react'
import type { LibraryBook } from '../library-model'
import { libraryBookSearchDocument } from './documents'
import { LocalSearchIndex, type SearchIndexCheckpoint } from './local-search'

export type LibrarySearchIndexState = {
  readonly index: LocalSearchIndex
  readonly checkpoint?: SearchIndexCheckpoint
  readonly indexing: boolean
}

export function useLibrarySearchIndex(books: readonly LibraryBook[]): LibrarySearchIndexState {
  const generation = useRef(0)
  const [state, setState] = useState<{
    readonly index: LocalSearchIndex
    readonly checkpoint?: SearchIndexCheckpoint
  }>(() => ({ index: new LocalSearchIndex() }))

  useEffect(() => {
    const currentGeneration = generation.current + 1
    generation.current = currentGeneration
    const nextIndex = new LocalSearchIndex()
    const documents = books.map(libraryBookSearchDocument)
    let active = true

    void nextIndex.rebuild(documents, {
      chunkSize: 50,
      shouldContinue: () => active && generation.current === currentGeneration,
      onCheckpoint: (nextCheckpoint) => {
        if (!active || generation.current !== currentGeneration) return
        setState({ index: nextIndex, checkpoint: nextCheckpoint })
      },
    })

    return () => {
      active = false
    }
  }, [books])

  return {
    index: state.index,
    checkpoint: state.checkpoint,
    indexing: state.index.size !== books.length || Boolean(state.checkpoint && !state.checkpoint.complete),
  }
}
