import { MemoryOriginalFiles } from './fixtures/original-files'
import { seedLibrary } from './fixtures/library'
import { describe, expect, test } from 'bun:test'
import {
  AudiobookImportError,
  AudiobookImportService,
  CapacitorManagedAudiobookStore,
  MemoryManagedAudiobookStore,
  defaultAudiobookReview,
  inspectAudiobook,
  normalizeAudiobookReview,
  type AudiobookImportSource,
} from '../src/audiobooks'
import {
  assetIdSchema,
  editionIdSchema,
  progressSnapshotIdSchema,
  readingDeviceIdSchema,
  readingEventIdSchema,
  readingEventSchema,
  progressSnapshotSchema,
} from '../src/domain/catalog'
import { CatalogRepository, ReadingLedgerRepository } from '../src/storage/catalog-repository'
import { migrateStorage } from '../src/storage/migrations'
import { readLibraryBooks, writeLibraryBook } from '../src/storage/library-repository'
import { PortableArchiveService } from '../src/storage/portable-archive'
import { BunSqliteDatabase } from './storage-test-database'
import { AudiobookTestFilesystem } from './fixtures/audiobook-filesystem'
import { AudiobookPlaybackRepository } from '../src/playback/repository'
import { AudiobookProgressRepository } from '../src/playback/progress'
import { audiobookSourceFromOriginal } from '../src/audiobooks/original-source'

