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
  const [state, setState] = useState<LibrarySearchIndexState>(() => ({ index: new LocalSearchIndex(), indexing: false }))
  const published = useRef({ index: state.index, signatures: new Map<string, string>() })

  useEffect(() => {
    const previous = published.current
    const signatures = new Map<string, string>()
    const documents = books.map(libraryBookSearchDocument)
    const changed = documents.filter((document) => {
      const signature = JSON.stringify(document)
      signatures.set(document.id, signature)
      return previous.signatures.get(document.id) !== signature
    })
    const removed = [...previous.signatures.keys()].filter((id) => !signatures.has(id))
    if (!changed.length && !removed.length) {
      setState((current) => current.indexing ? { ...current, indexing: false } : current)
      return
    }

    let active = true
    const publish = (index: LocalSearchIndex) => {
      if (!active) return
      published.current = { index, signatures }
      setState({ index, checkpoint: index.checkpoint, indexing: false })
    }
    if (changed.length + removed.length <= 100) {
      publish(previous.index.withChanges(changed, removed))
    } else {
      const nextIndex = new LocalSearchIndex()
      setState((current) => ({ ...current, indexing: true }))
      // Bulk imports yield to input, but publish once rather than re-rendering every 50 books.
      void nextIndex.rebuild(documents, {
        chunkSize: 50,
        shouldContinue: () => active,
      }).then(() => publish(nextIndex))
    }
    return () => { active = false }
  }, [books])

  return state
}
