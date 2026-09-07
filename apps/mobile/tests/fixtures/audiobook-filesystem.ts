import type {
  AppendFileOptions,
  DeleteFileOptions,
  ReadFileOptions,
  RenameOptions,
  StatOptions,
  WriteFileOptions,
} from '@capacitor/filesystem'

/** Models native binary append semantics, including independent base64 padding. */
export class AudiobookTestFilesystem {
  readonly files = new Map<string, Uint8Array[]>()
  readonly writes: Array<WriteFileOptions | AppendFileOptions> = []
  readonly reads: ReadFileOptions[] = []
  readonly renames: RenameOptions[] = []
  failAppend = false
  truncateAppend = false
  afterWrite?: () => void

  bytes(path: string): Uint8Array {
    const chunks = this.files.get(path)
    if (!chunks) throw new Error('File does not exist')
    return new Uint8Array(Buffer.concat(chunks))
  }

  async writeFile(options: WriteFileOptions) {
    this.writes.push(options)
    const bytes = options.data instanceof Blob
      ? new Uint8Array(await options.data.arrayBuffer())
      : new Uint8Array(Buffer.from(options.data, 'base64'))
    this.files.set(options.path, [bytes])
    this.afterWrite?.()
    return { uri: `file:///private/${options.path}` }
  }

  async appendFile(options: AppendFileOptions) {
    if (this.failAppend) throw new Error('No space left on device')
    this.writes.push(options)
    const bytes = new Uint8Array(Buffer.from(options.data, 'base64'))
    const chunks = this.files.get(options.path)
    if (!chunks) throw new Error('File does not exist')
    chunks.push(this.truncateAppend ? bytes.subarray(1) : bytes)
    this.afterWrite?.()
  }

  async stat(options: StatOptions) {
    const chunks = this.files.get(options.path)
    if (!chunks) throw new Error('File does not exist')
    return {
      type: 'file' as const,
      size: chunks.reduce((total, bytes) => total + bytes.byteLength, 0),
      ctime: 0,
      mtime: 0,
      uri: `file:///private/${options.path}`,
    }
  }

  async getUri(options: StatOptions) {
    return { uri: `file:///private/${options.path}` }
  }

  async rename(options: RenameOptions) {
    this.renames.push(options)
    const chunks = this.files.get(options.from)
    if (!chunks) throw new Error('File does not exist')
    this.files.set(options.to, chunks)
    this.files.delete(options.from)
  }

  async deleteFile(options: DeleteFileOptions) {
    this.files.delete(options.path)
  }

  async readFile(options: ReadFileOptions) {
    this.reads.push(options)
    const bytes = this.bytes(options.path)
    const offset = options.offset ?? 0
    return { data: Buffer.from(bytes.subarray(offset, offset + (options.length ?? bytes.length))).toString('base64') }
  }
}
