import { describe, expect, test } from 'bun:test'
import type { PluginListenerHandle } from '@capacitor/core'
import type { SqlDatabase } from '../src/storage/database'
import type { WovenleafPlaybackPlugin } from '../src/playback/bridge'
import {
  AUDIOBOOK_PLAYBACK_BRIDGE_VERSION,
  AudiobookPlaybackError,
  isNewerPlaybackSnapshot,
  playbackQueueRequestSchema,
  playbackSnapshotSchema,
  type NativePlaybackEvent,
  type PlaybackSnapshot,
} from '../src/playback/model'
import { AudiobookPlaybackService } from '../src/playback/service'
import { AudiobookProgressRepository } from '../src/playback/progress'
import { migrateStorage } from '../src/storage/migrations'
import { BunSqliteDatabase } from './storage-test-database'

const fingerprint = 'a'.repeat(64)

function snapshot(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return playbackSnapshotSchema.parse({
    bridgeVersion: AUDIOBOOK_PLAYBACK_BRIDGE_VERSION,
    engineEpoch: 'engine:test',
    queueId: 'queue:test',
    playbackSessionId: 'session:test',
    revision: 1,
    state: 'paused',
    suppressionReason: 'none',
    playIntent: false,
    segmentId: 'segment:test',
    chapterId: 'chapter:test',
    absolutePositionMs: 1_000,
    segmentPositionMs: 1_000,
    durationMs: 60_000,
    bufferedPositionMs: 60_000,
    activeDurationMs: 0,
    rate: 1,
    sleepTimer: null,
    route: { kind: 'built-in', name: 'Device', external: false },
    capabilities: {
      bridgeVersion: AUDIOBOOK_PLAYBACK_BRIDGE_VERSION,
      engine: 'android-media3',
      backgroundPlayback: true,
      systemControls: true,
      processRestoration: true,
      systemLibrary: true,
      airPlay: false,
      cast: false,
      routeSelection: true,
      sleepTimer: true,
      seek: true,
      supportedMediaTypes: ['audio/mpeg', 'audio/mp4'],
      minimumRate: 0.5,
      maximumRate: 3,
    },
    lastCommandId: null,
    error: null,
    observedAt: '2026-08-28T08:00:00.000Z',
    ...overrides,
  })
}

function event(id: string): NativePlaybackEvent {
  return {
    bridgeVersion: AUDIOBOOK_PLAYBACK_BRIDGE_VERSION,
    id,
    sequence: 1,
    engineEpoch: 'engine:test',
    queueId: 'queue:test',
    playbackSessionId: 'session:test',
    revision: 2,
    kind: 'pause',
    observedAt: '2026-08-28T08:01:00.000Z',
    activeDurationMs: 60_000,
    beforePositionMs: 1_000,
    afterPositionMs: 1_000,
    rate: 1,
    reason: 'test',
    confidence: 1,
    segmentId: 'segment:test',
    chapterId: 'chapter:test',
    error: null,
  }
}

