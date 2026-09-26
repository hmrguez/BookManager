import { z } from 'zod'
import { immutablePlaybackManifest } from '../audiobooks/manifest'
import type { PlaybackManifest } from '../audiobooks/model'
import type { SqlDatabase, SqlRow } from '../storage/database'
import { readNumber, readText } from '../storage/database'
import { AudiobookPlaybackError, type PlaybackSnapshot } from './model'

const rateSchema = z.number().min(0.5).max(3)
const skipIntervalSchema = z.number().int().min(5_000).max(120_000)

export const audiobookControlPreferencesSchema = z.object({
  version: z.literal(1),
  rate: rateSchema,
  forwardSkipMs: skipIntervalSchema,
  backwardSkipMs: skipIntervalSchema,
  defaultSleepMs: z.number().int().min(60_000).max(3 * 60 * 60_000),
  shakeToExtend: z.boolean(),
  shakeExtensionMs: z.number().int().min(60_000).max(60 * 60_000),
})

const storedAudiobookControlPreferencesSchema = audiobookControlPreferencesSchema.partial().extend({
  version: z.literal(1),
})

export const DEFAULT_AUDIOBOOK_CONTROL_PREFERENCES = audiobookControlPreferencesSchema.parse({
  version: 1,
  rate: 1,
  forwardSkipMs: 30_000,
  backwardSkipMs: 15_000,
  defaultSleepMs: 30 * 60_000,
  shakeToExtend: false,
  shakeExtensionMs: 10 * 60_000,
})

export const audiobookAnnotationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['bookmark', 'text-note', 'voice-note']),
  bookId: z.string().min(1),
  editionId: z.string().min(1),
  assetId: z.string().min(1),
  queueId: z.string().min(1),
  playbackSessionId: z.string().min(1),
  snapshotRevision: z.number().int().nonnegative(),
  absolutePositionMs: z.number().int().nonnegative(),
  chapterId: z.string().min(1).nullable(),
  note: z.string(),
  voiceRelativePath: z.string().min(1).optional(),
  voiceDurationMs: z.number().int().nonnegative().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).superRefine((annotation, context) => {
  if (annotation.kind === 'voice-note' && !annotation.voiceRelativePath) {
    context.addIssue({ code: 'custom', path: ['voiceRelativePath'], message: 'A voice note needs local audio.' })
  }
  if (annotation.kind !== 'voice-note' && (annotation.voiceRelativePath || annotation.voiceDurationMs !== undefined)) {
    context.addIssue({ code: 'custom', path: ['kind'], message: 'Only voice notes can reference local audio.' })
  }
})

export type AudiobookControlPreferences = z.infer<typeof audiobookControlPreferencesSchema>
export type AudiobookControlPreferenceScope = 'global' | 'book'
export type AudiobookControlPreferenceState = {
  readonly global: AudiobookControlPreferences
  readonly book?: Partial<AudiobookControlPreferences> & { readonly version: 1 }
  readonly effective: AudiobookControlPreferences
}
export type AudiobookAnnotation = z.infer<typeof audiobookAnnotationSchema>
export type AudiobookPlaybackContext = {
  readonly bookId: string
  readonly editionId: string
  readonly assetId: string
  readonly queueId: string
  readonly title: string
  readonly authors: readonly string[]
  readonly narrators: readonly string[]
  readonly chapters: PlaybackManifest['chapters']
  readonly durationMs: number
}

type PreferenceRow = SqlRow & {
  readonly scope: AudiobookControlPreferenceScope
  readonly preferences_json: string
}

type ImportRow = SqlRow & {
  readonly book_id: string
  readonly edition_id: string
  readonly content_asset_id: string
  readonly manifest_json: string
}

type AnnotationRow = SqlRow & {
  readonly id: string
  readonly kind: AudiobookAnnotation['kind']
  readonly book_id: string
  readonly edition_id: string
  readonly asset_id: string
  readonly queue_id: string
  readonly playback_session_id: string
  readonly snapshot_revision: number
  readonly absolute_position_ms: number
  readonly chapter_id: string | null
  readonly note: string
  readonly voice_relative_path: string | null
  readonly voice_duration_ms: number | null
  readonly created_at: string
  readonly updated_at: string
}

