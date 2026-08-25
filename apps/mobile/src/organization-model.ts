import { z } from 'zod'

export const ORGANIZATION_POSITION_STEP = 1_024

export const customShelfSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  notes: z.string().max(1_000),
  pinned: z.boolean(),
  archived: z.boolean(),
  position: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const customShelfEntrySchema = z.object({
  id: z.string().min(1),
  shelfId: z.string().min(1),
  bookId: z.string().min(1),
  position: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const organizationTagSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  normalizedName: z.string().min(1).max(80),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const bookTagSchema = z.object({
  tagId: z.string().min(1),
  bookId: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
})

export const libraryOrganizationSchema = z.object({
  shelves: z.array(customShelfSchema),
  entries: z.array(customShelfEntrySchema),
  tags: z.array(organizationTagSchema),
  bookTags: z.array(bookTagSchema),
}).superRefine((organization, context) => {
  const shelfIds = uniqueIds(organization.shelves, 'shelf', context)
  const tagIds = uniqueIds(organization.tags, 'tag', context)
  uniqueIds(organization.entries, 'shelf entry', context)

  const memberships = new Set<string>()
  for (const [index, entry] of organization.entries.entries()) {
    if (!shelfIds.has(entry.shelfId)) {
      context.addIssue({
        code: 'custom',
        path: ['entries', index, 'shelfId'],
        message: `Unknown custom shelf ${entry.shelfId}`,
      })
    }
    const membership = `${entry.shelfId}\0${entry.bookId}`
    if (memberships.has(membership)) {
      context.addIssue({
        code: 'custom',
        path: ['entries', index],
        message: 'A book can appear only once on the same custom shelf',
      })
    }
    memberships.add(membership)
  }

  const taggedBooks = new Set<string>()
  for (const [index, bookTag] of organization.bookTags.entries()) {
    if (!tagIds.has(bookTag.tagId)) {
      context.addIssue({
        code: 'custom',
        path: ['bookTags', index, 'tagId'],
        message: `Unknown organization tag ${bookTag.tagId}`,
      })
    }
    const taggedBook = `${bookTag.tagId}\0${bookTag.bookId}`
    if (taggedBooks.has(taggedBook)) {
      context.addIssue({
        code: 'custom',
        path: ['bookTags', index],
        message: 'A tag can be attached to a book only once',
      })
    }
    taggedBooks.add(taggedBook)
  }
})

export type CustomShelf = z.infer<typeof customShelfSchema>
export type CustomShelfEntry = z.infer<typeof customShelfEntrySchema>
export type OrganizationTag = z.infer<typeof organizationTagSchema>
export type BookTag = z.infer<typeof bookTagSchema>
export type LibraryOrganization = z.infer<typeof libraryOrganizationSchema>

export const EMPTY_LIBRARY_ORGANIZATION: LibraryOrganization = {
  shelves: [],
  entries: [],
  tags: [],
  bookTags: [],
}

export function normalizeTagName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function orderedShelfEntries(
  organization: LibraryOrganization,
  shelfId: string,
): CustomShelfEntry[] {
  return organization.entries
    .filter((entry) => entry.shelfId === shelfId)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
}

export function tagsForBook(
  organization: LibraryOrganization,
  bookId: string,
): OrganizationTag[] {
  const tagIds = new Set(
    organization.bookTags.filter((bookTag) => bookTag.bookId === bookId).map(({ tagId }) => tagId),
  )
  return organization.tags
    .filter(({ id }) => tagIds.has(id))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function uniqueIds(
  values: readonly { readonly id: string }[],
  label: string,
  context: z.RefinementCtx,
): Set<string> {
  const ids = new Set<string>()
  for (const [index, value] of values.entries()) {
    if (ids.has(value.id)) {
      context.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: `Duplicate ${label} ID ${value.id}`,
      })
    }
    ids.add(value.id)
  }
  return ids
}
