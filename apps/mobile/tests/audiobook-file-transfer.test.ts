import { describe, expect, test } from 'bun:test'
import { Directory } from '@capacitor/filesystem'
import { sha256 } from '../src/audiobooks/binary'
import { AUDIOBOOK_FILE_CHUNK_BYTES, readNativeAudiobookFile } from '../src/audiobooks/file-transfer'
import { CapacitorManagedAudiobookStore } from '../src/audiobooks/managed-store'
import { AudiobookTestFilesystem } from './fixtures/audiobook-filesystem'

const path = 'assets/audiobooks/test/segments/original.mp3'
const original = Uint8Array.from({ length: AUDIOBOOK_FILE_CHUNK_BYTES * 2 + 7 }, (_, index) => index % 251)

describe('native audiobook file transfers', () => {
  test.each(['android', 'ios'])('preserves every byte across bounded, padded native writes on %s', async (platform) => {
    const filesystem = new AudiobookTestFilesystem()
    const store = new CapacitorManagedAudiobookStore({ filesystem, platform })
    // Include an offset view so surrounding bytes cannot leak into the file.
    const bytes = original.subarray(3, original.length - 1)

    expect(await store.putAtomically(path, bytes)).toEqual({ relativePath: path, created: true })
    expect(filesystem.bytes(path)).toEqual(bytes)
    expect(await sha256(filesystem.bytes(path))).toBe(await sha256(bytes))
    expect(filesystem.writes).toHaveLength(3)
    for (const write of filesystem.writes) {
      expect(write.directory).toBe(Directory.LibraryNoCloud)
      expect(typeof write.data).toBe('string')
      expect((write.data as string).length).toBeLessThanOrEqual(4 * Math.ceil(AUDIOBOOK_FILE_CHUNK_BYTES / 3))
    }
    expect(filesystem.renames).toHaveLength(1)
    expect([...filesystem.files.keys()]).toEqual([path])
  })

  test('retains Blob storage on web', async () => {
    const filesystem = new AudiobookTestFilesystem()
    await new CapacitorManagedAudiobookStore({ filesystem, platform: 'web' }).putAtomically(path, original)
    expect(filesystem.writes).toHaveLength(1)
    expect(filesystem.writes[0]?.data).toBeInstanceOf(Blob)
    expect(filesystem.bytes(path)).toEqual(original)
  })

  test.each(['failure', 'truncation', 'cancellation'])('removes partial files without publishing them after %s', async (reason) => {
    const filesystem = new AudiobookTestFilesystem()
    const controller = new AbortController()
    filesystem.failAppend = reason === 'failure'
    filesystem.truncateAppend = reason === 'truncation'
    if (reason === 'cancellation') filesystem.afterWrite = () => controller.abort()
    const store = new CapacitorManagedAudiobookStore({ filesystem, platform: 'android' })

    await expect(store.putAtomically(path, original, controller.signal)).rejects.toMatchObject({
      code: reason === 'cancellation' ? 'canceled' : 'storage-failed',
    })
    expect(filesystem.files.size).toBe(0)
    expect(filesystem.renames).toHaveLength(0)
  })

  test('keeps an existing managed copy when another import finishes during the write', async () => {
    const filesystem = new AudiobookTestFilesystem()
    filesystem.afterWrite = () => filesystem.files.set(path, [original])
    const store = new CapacitorManagedAudiobookStore({ filesystem, platform: 'android' })
    expect(await store.putAtomically(path, original)).toEqual({ relativePath: path, created: false })
    expect([...filesystem.files.keys()]).toEqual([path])
    expect(filesystem.renames).toHaveLength(0)
    const writes = filesystem.writes.length
    expect(await store.putAtomically(path, original)).toEqual({ relativePath: path, created: false })
    expect(filesystem.writes).toHaveLength(writes)
  })

  test.each([0, 4, AUDIOBOOK_FILE_CHUNK_BYTES])('writes an exact %i-byte file', async (size) => {
    const filesystem = new AudiobookTestFilesystem()
    const bytes = original.subarray(0, size)
    await new CapacitorManagedAudiobookStore({ filesystem, platform: 'android' }).putAtomically(path, bytes)
    expect(filesystem.bytes(path)).toEqual(bytes)
    expect(filesystem.writes).toHaveLength(1)
  })

  test('reads a shared file in bounded requests without changing its fingerprint', async () => {
    const filesystem = new AudiobookTestFilesystem()
    filesystem.files.set('content://books/shared', [original])
    const bytes = await readNativeAudiobookFile('content://books/shared', original.length, filesystem)
    expect(bytes).toEqual(original)
    expect(filesystem.reads.map(({ offset, length }) => ({ offset, length }))).toEqual([
      { offset: 0, length: AUDIOBOOK_FILE_CHUNK_BYTES },
      { offset: AUDIOBOOK_FILE_CHUNK_BYTES, length: AUDIOBOOK_FILE_CHUNK_BYTES },
      { offset: AUDIOBOOK_FILE_CHUNK_BYTES * 2, length: 7 },
    ])
  })

  test('rejects oversized shares before reading or allocating their contents', async () => {
    const filesystem = new AudiobookTestFilesystem()
    filesystem.files.set(path, [original])
    await expect(readNativeAudiobookFile(path, original.length - 1, filesystem)).rejects.toMatchObject({ code: 'unsupported-format' })
    expect(filesystem.reads).toHaveLength(0)
  })

  test('continues short reads and rejects unexpected EOF', async () => {
    const filesystem = new AudiobookTestFilesystem()
    filesystem.files.set(path, [original.subarray(0, 20)])
    const readFile = filesystem.readFile.bind(filesystem)
    filesystem.readFile = (options) => readFile({ ...options, length: 7 })
    expect(await readNativeAudiobookFile(path, 20, filesystem)).toEqual(original.subarray(0, 20))
    filesystem.readFile = async () => ({ data: '' })
    await expect(readNativeAudiobookFile(path, 20, filesystem)).rejects.toThrow('could not be read completely')
  })

  test('hashes only the selected view of the original audio', async () => {
    const bytes = new TextEncoder().encode('prefixabcsuffix').subarray(6, 9)
    expect(await sha256(bytes)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
