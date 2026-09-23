import { useCallback, useImperativeHandle, useRef, useState, useLayoutEffect, type ReactNode, type Ref } from 'react'
import { DetailDraftContext, type DetailDraft } from './DetailDraft'

export type DetailSheetHandle = { requestLeave: (action: () => void) => void }
import type { LibraryBook, ShelfId } from '../library'
import type { CustomShelf } from '../organization-model'
import { Sheet } from '../app/components/Sheet'
import {
  WorkDetailExperience,
  type AudiobookAttachmentState,
  type EpubAttachmentState,
} from './WorkDetailExperience'

export function DetailSheet({
  ref,
  book,
  libby,
  libbyLinked,
  customShelves,
  customShelfIds,
  tags,
  tagSuggestions,
  onClose,
  onMove,
  onRead,
  onProgress,
  onFinish,
  onRate,
  onNotes,
  onMetadata,
  onCover,
  onEnrich,
  onCustomShelves,
  onTags,
  onRemove,
  onAttachEpub,
  onAttachAudiobook,
  epubBusy,
  epubImport,
  audiobookBusy,
  audiobookImport,
}: {
  ref?: Ref<DetailSheetHandle>
  book: LibraryBook
  libby?: ReactNode
  libbyLinked?: boolean
  customShelves: readonly CustomShelf[]
  customShelfIds: readonly string[]
  tags: readonly string[]
  tagSuggestions: readonly string[]
  onClose: () => void
  onMove: (shelf: ShelfId) => void
  onRead: (source?: 'ebook' | 'audio') => void
  onProgress: () => void
  onFinish: () => void
  onRate: (rating: number) => void
  onNotes: (notes: string) => void
  onMetadata: (changes: Partial<LibraryBook>) => void
  onCover: (thumbnail: string) => void
  onEnrich: () => Promise<boolean>
  onCustomShelves: (shelfIds: readonly string[]) => void
  onTags: (tags: readonly string[]) => void
  onRemove: () => void
  onAttachEpub: (files: readonly File[], overwriteCover: boolean) => void
  onAttachAudiobook: (files: readonly File[], overwriteCover: boolean) => void
  epubBusy: boolean
  epubImport: EpubAttachmentState
  audiobookBusy: boolean
  audiobookImport: AudiobookAttachmentState
}) {
  const draft = useRef<DetailDraft | null>(null)
  const registerDraft = useCallback((value: DetailDraft) => {
    draft.current = value
    return () => { if (draft.current === value) draft.current = null }
  }, [])
  const [pending, setPending] = useState<(() => void) | null>(null)
  const confirmation = useRef<HTMLDialogElement>(null)
  const requestLeave = (action: () => void) => {
    if (draft.current?.dirty) setPending(() => action)
    else action()
  }
  useImperativeHandle(ref, () => ({ requestLeave }))
  useLayoutEffect(() => {
    if (pending) confirmation.current?.showModal()
    else confirmation.current?.close()
  }, [pending])
  return (
    <Sheet title="Book details" onClose={() => requestLeave(onClose)} tall adaptiveDetail>
      <dialog ref={confirmation} className="detail-save-dialog" aria-labelledby="detail-save-title" onCancel={() => setPending(null)} onKeyDown={(event) => event.stopPropagation()}>
        <h3 id="detail-save-title">Save your changes?</h3>
        <p>Keep your edits before leaving this book.</p>
        <div>
          <button type="button" onClick={() => setPending(null)}>Cancel</button>
          <button type="button" onClick={() => { draft.current = null; setPending(null); pending?.() }}>Discard</button>
          <button type="button" onClick={() => { confirmation.current?.close(); const saved = draft.current?.save(); setPending(null); if (saved) { draft.current = null; pending?.() } }}>Save</button>
        </div>
      </dialog>
      <DetailDraftContext value={registerDraft}>
      <WorkDetailExperience
        key={book.id}
        book={book}
        libby={libby}
        libbyLinked={libbyLinked}
        customShelves={customShelves}
        customShelfIds={customShelfIds}
        tags={tags}
        tagSuggestions={tagSuggestions}
        onMove={onMove}
        onRead={(source) => requestLeave(() => onRead(source))}
        onProgress={onProgress}
        onFinish={onFinish}
        onRate={onRate}
        onNotes={onNotes}
        onMetadata={onMetadata}
        onCover={onCover}
        onEnrich={onEnrich}
        onCustomShelves={onCustomShelves}
        onTags={onTags}
        onRemove={onRemove}
        onAttachEpub={onAttachEpub}
        onAttachAudiobook={onAttachAudiobook}
        epubBusy={epubBusy}
        epubImport={epubImport}
        audiobookBusy={audiobookBusy}
        audiobookImport={audiobookImport}
      />
      </DetailDraftContext>
    </Sheet>
  )
}