describe('audiobook inspection and normalization', () => {
  test('uses track evidence to make one deterministic absolute MP3 timeline', async () => {
    const sources = [
      mp3Source('ending.mp3', { title: 'Part two', album: 'The Ordered Book', track: 2, frames: 60 }),
      mp3Source('opening.mp3', { title: 'Part one', album: 'The Ordered Book', track: 1, frames: 40, cover: true }),
    ]
    const draft = await inspectAudiobook(sources)
    const orderedNames = draft.suggestedOrder.map((id) => draft.segments.find((segment) => segment.id === id)?.fileName)

    expect(orderedNames).toEqual(['opening.mp3', 'ending.mp3'])
    expect(draft.metadata).toMatchObject({
      title: 'The Ordered Book',
      authors: ['Ada Author'],
      narrators: ['Noah Narrator'],
      series: 'Listening Shelf',
    })
    expect(draft.requiresOrderReview).toBe(false)
    expect(draft.cover).toMatchObject({ mediaType: 'image/jpeg', provenance: 'embedded' })

    const normalized = await normalizeAudiobookReview(draft, defaultAudiobookReview(draft))
    expect(normalized.segments.map(({ fileName, absoluteStartMs }) => ({ fileName, absoluteStartMs }))).toEqual([
      { fileName: 'opening.mp3', absoluteStartMs: 0 },
      { fileName: 'ending.mp3', absoluteStartMs: normalized.segments[0]?.durationMs },
    ])
    expect(normalized.chapters.map(({ title }) => title)).toEqual(['Opening', 'Part two'])
    expect(normalized.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  test('requires explicit review when missing tags cannot prove MP3 order', async () => {
    const draft = await inspectAudiobook([
      mp3Source('alpha.mp3', { title: 'Alpha', album: '', track: undefined }),
      mp3Source('finale.mp3', { title: 'Finale', album: '', track: undefined }),
    ])
    const review = defaultAudiobookReview(draft)

    expect(draft.requiresOrderReview).toBe(true)
    expect(draft.issues.map(({ code }) => code)).toContain('ambiguous-order')
    await expect(normalizeAudiobookReview(draft, review)).rejects.toMatchObject({ code: 'review-required' })

    const normalized = await normalizeAudiobookReview(draft, {
      ...review,
      title: 'Reviewed by a person',
      segmentIds: [...review.segmentIds].reverse(),
      orderConfirmed: true,
    })
    expect(normalized.segments.map(({ fileName }) => fileName)).toEqual(['finale.mp3', 'alpha.mp3'])
  })

  test.each(['image/jpg', 'image/png', 'image/unknown'])('recognizes JPEG cover bytes despite the embedded %s label', async (coverMediaType) => {
    const draft = await inspectAudiobook([mp3Source('cover.mp3', { cover: true, coverMediaType })])
    expect(draft.cover?.mediaType).toBe('image/jpeg')
  })

  test('reads M4B metadata, cover, duration, and embedded chapters from container atoms', async () => {
    const draft = await inspectAudiobook([m4bSource('one-book.m4b', { durationMs: 7_200_000, cover: true })])

    expect(draft.metadata).toMatchObject({
      title: 'One M4B Book',
      authors: ['Mara Writer'],
      narrators: ['Nico Voice'],
      series: 'Atom Stories',
    })
    expect(draft.totalDurationMs).toBe(7_200_000)
    expect(draft.chapters.map(({ title, positionMs }) => ({ title, positionMs }))).toEqual([
      { title: 'First leaf', positionMs: 0 },
      { title: 'Second leaf', positionMs: 3_600_000 },
    ])
    expect(draft.cover?.mediaType).toBe('image/png')
  })

  test('uses CUE chapters and explicit sidecar metadata for a poorly tagged folder', async () => {
    const sources: AudiobookImportSource[] = [
      mp3Source('disc/01.mp3', { title: '', album: '', author: '', narrator: '', track: undefined, frames: 80 }),
      mp3Source('disc/02.mp3', { title: '', album: '', author: '', narrator: '', track: undefined, frames: 80 }),
      textSource('disc/audiobook.json', JSON.stringify({
        title: 'Sidecar Book',
        authors: ['Cy Writer'],
        narrators: ['Rin Voice'],
        series: 'Sidecar Shelf',
      })),
      textSource('disc/book.cue', `FILE "01.mp3" MP3\n  TRACK 01 AUDIO\n    TITLE "Dawn"\n    INDEX 01 00:00:00\nFILE "02.mp3" MP3\n  TRACK 02 AUDIO\n    TITLE "Dusk"\n    INDEX 01 00:00:00`),
      imageSource('disc/cover.jpg'),
    ]
    const draft = await inspectAudiobook(sources)

    expect(draft.metadata).toMatchObject({ title: 'Sidecar Book', authors: ['Cy Writer'], narrators: ['Rin Voice'] })
    expect(draft.chapters.map(({ title }) => title)).toEqual(['Dawn', 'Dusk'])
    expect(draft.cover?.provenance).toBe('sidecar')
  })

  test('rejects protected M4B clearly without circumvention guidance', async () => {
    try {
      await inspectAudiobook([m4bSource('protected.m4b', { protected: true })])
      throw new Error('Expected protected audio to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(AudiobookImportError)
      expect(error).toMatchObject({ code: 'drm-protected' })
      expect((error as Error).message).toContain('does not offer circumvention')
    }
  })

  test('does not mistake marker bytes in audio or padding for M4B encryption', async () => {
    const source = m4bSource('unprotected.m4b')
    const bytes = concat(source.bytes, atom('free', fourCc('fair')), atom('mdat',
      fourCc('sinf'), fourCc('enca'), fourCc('drms'), fourCc('fair'),
    ))
    const draft = await inspectAudiobook([{ ...source, bytes }])
    expect(draft.totalDurationMs).toBe(3_600_000)
  })

  test('requires an AAC sample description rather than marker bytes in audio', async () => {
    const source = m4bSource('unsupported.m4b', { sampleFormat: 'alac' })
    const bytes = concat(source.bytes, atom('mdat', fourCc('mp4a')))
    await expect(inspectAudiobook([{ ...source, bytes }])).rejects.toMatchObject({ code: 'unsupported-format' })
  })

  test.each(['enca', 'drms'])('rejects the protected %s audio sample entry', async (sampleFormat) => {
    await expect(inspectAudiobook([m4bSource('protected.m4b', { sampleFormat })]))
      .rejects.toMatchObject({ code: 'drm-protected' })
  })
})

describe('managed audiobook import', () => {

  test('recognizes reopened audio by its bytes without replacing reviewed metadata or importing again', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const managedStore = new MemoryManagedAudiobookStore()
    const service = new AudiobookImportService(database, { managedStore })
    const sources = [mp3Source('original.mp3', { album: 'Embedded title' })]
    const draft = await service.prepare(sources)
    expect(await service.findImported(draft)).toBeUndefined()
    const imported = await service.import(sources, {
      ...defaultAudiobookReview(draft),
      title: 'My reviewed title',
    })
    const fileCount = managedStore.files.size
    const reopened = await service.prepare([{ ...sources[0]!, name: 'renamed.mp3', relativePath: 'renamed.mp3' }])
    expect(await service.findImported(reopened)).toMatchObject({
      outcome: 'duplicate', bookId: imported.bookId, assetId: imported.assetId, title: 'My reviewed title',
    })
    expect(await database.query('SELECT id FROM audiobook_imports')).toHaveLength(1)
    expect(managedStore.files.size).toBe(fileCount)
    const changed = await service.prepare([mp3Source('original.mp3', { album: 'Embedded title', frames: 100 })])
    expect(await service.findImported(changed)).toBeUndefined()
    await database.close()
  })

  test('catalogs chunked MP3 files and covers with the original playback capabilities and fingerprints', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const filesystem = new AudiobookTestFilesystem()
    const service = new AudiobookImportService(database, {
      managedStore: new CapacitorManagedAudiobookStore({ filesystem, platform: 'android' }),
    })
    const sources = [
      mp3Source('01.mp3', { track: 1, frames: 6_000, cover: true, coverMediaType: 'image/jpg' }),
      mp3Source('02.mp3', { track: 2, frames: 6_000 }),
    ]
    const draft = await service.prepare(sources)
    const result = await service.import(sources, defaultAudiobookReview(draft))
    const files = await database.query<{
      relative_path: string; capability_id: string; fingerprint: string; byte_size: number
    }>('SELECT relative_path, capability_id, fingerprint, byte_size FROM audiobook_files ORDER BY position')

    expect(files).toHaveLength(2)
    for (const [index, file] of files.entries()) {
      expect(filesystem.bytes(file.relative_path)).toEqual(sources[index]!.bytes)
      expect(file.byte_size).toBe(sources[index]!.bytes.length)
      expect(result.manifest.segments[index]).toMatchObject({
        playableCapability: file.capability_id,
        fingerprint: file.fingerprint,
        durationMs: draft.segments[index]!.durationMs,
      })
    }
    expect([...filesystem.files.keys()].filter((path) => path.startsWith('assets/covers/'))).toHaveLength(1)
    expect(result.manifest.chapters.map(({ title }) => title)).toEqual(['Opening', 'Part one'])
    expect(draft.cover?.mediaType).toBe('image/jpeg')
    const playback = new AudiobookPlaybackRepository(database, { filesystem })
    const queue = await playback.queueForBook(result.bookId)
    expect(queue?.manifest).toMatchObject({ assetId: result.assetId, chapters: result.manifest.chapters })
    expect(queue?.sources.map(({ byteSize }) => byteSize)).toEqual(sources.map(({ bytes }) => bytes.length))
    expect(queue?.artwork?.mediaType).toBe('image/jpeg')

    // Earlier imports retained the nonstandard ID3 MIME type. They must also play
    // without forcing the reader to re-import the original large audio file.
    await database.run("UPDATE assets SET payload_json = json_set(payload_json, '$.mediaType', ?) WHERE role = 'cover'", ['image/jpg'])
    expect((await playback.queueForBook(result.bookId))?.artwork?.mediaType).toBe('image/jpeg')
    await database.run("UPDATE assets SET payload_json = json_set(payload_json, '$.mediaType', ?) WHERE role = 'cover'", ['image/unsupported'])
    const withoutArtwork = await playback.queueForBook(result.bookId)
    expect(withoutArtwork?.artwork).toBeUndefined()
    expect(withoutArtwork?.sources).toEqual(queue?.sources)
    expect(await service.import(sources, defaultAudiobookReview(draft))).toMatchObject({ outcome: 'duplicate', assetId: result.assetId })
    await database.close()
  })

  test.each([
    { existing: undefined, overwrite: false, cover: true },
    { existing: 'data:image/png;base64,bWFudWFs', overwrite: false, cover: true },
    { existing: 'data:image/png;base64,bWFudWFs', overwrite: true, cover: true },
    { existing: 'data:image/png;base64,bWFudWFs', overwrite: true, cover: false },
  ])('applies attachment cover policy %j and supports reattachment', async ({ existing, overwrite, cover }) => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await writeLibraryBook(database, {
      id: 'cover-book', title: 'Chosen title', authors: ['Chosen author'],
      pageCount: 100, shelf: 'next', progress: 0, currentPage: 0,
      rating: 0, notes: '', thumbnail: existing,
      addedAt: '2026-08-01T12:00:00.000Z', lastUpdatedAt: '2026-08-01T12:00:00.000Z',
    })
    const service = new AudiobookImportService(database, {
      managedStore: new MemoryManagedAudiobookStore(),
      createId: sequentialIds(),
      createCapabilityId: sequentialCapabilities(),
    })
    const sources = [mp3Source('cover.mp3', { album: 'Cover book', cover })]
    const draft = await service.prepare(sources)
    const importFile = () => service.import(sources, defaultAudiobookReview(draft), {
      targetBookId: 'cover-book', overwriteCover: overwrite,
    })
    await importFile()
    const [book] = await readLibraryBooks(database)
    expect(book?.title).toBe('Chosen title')
    if (cover && (!existing || overwrite)) {
      expect(book?.thumbnail).toStartWith('data:image/jpeg;base64,')
      expect(book?.thumbnail).not.toBe(existing)
    } else {
      expect(book?.thumbnail).toBe(existing)
    }
    // Simulate an older import whose cover was never applied, then attach the same file again.
    await writeLibraryBook(database, { ...book!, thumbnail: existing })
    expect((await importFile()).outcome).toBe('duplicate')
    const books = await readLibraryBooks(database)
    expect(books).toHaveLength(1)
    expect(books[0]?.thumbnail).toBe(book?.thumbnail)
    await database.close()
  })
  test('attaches selected audio files to the existing library book', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await writeLibraryBook(database, {
      id: 'selected-audio-book',
      title: 'The Book I Selected',
      authors: ['Known Author'],
      pageCount: 0,
      shelf: 'next',
      progress: 0,
      currentPage: 0,
      rating: 0,
      notes: '',
      addedAt: '2026-08-01T12:00:00.000Z',
      lastUpdatedAt: '2026-08-01T12:00:00.000Z',
    })
    const service = new AudiobookImportService(database, {
      managedStore: new MemoryManagedAudiobookStore(),
      createId: sequentialIds(),
      createCapabilityId: sequentialCapabilities(),
    })
    const sources = [mp3Source('selected.mp3', { album: 'Unhelpful File Title' })]
    const draft = await service.prepare(sources)

    const result = await service.import(sources, {
      ...defaultAudiobookReview(draft),
      title: 'The Book I Selected',
      authors: ['Known Author'],
    }, { targetBookId: 'selected-audio-book' })

    expect(result.bookId).toBe('selected-audio-book')
    const rows = await database.query<{ readonly payload_json: string }>('SELECT payload_json FROM library_books')
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0]!.payload_json)).toMatchObject({
      id: 'selected-audio-book',
      title: 'The Book I Selected',
      shelf: 'next',
      format: 'Audiobook',
    })
    await database.close()
  })

  test('treats reviewed metadata changes as revisions of the same audio set', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const managedStore = new MemoryManagedAudiobookStore()
    const service = new AudiobookImportService(database, {
      managedStore,
      createId: sequentialIds(),
      createCapabilityId: sequentialCapabilities(),
    })
    const sources = [mp3Source('Unhelpful name.mp3', { album: 'Original tag', cover: true })]
    const draft = await service.prepare(sources)
    const original = await service.import(sources, defaultAudiobookReview(draft))
    const revised = await service.import(sources, {
      ...defaultAudiobookReview(draft),
      title: 'Corrected audiobook title',
    })

    expect(revised).toMatchObject({ outcome: 'revision', editionId: original.editionId, bookId: original.bookId })
    expect(revised.assetId).not.toBe(original.assetId)
    expect(await service.findImported(draft)).toMatchObject({
      assetId: revised.assetId, title: 'Corrected audiobook title', outcome: 'duplicate',
    })
    expect(managedStore.files.size).toBe(2)
    const catalog = await new CatalogRepository(database).read()
    expect(catalog.works[0]?.title.value).toBe('Corrected audiobook title')
    expect(catalog.assets.filter(({ role }) => role === 'cover')).toHaveLength(1)
    const [book] = await database.query<{ readonly payload_json: string }>('SELECT payload_json FROM library_books')
    expect(JSON.parse(book?.payload_json ?? '{}').title).toBe('Corrected audiobook title')
    await database.close()
  })

  test('deduplicates exact content and attaches a revision to the same Edition and progress', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const managedStore = new MemoryManagedAudiobookStore()
    const service = new AudiobookImportService(database, {
      managedStore,
      now: () => new Date('2026-08-27T14:00:00.000Z'),
      createId: sequentialIds(),
      createCapabilityId: sequentialCapabilities(),
    })
    const originalSources = [mp3Source('Book 01.mp3', { album: 'A Durable Listen', frames: 80 })]
    const originalDraft = await service.prepare(originalSources)
    const original = await service.import(originalSources, defaultAudiobookReview(originalDraft))
    const duplicate = await service.import(originalSources, defaultAudiobookReview(originalDraft))

    const event = readingEventSchema.parse({
      id: readingEventIdSchema.parse('reading-event:audiobook:position'),
      editionId: editionIdSchema.parse(original.editionId),
      assetId: assetIdSchema.parse(original.assetId),
      kind: 'location',
      source: { kind: 'local', method: 'audio-player' },
      deviceId: readingDeviceIdSchema.parse('reading-device:audiobook:test'),
      observedAt: '2026-08-27T14:05:00.000Z',
      effectiveAt: '2026-08-27T14:05:00.000Z',
      recordedAt: '2026-08-27T14:05:00.000Z',
      timeConfidence: 1,
      position: {
        locator: { kind: 'audio-time', positionMs: 500 },
        normalizedProgress: 500 / original.manifest.segments[0]!.durationMs,
        normalization: { kind: 'edition-duration', durationMs: original.manifest.segments[0]!.durationMs, confidence: 1 },
      },
    })
    const snapshot = progressSnapshotSchema.parse({
      id: progressSnapshotIdSchema.parse('progress:audiobook:position'),
      editionId: editionIdSchema.parse(original.editionId),
      assetId: assetIdSchema.parse(original.assetId),
      status: 'reading',
      position: event.position,
      normalizedProgress: event.position.normalizedProgress,
      sourceEventId: event.id,
      projectedAt: '2026-08-27T14:05:00.000Z',
    })
    await new ReadingLedgerRepository(database).append({ events: [event], snapshots: [snapshot] })

    const revisedSources = [mp3Source('Book 01.mp3', { album: 'A Durable Listen', frames: 100 })]
    const revisedDraft = await service.prepare(revisedSources)
    const revised = await service.import(revisedSources, defaultAudiobookReview(revisedDraft))

    expect(duplicate).toMatchObject({ outcome: 'duplicate', assetId: original.assetId })
    expect(Object.isFrozen(original.manifest)).toBe(true)
    expect(Object.isFrozen(original.manifest.segments)).toBe(true)
    expect(Object.isFrozen(original.manifest.displayMetadata.authors)).toBe(true)
    expect(revised).toMatchObject({ outcome: 'revision', editionId: original.editionId, bookId: original.bookId })
    expect(revised.assetId).not.toBe(original.assetId)
    expect(revised.manifest.initialAbsolutePositionMs).toBe(500)
    expect(revised.manifest.segments[0]?.playableCapability).toMatch(/^capability:test:/)
    expect(JSON.stringify(revised.manifest)).not.toContain('assets/audiobooks/')

    const catalog = await new CatalogRepository(database).read()
    expect(catalog.works).toHaveLength(1)
    expect(catalog.editions).toHaveLength(1)
    expect(catalog.assets.filter(({ role }) => role === 'content')).toHaveLength(2)
    expect(catalog.assets.filter(({ role }) => role === 'content').every(({ location }) => location.kind === 'managed-bundle')).toBe(true)
    expect((await new ReadingLedgerRepository(database).read()).events).toContainEqual(event)
    const archive = await new PortableArchiveService(database).create()
    expect(archive.archive).not.toContain('assets/audiobooks/')
    expect(archive.archive).toContain('sha256:')
    await database.close()
  })

  test('rolls back newly managed audio when the catalog transaction is interrupted', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await database.execute(`
      CREATE TRIGGER interrupt_audiobook_commit
      BEFORE INSERT ON audiobook_imports
      BEGIN
        SELECT RAISE(ABORT, 'simulated audiobook catalog interruption');
      END;
    `)
    const managedStore = new MemoryManagedAudiobookStore()
    const service = new AudiobookImportService(database, {
      managedStore,
      createId: sequentialIds(),
      createCapabilityId: sequentialCapabilities(),
    })
    const sources = [mp3Source('Interrupted 01.mp3', { album: 'Interrupted Book' })]
    const draft = await service.prepare(sources)

    await expect(service.import(sources, defaultAudiobookReview(draft))).rejects.toMatchObject({ code: 'storage-failed' })
    expect(managedStore.files.size).toBe(0)
    expect(await database.query('SELECT id FROM audiobook_imports')).toHaveLength(0)
    expect(await database.query('SELECT id FROM assets')).toHaveLength(0)
    await database.close()
  })
})

