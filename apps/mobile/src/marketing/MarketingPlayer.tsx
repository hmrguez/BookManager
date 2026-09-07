import { Sheet } from '../app/components/Sheet'
import type { LibraryBook } from '../library-model'
import { AudiobookPlayer, type AudiobookPlayerPreview } from '../playback/AudiobookPlayer'
import { DEFAULT_AUDIOBOOK_CONTROL_PREFERENCES } from '../playback/controls'
import { playbackSnapshotSchema } from '../playback/model'
import cover from './pride-and-prejudice.svg'

const book: LibraryBook = {
  id: 'marketing-pride-and-prejudice', title: 'Pride and Prejudice', authors: ['Jane Austen'],
  thumbnail: cover, format: 'Audiobook', pageCount: 432, currentPage: 186,
  shelf: 'reading', progress: 43, rating: 0, notes: '',
  addedAt: '2026-09-01T09:00:00Z', lastUpdatedAt: '2026-09-07T18:00:00Z',
}
const durationMs = 45_960_000
const chapters = Array.from({ length: 61 }, (_, index) => ({
  key: `chapter-${index + 1}`, title: `Chapter ${index + 1} of 61`, segmentId: 'book',
  absoluteStartMs: Math.round(index * durationMs / 61),
  absoluteEndMs: Math.round((index + 1) * durationMs / 61), provenance: 'embedded' as const,
}))
const preview: AudiobookPlayerPreview = {
  context: { bookId: book.id, editionId: 'demo', assetId: 'demo', queueId: 'demo',
    title: book.title, authors: book.authors, narrators: [], chapters, durationMs },
  preferences: { global: DEFAULT_AUDIOBOOK_CONTROL_PREFERENCES,
    book: { version: 1, rate: 1.25 }, effective: { ...DEFAULT_AUDIOBOOK_CONTROL_PREFERENCES, rate: 1.25 } },
  snapshot: playbackSnapshotSchema.parse({
    bridgeVersion: 1, engineEpoch: 'marketing', queueId: 'demo', playbackSessionId: 'demo',
    revision: 1, state: 'playing', suppressionReason: 'none', playIntent: true,
    segmentId: 'book', chapterId: 'chapter-27', absolutePositionMs: 19_763_000,
    segmentPositionMs: 19_763_000, durationMs, bufferedPositionMs: durationMs,
    activeDurationMs: 1_248_000, rate: 1.25, sleepTimer: null,
    route: { kind: 'bluetooth', name: 'Headphones', external: true },
    capabilities: { bridgeVersion: 1, engine: 'android-media3', backgroundPlayback: true,
      systemControls: true, processRestoration: true, systemLibrary: false,
      airPlay: false, cast: false, routeSelection: true, sleepTimer: true,
      seek: true, supportedMediaTypes: ['audio/mp4'], minimumRate: 0.5, maximumRate: 3 },
    lastCommandId: null, error: null, observedAt: '2026-09-07T18:00:00Z',
  }),
}

// Development-only, static marketing fixture. No recording or user storage is loaded.
export function MarketingPlayer() {
  return <Sheet title="Audiobook player" onClose={() => undefined} tall>
    <AudiobookPlayer book={book} preview={preview} />
  </Sheet>
}
