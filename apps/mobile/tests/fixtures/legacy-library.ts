export const currentLegacyLibrary = JSON.stringify(
  [
    {
      id: 'google-books:legacy-left-hand',
      title: 'The Left Hand of Darkness',
      authors: ['Ursula K. Le Guin'],
      thumbnail: 'https://books.example.test/left-hand.jpg',
      pageCount: 304,
      shelf: 'reading',
      progress: 42,
      currentPage: 128,
      rating: 4,
      notes: 'Migrated note with private reading context.',
      addedAt: '2026-08-01T10:00:00.000Z',
      startedAt: '2026-08-03T10:00:00.000Z',
      lastUpdatedAt: '2026-08-20T10:00:00.000Z',
    },
    {
      id: 'starter-piranesi',
      title: 'Piranesi',
      authors: ['Susanna Clarke'],
      pageCount: 272,
      shelf: 'finished',
      progress: 100,
      currentPage: 272,
      rating: 5,
      notes: '',
      addedAt: '2026-08-02T10:00:00.000Z',
      finishedAt: '2026-08-10T10:00:00.000Z',
      lastUpdatedAt: '2026-08-10T10:00:00.000Z',
    },
  ],
  null,
  2,
)

export const missingFieldsLegacyLibrary = JSON.stringify(
  [
    {
      id: 'legacy-missing-fields',
      title: 'A minimally recoverable book',
      pageCount: 200,
      currentPage: 50,
      addedAt: '2026-07-01T09:00:00.000Z',
    },
  ],
  null,
  2,
)

export const malformedLegacyLibrary = JSON.stringify(
  [
    {
      id: 'legacy-malformed',
      title: 'Unsafe progress',
      progress: 140,
    },
  ],
  null,
  2,
)

export const futureFieldsLegacyLibrary = JSON.stringify(
  [
    {
      id: 'legacy-future-fields',
      title: 'A book from a future client',
      authors: [],
      pageCount: 0,
      shelf: 'next',
      progress: 0,
      currentPage: 0,
      rating: 0,
      notes: '',
      addedAt: '2026-07-02T09:00:00.000Z',
      lastUpdatedAt: '2026-07-03T09:00:00.000Z',
      futureReadingMood: {
        value: 'contemplative',
        confidence: 0.8,
      },
    },
  ],
  null,
  2,
)