type Mp3Options = {
  readonly title?: string
  readonly album?: string
  readonly author?: string
  readonly narrator?: string
  readonly series?: string
  readonly track?: number
  readonly frames?: number
  readonly cover?: boolean
  readonly coverMediaType?: string
}

function mp3Source(path: string, options: Mp3Options = {}): AudiobookImportSource {
  const frames: Uint8Array[] = []
  const addText = (id: string, value: string | undefined) => {
    if (value !== undefined) frames.push(id3Frame(id, Uint8Array.from([3, ...new TextEncoder().encode(value)])))
  }
  addText('TIT2', options.title ?? 'Part one')
  addText('TALB', options.album ?? 'Fixture Audiobook')
  addText('TPE2', options.author ?? 'Ada Author')
  addText('TPE1', options.narrator ?? 'Noah Narrator')
  addText('TRCK', options.track === undefined ? undefined : String(options.track))
  if (options.series !== '') frames.push(userTextFrame('SERIES', options.series ?? 'Listening Shelf'))
  if (options.cover) {
    frames.push(id3Frame('APIC', concat(
      Uint8Array.from([3]),
      new TextEncoder().encode(options.coverMediaType ?? 'image/jpeg'),
      Uint8Array.from([0, 3, 0, 0xff, 0xd8, 0xff, 0xd9]),
    )))
    frames.push(chapterFrame('Opening', 0, 500))
  }
  const tagBody = concat(...frames)
  const header = concat(
    new TextEncoder().encode('ID3'),
    Uint8Array.from([3, 0, 0]),
    synchsafe(tagBody.byteLength),
  )
  const audioFrame = new Uint8Array(417)
  audioFrame.set([0xff, 0xfb, 0x90, 0x00])
  const audio = concat(...Array.from({ length: options.frames ?? 50 }, () => audioFrame))
  const name = path.split('/').at(-1) ?? path
  return { name, relativePath: path, mediaType: 'audio/mpeg', bytes: concat(header, tagBody, audio) }
}

