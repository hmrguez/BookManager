import type { LibraryBook, ShelfId } from '../library'
import type { CustomShelf } from '../organization-model'
import { Sheet } from '../app/components/Sheet'
import { WorkDetailExperience } from './WorkDetailExperience'

export function DetailSheet({
  book,
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
  onEnrich,
  onCustomShelves,
  onTags,
  onRemove,
}: {
  book: LibraryBook
  customShelves: readonly CustomShelf[]
  customShelfIds: readonly string[]
  tags: readonly string[]
  tagSuggestions: readonly string[]
  onClose: () => void
  onMove: (shelf: ShelfId) => void
  onRead: () => void
  onProgress: () => void
  onFinish: () => void
  onRate: (rating: number) => void
  onNotes: (notes: string) => void
  onMetadata: (changes: Partial<LibraryBook>) => void
  onEnrich: () => Promise<boolean>
  onCustomShelves: (shelfIds: readonly string[]) => void
  onTags: (tags: readonly string[]) => void
  onRemove: () => void
}) {
  return (
    <Sheet title="Book details" onClose={onClose} tall>
      <WorkDetailExperience
        key={book.id}
        book={book}
        customShelves={customShelves}
        customShelfIds={customShelfIds}
        tags={tags}
        tagSuggestions={tagSuggestions}
        onMove={onMove}
        onRead={onRead}
        onProgress={onProgress}
        onFinish={onFinish}
        onRate={onRate}
        onNotes={onNotes}
        onMetadata={onMetadata}
        onEnrich={onEnrich}
        onCustomShelves={onCustomShelves}
        onTags={onTags}
        onRemove={onRemove}
      />
    </Sheet>
  )
}