function fakePlugin(initial = snapshot()): {
  readonly plugin: WovenleafPlaybackPlugin
  snapshot: PlaybackSnapshot
  journal: NativePlaybackEvent[]
  acknowledged: string[]
  failNextPlay: boolean
  failNextPlayWithRelink: boolean
  emitSnapshot(candidate: PlaybackSnapshot): void
} {
  const snapshotListeners = new Set<(candidate: PlaybackSnapshot) => void>()
  const eventsListeners = new Set<(notification: { readonly count: number }) => void>()
  const fake = {
    snapshot: initial,
    journal: [] as NativePlaybackEvent[],
    acknowledged: [] as string[],
    failNextPlay: false,
    failNextPlayWithRelink: false,
    emitSnapshot(candidate: PlaybackSnapshot) {
      this.snapshot = candidate
      snapshotListeners.forEach((listener) => listener(candidate))
    },
  }
  const advance = (commandId: string, state: PlaybackSnapshot['state']) => {
    fake.snapshot = snapshot({
      ...fake.snapshot,
      revision: fake.snapshot.revision + 1,
      state,
      playIntent: state === 'playing',
      lastCommandId: commandId,
    })
    return Promise.resolve(fake.snapshot)
  }
  const plugin = {
    getCapabilities: async () => fake.snapshot.capabilities,
    loadQueue: async ({ commandId }) => advance(commandId, 'paused'),
    play: async ({ commandId }) => {
      if (fake.failNextPlayWithRelink) {
        fake.failNextPlayWithRelink = false
        fake.snapshot = snapshot({
          ...fake.snapshot,
          revision: fake.snapshot.revision + 1,
          state: 'error',
          suppressionReason: 'error',
          error: {
            code: 'relinkRequired',
            message: 'The managed audio changed.',
            recoverable: true,
          },
        })
        throw new Error('source validation failed')
      }
      if (fake.failNextPlay) {
        fake.failNextPlay = false
        fake.snapshot = snapshot({ ...fake.snapshot, revision: fake.snapshot.revision + 1 })
        throw new Error('revision conflict')
      }
      return advance(commandId, 'playing')
    },
    pause: async ({ commandId }) => advance(commandId, 'paused'),
    stop: async ({ commandId }) => advance(commandId, 'stopped'),
    seekToAbsolute: async ({ commandId, positionMs }) => {
      fake.snapshot = snapshot({
        ...fake.snapshot,
        revision: fake.snapshot.revision + 1,
        absolutePositionMs: positionMs,
        segmentPositionMs: positionMs,
        lastCommandId: commandId,
      })
      return fake.snapshot
    },
    seekBy: async ({ commandId, offsetMs }) => {
      fake.snapshot = snapshot({
        ...fake.snapshot,
        revision: fake.snapshot.revision + 1,
        absolutePositionMs: fake.snapshot.absolutePositionMs + offsetMs,
        segmentPositionMs: fake.snapshot.segmentPositionMs + offsetMs,
        lastCommandId: commandId,
      })
      return fake.snapshot
    },
    nextChapter: async ({ commandId }) => advance(commandId, 'paused'),
    previousChapter: async ({ commandId }) => advance(commandId, 'paused'),
    setRate: async ({ commandId, rate }) => {
      fake.snapshot = snapshot({
        ...fake.snapshot,
        revision: fake.snapshot.revision + 1,
        rate,
        lastCommandId: commandId,
      })
      return fake.snapshot
    },
    setSleepTimer: async ({ commandId }) => advance(commandId, fake.snapshot.state),
    cancelSleepTimer: async ({ commandId }) => advance(commandId, fake.snapshot.state),
    adoptPosition: async ({ commandId, positionMs }) => {
      fake.snapshot = snapshot({
        ...fake.snapshot,
        revision: fake.snapshot.revision + 1,
        absolutePositionMs: positionMs,
        segmentPositionMs: positionMs,
        lastCommandId: commandId,
      })
      return fake.snapshot
    },
    getSnapshot: async () => fake.snapshot,
    drainJournal: async () => ({ events: fake.journal }),
    acknowledgeJournal: async ({ ids }) => {
      fake.acknowledged.push(...ids)
      fake.journal = fake.journal.filter(({ id }) => !ids.includes(id))
    },
    setSystemSurfacePrivacy: async () => fake.snapshot,
    addListener: async (
      eventName: 'snapshotChanged' | 'eventsAvailable',
      listener: ((candidate: PlaybackSnapshot) => void) | ((notification: { readonly count: number }) => void),
    ) => {
      const listeners = eventName === 'snapshotChanged' ? snapshotListeners : eventsListeners
      const compatibleListener = listener as never
      listeners.add(compatibleListener)
      return {
        remove: async () => listeners.delete(compatibleListener),
      } satisfies PluginListenerHandle
    },
  } as WovenleafPlaybackPlugin
  return Object.assign(fake, { plugin })
}