export class AudiobookControlsRepository {
  readonly #database: SqlDatabase
  readonly #now: () => Date
  readonly #createId: (prefix: string) => string

  constructor(
    database: SqlDatabase,
    options: { readonly now?: () => Date; readonly createId?: (prefix: string) => string } = {},
  ) {
    this.#database = database
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? ((prefix) => `${prefix}:${crypto.randomUUID()}`)
  }

  async preferencesForBook(bookId: string): Promise<AudiobookControlPreferenceState> {
    const rows = await this.#database.query<PreferenceRow>(
      `SELECT scope, preferences_json
       FROM audiobook_playback_preferences
       WHERE (scope = 'global' AND book_id = '')
          OR (scope = 'book' AND book_id = ?)
       ORDER BY scope`,
      [bookId],
    )
    let global = DEFAULT_AUDIOBOOK_CONTROL_PREFERENCES
    let book: z.infer<typeof storedAudiobookControlPreferencesSchema> | undefined
    for (const row of rows) {
      const preferences = storedAudiobookControlPreferencesSchema.parse(
        JSON.parse(readText(row, 'preferences_json')),
      )
      if (readText(row, 'scope') === 'global') {
        global = audiobookControlPreferencesSchema.parse({
          ...DEFAULT_AUDIOBOOK_CONTROL_PREFERENCES,
          ...preferences,
        })
      } else {
        book = preferences
      }
    }
    return {
      global,
      ...(book ? { book } : {}),
      effective: audiobookControlPreferencesSchema.parse({ ...global, ...book }),
    }
  }

  async saveRate(bookId: string, rate: number, scope: AudiobookControlPreferenceScope): Promise<void> {
    const validatedRate = rateSchema.parse(rate)
    if (scope === 'global') {
      const { global } = await this.preferencesForBook(bookId)
      await this.#savePreferences('global', '', { ...global, rate: validatedRate })
      return
    }
    const { book } = await this.preferencesForBook(bookId)
    await this.#savePreferences('book', bookId, { ...book, version: 1, rate: validatedRate })
  }

  async clearBookRate(bookId: string): Promise<void> {
    const { book } = await this.preferencesForBook(bookId)
    if (!book) return
    const { rate: _rate, ...remaining } = book
    if (Object.keys(remaining).length === 1) {
      await this.#database.run(
        "DELETE FROM audiobook_playback_preferences WHERE scope = 'book' AND book_id = ?",
        [bookId],
      )
      await this.#database.persist()
      return
    }
    await this.#savePreferences('book', bookId, remaining)
  }

  async saveGlobalControls(
    bookId: string,
    changes: Partial<Pick<
      AudiobookControlPreferences,
      'forwardSkipMs' | 'backwardSkipMs' | 'defaultSleepMs' | 'shakeToExtend' | 'shakeExtensionMs'
    >>,
  ): Promise<AudiobookControlPreferences> {
    const { global } = await this.preferencesForBook(bookId)
    const next = audiobookControlPreferencesSchema.parse({ ...global, ...changes })
    await this.#savePreferences('global', '', next)
    return next
  }

  async contextForBook(bookId: string): Promise<AudiobookPlaybackContext | undefined> {
    const row = await this.#latestImport('i.book_id = ?', [bookId])
    return row ? contextFromImport(row) : undefined
  }

  async contextForQueue(queueId: string): Promise<AudiobookPlaybackContext | undefined> {
    const row = await this.#latestImport("json_extract(i.manifest_json, '$.queueId') = ?", [queueId])
    return row ? contextFromImport(row) : undefined
  }

  async createAnnotation(input: {
    readonly bookId: string
    readonly snapshot: PlaybackSnapshot
    readonly kind: AudiobookAnnotation['kind']
    readonly note?: string
    readonly voiceRelativePath?: string
    readonly voiceDurationMs?: number
    readonly id?: string
  }): Promise<AudiobookAnnotation> {
    const context = await this.contextForBook(input.bookId)
    const snapshot = input.snapshot
    if (
      !context ||
      !snapshot.queueId ||
      !snapshot.playbackSessionId ||
      snapshot.queueId !== context.queueId
    ) {
      throw new AudiobookPlaybackError(
        'commandRejected',
        'The audiobook changed before this annotation could be placed. Nothing was saved.',
        { recoverable: true },
      )
    }
    const timestamp = this.#now().toISOString()
    const annotation = audiobookAnnotationSchema.parse({
      id: input.id ?? this.#createId(`audiobook-${input.kind}`),
      kind: input.kind,
      bookId: context.bookId,
      editionId: context.editionId,
      assetId: context.assetId,
      queueId: context.queueId,
      playbackSessionId: snapshot.playbackSessionId,
      snapshotRevision: snapshot.revision,
      absolutePositionMs: snapshot.absolutePositionMs,
      chapterId: snapshot.chapterId,
      note: input.note?.trim() ?? '',
      ...(input.voiceRelativePath ? { voiceRelativePath: input.voiceRelativePath } : {}),
      ...(input.voiceDurationMs === undefined ? {} : { voiceDurationMs: input.voiceDurationMs }),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    await this.#database.run(
      `INSERT INTO audiobook_annotations(
         id, kind, book_id, edition_id, asset_id, queue_id, playback_session_id,
         snapshot_revision, absolute_position_ms, chapter_id, note,
         voice_relative_path, voice_duration_ms, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        annotation.id,
        annotation.kind,
        annotation.bookId,
        annotation.editionId,
        annotation.assetId,
        annotation.queueId,
        annotation.playbackSessionId,
        annotation.snapshotRevision,
        annotation.absolutePositionMs,
        annotation.chapterId,
        annotation.note,
        annotation.voiceRelativePath ?? null,
        annotation.voiceDurationMs ?? null,
        annotation.createdAt,
        annotation.updatedAt,
      ],
    )
    await this.#database.persist()
    return annotation
  }

  async annotationsForBook(bookId: string): Promise<AudiobookAnnotation[]> {
    const rows = await this.#database.query<AnnotationRow>(
      `${annotationSelect}
       WHERE book_id = ?
       ORDER BY absolute_position_ms, created_at, id`,
      [bookId],
    )
    return rows.map(annotationFromRow)
  }

  async allAnnotations(): Promise<AudiobookAnnotation[]> {
    return (await this.#database.query<AnnotationRow>(`${annotationSelect} ORDER BY id`)).map(annotationFromRow)
  }

  async updateAnnotationNote(id: string, note: string): Promise<AudiobookAnnotation | undefined> {
    const updatedAt = this.#now().toISOString()
    await this.#database.run(
      'UPDATE audiobook_annotations SET note = ?, updated_at = ? WHERE id = ?',
      [note.trim(), updatedAt, id],
    )
    await this.#database.persist()
    const [row] = await this.#database.query<AnnotationRow>(`${annotationSelect} WHERE id = ?`, [id])
    return row ? annotationFromRow(row) : undefined
  }

  async deleteAnnotation(id: string): Promise<string | undefined> {
    const [row] = await this.#database.query<{ readonly voice_relative_path: string | null }>(
      'SELECT voice_relative_path FROM audiobook_annotations WHERE id = ?',
      [id],
    )
    await this.#database.run('DELETE FROM audiobook_annotations WHERE id = ?', [id])
    await this.#database.persist()
    return row?.voice_relative_path ?? undefined
  }

  async exportAnnotationsMarkdown(bookId: string): Promise<string> {
    const [context, annotations] = await Promise.all([
      this.contextForBook(bookId),
      this.annotationsForBook(bookId),
    ])
    if (!context) throw new AudiobookPlaybackError('notFound', 'No audiobook is attached to this book.')
    const chapterTitles = new Map(context.chapters.map(({ key, title }) => [key, title]))
    const lines = [
      `# ${context.title} — listening notes`,
      '',
      `Exported ${this.#now().toISOString()}. Times use the audiobook’s absolute timeline.`,
      '',
    ]
    if (!annotations.length) lines.push('_No bookmarks or quick notes._', '')
    for (const annotation of annotations) {
      const label = annotation.kind === 'bookmark'
        ? 'Bookmark'
        : annotation.kind === 'voice-note' ? 'Voice note' : 'Quick note'
      const chapter = annotation.chapterId ? chapterTitles.get(annotation.chapterId) : undefined
      lines.push(`## ${label} · ${formatAudioTime(annotation.absolutePositionMs)}`)
      lines.push('')
      if (chapter) lines.push(`Chapter: ${chapter}`, '')
      if (annotation.note) lines.push(annotation.note, '')
      if (annotation.kind === 'voice-note') {
        lines.push(`_Local voice recording · ${formatAudioTime(annotation.voiceDurationMs ?? 0)}. Audio is not embedded in this text export._`, '')
      }
    }
    return lines.join('\n')
  }

  async #savePreferences(
    scope: AudiobookControlPreferenceScope,
    bookId: string,
    preferences: unknown,
  ): Promise<void> {
    const validated = storedAudiobookControlPreferencesSchema.parse(preferences)
    await this.#database.run(
      `INSERT INTO audiobook_playback_preferences(scope, book_id, preferences_json, recorded_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(scope, book_id) DO UPDATE SET
         preferences_json = excluded.preferences_json,
         recorded_at = excluded.recorded_at`,
      [scope, bookId, JSON.stringify(validated), this.#now().toISOString()],
    )
    await this.#database.persist()
  }

  async #latestImport(where: string, values: readonly string[]): Promise<ImportRow | undefined> {
    const [row] = await this.#database.query<ImportRow>(
      `SELECT i.book_id, i.edition_id, i.content_asset_id, i.manifest_json
       FROM audiobook_imports i
       WHERE ${where}
       ORDER BY i.imported_at DESC, i.id DESC
       LIMIT 1`,
      values,
    )
    return row
  }
}

