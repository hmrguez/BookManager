import { Directory, Filesystem } from '@capacitor/filesystem'
import { immutablePlaybackManifest } from '../audiobooks/manifest'
import type { PlaybackManifest } from '../audiobooks/model'
import { assetSchema } from '../domain/catalog'
import type { SqlDatabase, SqlRow } from '../storage/database'
import { readNumber, readText } from '../storage/database'
import { AudiobookPlaybackError, playbackQueueRequestSchema, type PlaybackQueueRequest } from './model'
import { AudiobookProgressRepository } from './progress'
import { AudiobookControlsRepository } from './controls'

type PlaybackImportRow = SqlRow & {
  readonly manifest_json: string
}

type PlaybackArtworkRow = SqlRow & {
  readonly payload_json: string
}

type PlaybackFileRow = SqlRow & {
  readonly capability_id: string
  readonly relative_path: string
  readonly fingerprint: string
  readonly byte_size: number
  readonly media_type: string
}

export class AudiobookPlaybackRepository {
  readonly #database: SqlDatabase
  readonly #progress: AudiobookProgressRepository
  readonly #controls: AudiobookControlsRepository

  constructor(database: SqlDatabase) {
    this.#database = database
    this.#progress = new AudiobookProgressRepository(database)
    this.#controls = new AudiobookControlsRepository(database)
  }

  async queueForBook(bookId: string): Promise<PlaybackQueueRequest | undefined> {
    const [row] = await this.#database.query<PlaybackImportRow>(
      `SELECT manifest_json
       FROM audiobook_imports
       WHERE book_id = ?
       ORDER BY imported_at DESC, id DESC
       LIMIT 1`,
      [bookId],
    )
    if (!row) return undefined
    const queue = await this.#resolve(immutablePlaybackManifest(JSON.parse(readText(row, 'manifest_json'))))
    const [resolution, checkpoint, preferences] = await Promise.all([
      this.#progress.resolvePositionForBook(bookId),
      this.#progress.checkpointForBook(bookId),
      this.#controls.preferencesForBook(bookId),
    ])
    return playbackQueueRequestSchema.parse({
      ...queue,
      manifest: {
        ...queue.manifest,
        initialAbsolutePositionMs: resolution?.status === 'resolved'
          ? resolution.positionMs
          : checkpoint?.absolutePositionMs ?? queue.manifest.initialAbsolutePositionMs,
        rate: preferences.effective.rate,
        skipIntervals: {
          forwardMs: preferences.effective.forwardSkipMs,
          backwardMs: preferences.effective.backwardSkipMs,
        },
      },
    })
  }

  async queueForAsset(assetId: string): Promise<PlaybackQueueRequest | undefined> {
    const [row] = await this.#database.query<PlaybackImportRow>(
      'SELECT manifest_json FROM audiobook_imports WHERE content_asset_id = ? LIMIT 1',
      [assetId],
    )
    if (!row) return undefined
    return this.#resolve(immutablePlaybackManifest(JSON.parse(readText(row, 'manifest_json'))))
  }

  async #resolve(manifest: PlaybackManifest): Promise<PlaybackQueueRequest> {
    const [rows, artworkRows] = await Promise.all([
      this.#database.query<PlaybackFileRow>(
        `SELECT f.capability_id, f.relative_path, f.fingerprint, f.byte_size, f.media_type
         FROM audiobook_files f
         JOIN audiobook_imports i ON i.id = f.import_id
         WHERE i.content_asset_id = ?
         ORDER BY f.position, f.capability_id`,
        [manifest.assetId],
      ),
      this.#database.query<PlaybackArtworkRow>(
        `SELECT cover.payload_json
         FROM audiobook_imports i
         JOIN assets cover ON cover.id = i.cover_asset_id
         WHERE i.content_asset_id = ?
         LIMIT 1`,
        [manifest.assetId],
      ),
    ])
    const sources = await Promise.all(rows.map(async (row) => {
      const capability = readText(row, 'capability_id')
      const relativePath = readText(row, 'relative_path')
      try {
        const stat = await Filesystem.stat({ path: relativePath, directory: Directory.LibraryNoCloud })
        const expectedSize = readNumber(row, 'byte_size')
        if (stat.size !== expectedSize) {
          throw new AudiobookPlaybackError(
            'relinkRequired',
            'A managed audiobook segment changed. Re-import or re-link this edition before retrying.',
            { recoverable: true },
          )
        }
        const { uri } = await Filesystem.getUri({ path: relativePath, directory: Directory.LibraryNoCloud })
        return {
          capability,
          uri,
          fingerprint: readText(row, 'fingerprint'),
          byteSize: expectedSize,
          mediaType: readText(row, 'media_type'),
        }
      } catch (error) {
        if (error instanceof AudiobookPlaybackError) throw error
        throw new AudiobookPlaybackError(
          'relinkRequired',
          'A managed audiobook segment is missing. Re-import or re-link this edition; progress was preserved.',
          { cause: error, recoverable: true },
        )
      }
    }))
    const artwork = await resolveArtwork(artworkRows[0])
    return playbackQueueRequestSchema.parse({ manifest, sources, ...(artwork ? { artwork } : {}) })
  }
}

async function resolveArtwork(row: PlaybackArtworkRow | undefined) {
  if (!row) return undefined
  try {
    const parsed = assetSchema.safeParse(JSON.parse(readText(row, 'payload_json')))
    if (!parsed.success || parsed.data.role !== 'cover' || parsed.data.format !== 'image') return undefined
    const { location } = parsed.data
    if (location.kind !== 'managed-file') return undefined
    const stat = await Filesystem.stat({ path: location.relativePath, directory: Directory.LibraryNoCloud })
    if (stat.size !== location.byteSize) return undefined
    const { uri } = await Filesystem.getUri({
      path: location.relativePath,
      directory: Directory.LibraryNoCloud,
    })
    return {
      uri,
      fingerprint: location.sha256,
      byteSize: location.byteSize,
      mediaType: parsed.data.mediaType,
    }
  } catch {
    // Cover art is optional and must never make otherwise valid audio unavailable.
    return undefined
  }
}