describe('native audiobook playback contract', () => {
  test('keeps a newer completion event when an earlier play response arrives late', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const fake = fakePlugin()
    fake.plugin.play = async () => {
      const response = snapshot({ state: 'playing', revision: 2, absolutePositionMs: 59_500 })
      fake.emitSnapshot(snapshot({ state: 'ended', revision: 3, absolutePositionMs: 60_000 }))
      return response
    }
    const service = new AudiobookPlaybackService(database, { plugin: fake.plugin })
    await service.connect()

    expect(await service.play()).toMatchObject({ state: 'ended', revision: 3, absolutePositionMs: 60_000 })
    expect(service.snapshot).toMatchObject({ state: 'ended', revision: 3 })
    await service.disconnect()
    await database.close()
  })

  test('publishes and saves the full duration immediately when playback ends', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const fake = fakePlugin(snapshot({ state: 'playing', absolutePositionMs: 59_000, segmentPositionMs: 29_000 }))
    const saved: PlaybackSnapshot[] = []
    class ProgressRepository extends AudiobookProgressRepository {
      override async checkpointSnapshot(candidate: PlaybackSnapshot) {
        saved.push(candidate)
        return 'saved' as const
      }
    }
    const service = new AudiobookPlaybackService(database, {
      plugin: fake.plugin, progressRepository: new ProgressRepository(database),
    })
    await service.connect()
    fake.emitSnapshot(snapshot({
      state: 'ended', revision: 2, absolutePositionMs: 59_500, segmentPositionMs: 29_500,
      observedAt: '2026-08-28T08:00:00.500Z',
    }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(saved).toHaveLength(2)
    expect(saved[1]).toMatchObject({ absolutePositionMs: 60_000, segmentPositionMs: 30_000 })
    expect(service.snapshot).toMatchObject({ absolutePositionMs: 60_000, segmentPositionMs: 30_000 })
    fake.emitSnapshot(snapshot({ ...fake.snapshot, revision: 3 }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(saved).toHaveLength(2)
    await service.disconnect()
    await database.close()
  })

  test('notifies library consumers after durable checkpoints, skipping throttled and failed saves', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const fake = fakePlugin()
    let savedRevision = 0
    let failSave = false
    class ProgressRepository extends AudiobookProgressRepository {
      override async checkpointSnapshot(candidate: PlaybackSnapshot) {
        if (failSave) throw new Error('Storage unavailable')
        await Promise.resolve()
        savedRevision = candidate.revision
        return 'saved' as const
      }
    }
    const service = new AudiobookPlaybackService(database, {
      plugin: fake.plugin, progressRepository: new ProgressRepository(database),
    })
    const notifications: number[] = []
    const unsubscribe = service.subscribeProgress(() => notifications.push(savedRevision))
    await service.connect()
    expect(notifications).toEqual([1])
    fake.emitSnapshot(snapshot({ revision: 2, absolutePositionMs: 2_000 }))
    await Promise.resolve()
    expect(notifications).toEqual([1])
    await service.play()
    expect(notifications).toEqual([1, 3])
    failSave = true
    await expect(service.flush()).rejects.toThrow('Storage unavailable')
    expect(notifications).toEqual([1, 3])
    failSave = false
    unsubscribe()
    await service.disconnect()
    expect(notifications).toEqual([1, 3])
    await database.close()
  })

  test('rejects a queue when an opaque source capability does not match immutable evidence', () => {
    const request = {
      manifest: {
        schemaVersion: 1,
        queueId: 'queue:test',
        editionId: 'edition:test',
        assetId: 'asset:test',
        fingerprint,
        createdAt: '2026-08-28T08:00:00.000Z',
        displayMetadata: { title: 'A Book', authors: ['A. Author'], narrators: ['N. Narrator'] },
        systemSurfaceMetadata: {
          private: { title: 'Wovenleaf', subtitle: 'Audiobook' },
          preview: { title: 'A Book', contributor: 'A. Author' },
        },
        segments: [{
          id: 'segment:test',
          mediaType: 'audio/mpeg',
          container: 'mpeg-audio',
          durationMs: 60_000,
          absoluteStartMs: 0,
          absoluteEndMs: 60_000,
          fingerprint,
          playableCapability: 'source:expected',
        }],
        chapters: [{
          key: 'chapter:test',
          title: 'Chapter one',
          segmentId: 'segment:test',
          absoluteStartMs: 0,
          absoluteEndMs: 60_000,
          provenance: 'track',
        }],
        initialAbsolutePositionMs: 0,
        rate: 1,
        skipIntervals: { forwardMs: 30_000, backwardMs: 15_000 },
        sleepTimer: null,
        sourceCapabilities: { local: true, seekable: true, relinkable: true },
      },
      sources: [{
        capability: 'source:different',
        uri: 'file:///private/book.mp3',
        fingerprint,
        byteSize: 1_024,
        mediaType: 'audio/mpeg',
      }],
    }

    expect(playbackQueueRequestSchema.safeParse(request).success).toBe(false)
  })

  test('orders authoritative snapshots by engine epoch, session, then monotonic revision', () => {
    const current = snapshot({ revision: 4 })
    expect(isNewerPlaybackSnapshot(current, snapshot({ revision: 3 }))).toBe(false)
    expect(isNewerPlaybackSnapshot(current, snapshot({ revision: 5 }))).toBe(true)
    expect(isNewerPlaybackSnapshot(current, snapshot({ playbackSessionId: 'session:new', revision: 0 }))).toBe(true)
    expect(isNewerPlaybackSnapshot(current, snapshot({ engineEpoch: 'engine:new', revision: 0 }))).toBe(true)
  })

  test('refreshes the authoritative state when a system surface wins a command race', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const fake = fakePlugin()
    const service = new AudiobookPlaybackService(database as SqlDatabase, { plugin: fake.plugin })
    await service.connect()
    fake.failNextPlay = true

    await expect(service.play()).rejects.toBeInstanceOf(AudiobookPlaybackError)
    expect(service.snapshot?.revision).toBe(2)
    await service.disconnect()
    await database.close()
  })

  test('acknowledges only journal rows accepted by the durable event consumer', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const fake = fakePlugin()
    fake.journal.push(event('event:one'), { ...event('event:two'), id: 'event:two', sequence: 2 })
    const service = new AudiobookPlaybackService(database as SqlDatabase, {
      plugin: fake.plugin,
      journalConsumer: async () => ['event:one'],
    })
    let notifications = 0
    service.subscribeProgress(() => { notifications += 1 })

    await service.connect()
    expect(notifications).toBe(1)
    expect(fake.acknowledged).toEqual(['event:one'])
    expect(fake.journal.map(({ id }) => id)).toEqual(['event:two'])
    await service.disconnect()
    await database.close()
  })

  test('preserves a typed recoverable source error from the authoritative engine', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const fake = fakePlugin()
    const service = new AudiobookPlaybackService(database as SqlDatabase, { plugin: fake.plugin })
    await service.connect()
    fake.failNextPlayWithRelink = true

    await expect(service.play()).rejects.toMatchObject({ code: 'relinkRequired', recoverable: true })
    expect(service.snapshot).toMatchObject({
      revision: 2,
      absolutePositionMs: 1_000,
      error: { code: 'relinkRequired' },
    })
    await expect(service.setSleepTimer(0)).rejects.toMatchObject({ code: 'commandRejected' })
    await service.disconnect()
    await database.close()
  })

  test('offers one-tap return from the latest durable seek discontinuity', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const fake = fakePlugin(snapshot({ absolutePositionMs: 42_000, segmentPositionMs: 42_000 }))
    fake.journal.push({
      ...event('event:seek'),
      sequence: 2,
      kind: 'seek',
      beforePositionMs: 1_000,
      afterPositionMs: 42_000,
      reason: 'absolute-seek',
    })
    const service = new AudiobookPlaybackService(database as SqlDatabase, {
      plugin: fake.plugin,
      journalConsumer: async (events) => events.map(({ id }) => id),
    })
    let availableReturn: number | undefined
    service.subscribeSeekUndo((seek) => { availableReturn = seek?.beforePositionMs })

    await service.connect()
    expect(availableReturn).toBe(1_000)
    await service.undoLastSeek()
    expect(service.snapshot?.absolutePositionMs).toBe(1_000)
    expect(availableReturn).toBeUndefined()
    await service.disconnect()
    await database.close()
  })

  test('does not offer seek history from an earlier playback session', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const fake = fakePlugin()
    fake.journal.push({
      ...event('event:stale-seek'),
      playbackSessionId: 'session:old',
      kind: 'seek',
      beforePositionMs: 7_000,
      afterPositionMs: 21_000,
    })
    const service = new AudiobookPlaybackService(database as SqlDatabase, {
      plugin: fake.plugin,
      journalConsumer: async (events) => events.map(({ id }) => id),
    })
    let availableReturn: number | undefined
    service.subscribeSeekUndo((seek) => { availableReturn = seek?.beforePositionMs })

    await service.connect()
    expect(availableReturn).toBeUndefined()
    await service.disconnect()
    await database.close()
  })
})
