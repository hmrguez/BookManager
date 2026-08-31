import { describe, expect, test } from 'bun:test'
import {
  AudiobookImportError,
  AudiobookImportService,
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
import { writeLibraryBook } from '../src/storage/library-repository'
import { PortableArchiveService } from '../src/storage/portable-archive'
import { BunSqliteDatabase } from './storage-test-database'

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
})

describe('managed audiobook import', () => {
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
      new TextEncoder().encode('image/jpeg'),
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
  options: { readonly durationMs?: number; readonly cover?: boolean; readonly protected?: boolean } = {},
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
  const evidence = atom('free', fourCc('mp4a'), ...(options.protected ? [fourCc('sinf')] : []))
  const moov = atom('moov', atom('mvhd', mvhdBody), atom('udta', metadata, chpl), evidence)
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