const annotationSelect = `SELECT id, kind, book_id, edition_id, asset_id, queue_id,
  playback_session_id, snapshot_revision, absolute_position_ms, chapter_id, note,
  voice_relative_path, voice_duration_ms, created_at, updated_at
  FROM audiobook_annotations`

function contextFromImport(row: ImportRow): AudiobookPlaybackContext {
  const manifest = immutablePlaybackManifest(JSON.parse(readText(row, 'manifest_json')))
  return {
    bookId: readText(row, 'book_id'),
    editionId: readText(row, 'edition_id'),
    assetId: readText(row, 'content_asset_id'),
    queueId: manifest.queueId,
    title: manifest.displayMetadata.title,
    authors: manifest.displayMetadata.authors,
    narrators: manifest.displayMetadata.narrators,
    chapters: manifest.chapters,
    durationMs: manifest.segments.at(-1)?.absoluteEndMs ?? 0,
  }
}

function annotationFromRow(row: AnnotationRow): AudiobookAnnotation {
  return audiobookAnnotationSchema.parse({
    id: readText(row, 'id'),
    kind: readText(row, 'kind'),
    bookId: readText(row, 'book_id'),
    editionId: readText(row, 'edition_id'),
    assetId: readText(row, 'asset_id'),
    queueId: readText(row, 'queue_id'),
    playbackSessionId: readText(row, 'playback_session_id'),
    snapshotRevision: readNumber(row, 'snapshot_revision'),
    absolutePositionMs: readNumber(row, 'absolute_position_ms'),
    chapterId: row.chapter_id,
    note: readText(row, 'note'),
    ...(row.voice_relative_path === null ? {} : { voiceRelativePath: row.voice_relative_path }),
    ...(row.voice_duration_ms === null ? {} : { voiceDurationMs: row.voice_duration_ms }),
    createdAt: readText(row, 'created_at'),
    updatedAt: readText(row, 'updated_at'),
  })
}

export function formatAudioTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}
