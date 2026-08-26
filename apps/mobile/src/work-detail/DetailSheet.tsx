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
  onProgress,
  onFinish,
  onRate,
  onNotes,
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
  onProgress: () => void
  onFinish: () => void
  onRate: (rating: number) => void
  onNotes: (notes: string) => void
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
        onProgress={onProgress}
        onFinish={onFinish}
        onRate={onRate}
        onNotes={onNotes}
        onCustomShelves={onCustomShelves}
        onTags={onTags}
        onRemove={onRemove}
      />
    </Sheet>
  )
}
