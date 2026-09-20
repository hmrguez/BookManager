import { Directory, Filesystem, type FilesystemPlugin } from '@capacitor/filesystem'
import { originalFiles, originalFileError, originalFileUri, type OriginalFileAccess } from '../files/original-files'
import { normalizeImageMediaType } from '../audiobooks/binary'
import { immutablePlaybackManifest } from '../audiobooks/manifest'
import type { PlaybackManifest } from '../audiobooks/model'
import { assetSchema } from '../domain/catalog'
import type { SqlDatabase, SqlRow } from '../storage/database'
import { readNumber, readText } from '../storage/database'
import { AudiobookPlaybackError, playbackArtworkSchema, playbackQueueRequestSchema, type PlaybackQueueRequest } from './model'
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
  readonly reference_id: string | null
  readonly fingerprint: string
  readonly byte_size: number
  readonly media_type: string
}

type PlaybackFilesystem = Pick<FilesystemPlugin, 'stat' | 'getUri'>

export class AudiobookPlaybackRepository {
  readonly #database: SqlDatabase
  readonly #progress: AudiobookProgressRepository
  readonly #controls: AudiobookControlsRepository
  readonly #originalFiles: Pick<OriginalFileAccess, 'inspect'>
  readonly #filesystem: PlaybackFilesystem

  constructor(database: SqlDatabase, options: { readonly filesystem?: PlaybackFilesystem; readonly originalFiles?: Pick<OriginalFileAccess, 'inspect'> } = {}) {
    this.#database = database
    this.#progress = new AudiobookProgressRepository(database)
    this.#controls = new AudiobookControlsRepository(database)
    this.#filesystem = options.filesystem ?? Filesystem
    this.#originalFiles = options.originalFiles ?? originalFiles
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
        `SELECT f.capability_id, f.relative_path, f.reference_id, f.fingerprint, f.byte_size, f.media_type
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
        if (typeof row.reference_id === 'string') {
          // Reopening an already loaded player must also reject replacement at the same location.
          const { size, fingerprint } = await this.#originalFiles.inspect(row.reference_id)
          if (size !== readNumber(row, 'byte_size') || (fingerprint && fingerprint !== readText(row, 'fingerprint'))) throw { code: 'FILE_CHANGED' }
          return { capability, uri: originalFileUri(row.reference_id), fingerprint: readText(row, 'fingerprint'),
            byteSize: readNumber(row, 'byte_size'), mediaType: readText(row, 'media_type') }
        }
        const stat = await this.#filesystem.stat({ path: relativePath, directory: Directory.LibraryNoCloud })
        const expectedSize = readNumber(row, 'byte_size')
        if (stat.size !== expectedSize) {
          throw new AudiobookPlaybackError(
            'relinkRequired',
            'A managed audiobook segment changed. Re-import or re-link this edition before retrying.',
            { recoverable: true },
          )
        }
        const { uri } = await this.#filesystem.getUri({ path: relativePath, directory: Directory.LibraryNoCloud })
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
          row.reference_id ? originalFileError(error) : 'An audiobook file is missing. Choose it again; progress was preserved.',
          { cause: error, recoverable: true },
        )
      }
    }))
    const artwork = await resolveArtwork(artworkRows[0], this.#filesystem)
    return playbackQueueRequestSchema.parse({ manifest, sources, ...(artwork ? { artwork } : {}) })
  }
}

async function resolveArtwork(row: PlaybackArtworkRow | undefined, filesystem: PlaybackFilesystem) {
  if (!row) return undefined
  try {
    const parsed = assetSchema.safeParse(JSON.parse(readText(row, 'payload_json')))
    if (!parsed.success || parsed.data.role !== 'cover' || parsed.data.format !== 'image') return undefined
    const { location } = parsed.data
    if (location.kind !== 'managed-file') return undefined
    const mediaType = normalizeImageMediaType(parsed.data.mediaType ?? '')
    if (!mediaType) return undefined
    const stat = await filesystem.stat({ path: location.relativePath, directory: Directory.LibraryNoCloud })
    if (stat.size !== location.byteSize) return undefined
    const { uri } = await filesystem.getUri({
      path: location.relativePath,
      directory: Directory.LibraryNoCloud,
    })
    const artwork = playbackArtworkSchema.safeParse({
      uri,
      fingerprint: location.sha256,
      byteSize: location.byteSize,
      mediaType,
    })
    return artwork.success ? artwork.data : undefined
  } catch {
    // Cover art is optional and must never make otherwise valid audio unavailable.
    return undefined
  }
}
