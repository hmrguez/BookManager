import { sha256 } from '../../src/audiobooks/binary'
import { parseMp3 } from '../../src/audiobooks/mp3'
import { FileAccessError, type OriginalFileAccess, type OriginalFileReference } from '../../src/files/original-files'

export class MemoryOriginalFiles implements OriginalFileAccess {
  readonly files = new Map<string, Uint8Array>()

  link<Source extends { name: string; bytes: Uint8Array }>(source: Source, id = `original:${this.files.size}`): Source & { reference: OriginalFileReference } {
    this.files.set(id, source.bytes.slice())
    return { ...source, reference: { id, name: source.name, size: source.bytes.length } }
  }
  async read(reference: OriginalFileReference) {
    const bytes = this.files.get(reference.id)
    if (!bytes) throw new FileAccessError({ code: 'FILE_MISSING' })
    return bytes.slice()
  }
  async inspect(id: string) {
    const bytes = this.files.get(id)
    if (!bytes) throw new FileAccessError({ code: 'FILE_MISSING' })
    return { size: bytes.length, fingerprint: await sha256(bytes) }
  }
  async readRange(reference: OriginalFileReference, offset: number, length: number) {
    return (await this.read(reference)).slice(offset, offset + length)
  }
  async audioDuration(id: string) {
    const bytes = this.files.get(id)
    if (!bytes) throw new FileAccessError({ code: 'FILE_MISSING' })
    return parseMp3(bytes, id).durationMs
  }
  async verify(reference: OriginalFileReference, fingerprint: string, size: number) {
    const actual = await this.inspect(reference.id)
    if (actual.size !== size || actual.fingerprint !== fingerprint) throw new FileAccessError({ code: 'FILE_CHANGED' })
  }
}