function id3Frame(id: string, data: Uint8Array): Uint8Array {
  const size = new Uint8Array(4)
  new DataView(size.buffer).setUint32(0, data.byteLength, false)
  return concat(new TextEncoder().encode(id), size, Uint8Array.from([0, 0]), data)
}

function userTextFrame(description: string, value: string): Uint8Array {
  return id3Frame('TXXX', concat(
    Uint8Array.from([3]),
    new TextEncoder().encode(description),
    Uint8Array.from([0]),
    new TextEncoder().encode(value),
  ))
}

function chapterFrame(title: string, startMs: number, endMs: number): Uint8Array {
  const times = new Uint8Array(16)
  const view = new DataView(times.buffer)
  view.setUint32(0, startMs, false)
  view.setUint32(4, endMs, false)
  view.setUint32(8, 0xffffffff, false)
  view.setUint32(12, 0xffffffff, false)
  return id3Frame('CHAP', concat(
    new TextEncoder().encode('chapter-1'),
    Uint8Array.from([0]),
    times,
    id3Frame('TIT2', Uint8Array.from([3, ...new TextEncoder().encode(title)])),
  ))
}

function synchsafe(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f,
  ])
}

function m4bSource(
  name: string,
  options: { readonly durationMs?: number; readonly cover?: boolean; readonly protected?: boolean; readonly sampleFormat?: string } = {},
): AudiobookImportSource {
  const durationMs = options.durationMs ?? 3_600_000
  const ftyp = atom('ftyp', fourCc('M4B '), uint32Bytes(0), fourCc('M4B '), fourCc('isom'))
  const mvhdBody = new Uint8Array(100)
  const mvhdView = new DataView(mvhdBody.buffer)
  mvhdView.setUint32(12, 1000, false)
  mvhdView.setUint32(16, durationMs, false)
  const metadata = atom('meta', Uint8Array.from([0, 0, 0, 0]), atom('ilst',
    metadataItem('©nam', new TextEncoder().encode('One M4B Book')),
    metadataItem('©wrt', new TextEncoder().encode('Mara Writer')),
    metadataItem('©ART', new TextEncoder().encode('Nico Voice')),
    metadataItem('©grp', new TextEncoder().encode('Atom Stories')),
    ...(options.cover ? [metadataItem('covr', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))] : []),
  ))
  const chpl = atom('chpl', chapterList([
    { title: 'First leaf', startMs: 0 },
    { title: 'Second leaf', startMs: Math.min(3_600_000, Math.floor(durationMs / 2)) },
  ]))
  const sample = atom(options.sampleFormat ?? 'mp4a', new Uint8Array(28),
    ...(options.protected ? [atom('sinf', atom('frma', fourCc('mp4a')))] : []),
  )
  const track = atom('trak', atom('mdia', atom('minf', atom('stbl',
    atom('stsd', new Uint8Array(4), uint32Bytes(1), sample),
  ))))
  const moov = atom('moov', atom('mvhd', mvhdBody), atom('udta', metadata, chpl), track)
  return { name, relativePath: name, mediaType: 'audio/mp4', bytes: concat(ftyp, moov) }
}

function metadataItem(type: string, value: Uint8Array): Uint8Array {
  return atom(type, atom('data', new Uint8Array(8), value))
}

function chapterList(chapters: readonly { readonly title: string; readonly startMs: number }[]): Uint8Array {
  return concat(
    new Uint8Array(4),
    Uint8Array.from([chapters.length]),
    ...chapters.map(({ title, startMs }) => {
      const titleBytes = new TextEncoder().encode(title)
      const time = new Uint8Array(8)
      new DataView(time.buffer).setBigUint64(0, BigInt(startMs * 10_000), false)
      return concat(time, Uint8Array.from([titleBytes.byteLength]), titleBytes)
    }),
  )
}

function atom(type: string, ...parts: readonly Uint8Array[]): Uint8Array {
  const body = concat(...parts)
  return concat(uint32Bytes(body.byteLength + 8), fourCc(type), body)
}

function fourCc(value: string): Uint8Array {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0) & 0xff))
}

function uint32Bytes(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function textSource(path: string, value: string): AudiobookImportSource {
  return {
    name: path.split('/').at(-1) ?? path,
    relativePath: path,
    mediaType: path.endsWith('.cue') ? 'application/x-cue' : 'application/json',
    bytes: new TextEncoder().encode(value),
  }
}

function imageSource(path: string): AudiobookImportSource {
  return {
    name: path.split('/').at(-1) ?? path,
    relativePath: path,
    mediaType: 'image/jpeg',
    bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
  }
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function sequentialIds(): (prefix: string) => string {
  let next = 0
  return (prefix) => `${prefix}:test:${++next}`
}

function sequentialCapabilities(): () => string {
  let next = 0
  return () => `capability:test:${++next}`
}

test('audiobook imports and attachments work beyond 30 library entries', async () => {
  const database = new BunSqliteDatabase()
  await migrateStorage(database)
  const { library } = await seedLibrary(database)
  const managedStore = new MemoryManagedAudiobookStore()
  const service = new AudiobookImportService(database, { managedStore })
  const sources = [m4bSource('capacity.m4b', { durationMs: 7200000, cover: true })]
  const review = defaultAudiobookReview(await service.prepare(sources))
  await service.import(sources, review)
  expect(await library.list()).toHaveLength(31)
  expect(managedStore.files.size).toBeGreaterThan(0)
  expect((await new CatalogRepository(database).read()).works.length).toBeGreaterThan(0)
  await service.import(sources, review, { targetBookId: 'capacity-1' })
  expect(await library.list()).toHaveLength(31)
  expect(managedStore.files.size).toBeGreaterThan(0)
  await database.close()
})


describe('original audiobook files', () => {
  test('inspects an original M4B by range without reading its audio payload', async () => {
    const source = m4bSource('large.m4b', { cover: true })
    const ftypSize = new DataView(source.bytes.buffer).getUint32(0, false)
    const ftyp = source.bytes.slice(0, ftypSize)
    const moov = source.bytes.slice(ftypSize)
    const audioSize = 600_000_000
    const reference = { id: 'large-original', name: source.name, size: ftyp.length + audioSize + moov.length }
    const mdatHeader = concat(uint32Bytes(audioSize), fourCc('mdat'))
    const ranges: Array<{ offset: number; length: number }> = []
    const access = new MemoryOriginalFiles()
    access.read = async () => { throw new Error('Do not preload the original') }
    access.inspect = async () => ({ size: reference.size, fingerprint: 'a'.repeat(64) })
    access.readRange = async (_reference, offset, length) => {
      ranges.push({ offset, length })
      const bytes = new Uint8Array(length)
      for (const [start, part] of [[0, ftyp], [ftyp.length, mdatHeader], [ftyp.length + audioSize, moov]] as const) {
        const from = Math.max(offset, start)
        const to = Math.min(offset + length, start + part.length)
        if (to > from) bytes.set(part.subarray(from - start, to - start), from - offset)
      }
      return bytes
    }
    const original = await audiobookSourceFromOriginal(reference, source.name, source.mediaType, access)
    const draft = await inspectAudiobook([original])
    expect(original.bytes.length).toBe(0)
    expect(draft.segments[0]?.byteSize).toBe(reference.size)
    expect(draft.segments[0]?.fingerprint).toBe('a'.repeat(64))
    expect(draft.cover?.mediaType).toBe('image/png')
    expect(draft.totalDurationMs).toBe(3_600_000)
    expect(ranges.reduce((total, range) => total + range.length, 0)).toBeLessThan(4096)
    expect(ranges.some(({ offset }) => offset === ftyp.length + audioSize)).toBe(true)
    const opaque = await inspectAudiobook([{ ...original, name: 'provider-object', mediaType: 'application/octet-stream' }])
    expect(opaque.totalDurationMs).toBe(draft.totalDurationMs)
  })

  test('imports native MP3 metadata and duration without retaining audio bytes', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const access = new MemoryOriginalFiles()
    const input = access.link(mp3Source('original.mp3', { frames: 200 }))
    const original = await audiobookSourceFromOriginal(input.reference, input.relativePath, input.mediaType, access)
    const managedStore = new MemoryManagedAudiobookStore()
    const service = new AudiobookImportService(database, { originalFiles: access, managedStore })
    const draft = await service.prepare([original])
    const fullDraft = await inspectAudiobook([input])
    expect(draft).toEqual(fullDraft)
    expect(original.bytes.length).toBe(0)
    const result = await service.import([original], defaultAudiobookReview(draft))
    expect(result.manifest.segments[0]?.durationMs).toBe(fullDraft.totalDurationMs)
    expect(managedStore.files.size).toBe(0)
    await database.close()
  })

  test('reopens a completed audiobook after relinking without losing its end position', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const originals = new MemoryOriginalFiles()
    const service = new AudiobookImportService(database, { managedStore: new MemoryManagedAudiobookStore(), originalFiles: originals })
    const source = originals.link(mp3Source('completed.mp3', { frames: 200 }))
    const draft = await service.prepare([source])
    const result = await service.import([source], defaultAudiobookReview(draft))
    const segment = result.manifest.segments.at(-1)!
    const duration = segment.absoluteEndMs
    await new AudiobookProgressRepository(database).ingestJournal([{
      bridgeVersion: 1, id: 'playback-event:completed-original', sequence: 1, engineEpoch: 'engine:completed-original',
      queueId: result.manifest.queueId, playbackSessionId: 'session:completed-original', revision: 1, kind: 'end',
      observedAt: new Date().toISOString(), activeDurationMs: duration, beforePositionMs: 0, afterPositionMs: duration,
      rate: 1, reason: 'end-of-queue', confidence: 1, segmentId: segment.id, chapterId: null, error: null,
    }])
    originals.files.delete(source.reference.id)
    const replacement = originals.link(source, 'restored-completed-file')
    await service.relinkImported(result, [replacement], await service.prepare([replacement]))
    const queue = await new AudiobookPlaybackRepository(database, { originalFiles: originals }).queueForBook(result.bookId)
    expect(queue?.manifest.initialAbsolutePositionMs).toBe(duration)
    expect(queue?.sources[0]?.uri).toContain('restored-completed-file')
    expect(queue?.manifest.queueId).toBe(result.manifest.queueId)
    await database.close()
  })

  test('links every track, preserves capabilities when reselected, and reports a missing track', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const originals = new MemoryOriginalFiles()
    const managedStore = new MemoryManagedAudiobookStore()
    const service = new AudiobookImportService(database, { managedStore, originalFiles: originals })
    const sources = [originals.link(mp3Source('01.mp3', { track: 1, frames: 100 })),
      originals.link(mp3Source('02.mp3', { track: 2, frames: 200 }))]
    const draft = await service.prepare(sources)
    const result = await service.import(sources, defaultAudiobookReview(draft))
    expect(managedStore.files.size).toBe(0)
    expect((await new CatalogRepository(database).read()).assets.find(({ id }) => id === result.assetId)?.location.kind).toBe('linked-bundle')
    const rows = await database.query('SELECT capability_id, reference_id, relative_path FROM audiobook_files ORDER BY position')
    expect(rows.map(({ reference_id }) => reference_id)).toEqual(sources.map(({ reference }) => reference.id))
    expect(rows.every(({ relative_path }) => relative_path === '')).toBe(true)
    const playback = new AudiobookPlaybackRepository(database, { originalFiles: originals })
    const queue = await playback.queueForBook(result.bookId)
    expect(queue?.sources.every(({ uri }) => uri.startsWith('wovenleaf-file://'))).toBe(true)
    const changed = sources[0]!.bytes.slice()
    changed[changed.length - 1] ^= 1
    originals.files.set(sources[0]!.reference.id, changed)
    await expect(playback.queueForBook(result.bookId)).rejects.toThrow('This file has changed')
    originals.files.set(sources[0]!.reference.id, sources[0]!.bytes)
    originals.files.delete(sources[1]!.reference.id)
    await expect(playback.queueForBook(result.bookId)).rejects.toMatchObject({ code: 'relinkRequired' })
    const replacements = sources.map((source, index) => originals.link(source, `replacement:${index}`))
    await service.relinkImported(result, replacements, await service.prepare(replacements))
    const restored = await playback.queueForBook(result.bookId)
    expect(restored?.manifest).toEqual(queue?.manifest)
    expect(restored?.sources.map(({ capability }) => capability)).toEqual(queue?.sources.map(({ capability }) => capability))
    expect(restored?.sources[1]?.uri).toContain('replacement%3A1')
    expect(managedStore.files.size).toBe(0)
    await database.close()
  })

  test('rejects changed originals after order review and retains no content copies', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const originals = new MemoryOriginalFiles()
    const managedStore = new MemoryManagedAudiobookStore()
    const service = new AudiobookImportService(database, { managedStore, originalFiles: originals })
    const source = originals.link(m4bSource('changed.m4b', { durationMs: 60000 }))
    const review = defaultAudiobookReview(await service.prepare([source]))
    originals.files.set(source.reference.id, new Uint8Array(source.bytes.length))
    await expect(service.import([source], review)).rejects.toThrow('changed')
    expect((await new CatalogRepository(database).read()).assets).toHaveLength(0)
    expect(managedStore.files.size).toBe(0)
    await database.close()
  })

  test('migrates existing managed audio locations without altering the timeline or capability IDs', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const service = new AudiobookImportService(database, { managedStore: new MemoryManagedAudiobookStore() })
    const sources = [mp3Source('legacy.mp3')]
    const imported = await service.import(sources, defaultAudiobookReview(await service.prepare(sources)))
    const before = await database.query('SELECT capability_id, relative_path, fingerprint FROM audiobook_files')
    // Recreate the previous version's column shape with real imported rows.
    await database.execute('ALTER TABLE audiobook_files DROP COLUMN reference_id; DELETE FROM schema_migrations WHERE version = 18;')
    await migrateStorage(database)
    expect(await database.query('SELECT capability_id, relative_path, fingerprint FROM audiobook_files')).toEqual(before)
    expect((await database.query('SELECT reference_id FROM audiobook_files'))[0]?.reference_id).toBeNull()
    expect((await service.findImported(await service.prepare(sources)))?.assetId).toBe(imported.assetId)
    await database.close()
  })
})
