import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReviewToken, initializeReviewAccess, issueReviewAccess, publicKeyFor, verifyReviewToken } from '../scripts/review-access'
import { ReviewAccessService, type ReviewAccessStore } from '../src/purchases/review-access'
import { PurchaseService } from '../src/purchases/service'
import { LibraryUpgradeRequired } from '../src/purchases/model'
import { setLibraryCapacityPolicy } from '../src/purchases/capacity'
import { LibraryRepository } from '../src/storage/library-repository'
import { PortableArchiveService } from '../src/storage/portable-archive'
import { migrateStorage } from '../src/storage/migrations'
import { BunSqliteDatabase } from './storage-test-database'
import { capacityBook } from './fixtures/purchases'

function key() {
  return generateKeyPairSync('ec', { namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey
}

const privateKey = key()
const publicKey = publicKeyFor(privateKey)
const token = createReviewToken(privateKey)

class ReviewStore implements ReviewAccessStore {
  saved = ''
  fail = false
  async getReviewAccess() {
    if (this.fail) throw new Error('Storage unavailable')
    return { active: verifyReviewToken(this.saved, publicKey) }
  }
  async activateReviewAccess({ token: candidate }: { token: string }) {
    if (!verifyReviewToken(candidate, publicKey)) throw new Error('Invalid token')
    this.saved = candidate
    return this.getReviewAccess()
  }
  async endReviewAccess() { this.saved = ''; return { active: false } }
}

describe('signed review grants', () => {
  test('accepts the signing tool output and rejects forgery, altered purpose, and malformed tokens', () => {
    expect(verifyReviewToken(token, publicKey)).toBe(true)
    const wrongPurpose = `WLR1.${sign('sha256', Buffer.from('some-other-app:unlimited'), privateKey).toString('base64url')}`
    const modified = Buffer.from(token.slice(5), 'base64url')
    modified[modified.length - 1] ^= 1
    for (const candidate of ['', 'true', `WLR2.${token.slice(5)}`, `${token}.extra`, `${token}\n`, wrongPurpose,
      `WLR1.${modified.toString('base64url')}`, `WLR1.${'A'.repeat(500)}`, createReviewToken(key())]) {
      expect(verifyReviewToken(candidate, publicKey)).toBe(false)
    }
    expect(verifyReviewToken(token, publicKeyFor(key()))).toBe(false)
    expect(verifyReviewToken(token, '')).toBe(false)
  })

  test('initializes private material outside git, protects files, and refuses accidental rotation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wovenleaf-review-test-'))
    const publicPath = join(directory, 'app', 'review-access-public-key.txt')
    try {
      const result = await initializeReviewAccess(join(directory, 'private'), publicPath)
      const savedPublic = await readFile(publicPath, 'utf8')
      expect(verifyReviewToken((await readFile(result.tokenPath, 'utf8')).trim(), savedPublic)).toBe(true)
      for (const file of ['review-private-key.pem', 'review-token.txt', 'play-console-instructions.txt']) {
        expect((await stat(join(result.directory, file))).mode & 0o777).toBe(0o600)
      }
      expect((await readFile(result.instructionsPath, 'utf8'))).not.toContain('PRIVATE KEY')
      expect((await readFile(result.instructionsPath, 'utf8')).length).toBeLessThanOrEqual(500)
      await expect(initializeReviewAccess(join(directory, 'another'), publicPath)).rejects.toThrow('already exists')
      await issueReviewAccess(result.directory, publicPath)
      await writeFile(publicPath, publicKeyFor(key()))
      await expect(issueReviewAccess(result.directory, publicPath)).rejects.toThrow('does not match')
      await expect(initializeReviewAccess(join(import.meta.dir, 'private'), publicPath)).rejects.toThrow('outside the repository')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test('revalidates persisted proof on restart and fails closed for edited storage or verification errors', async () => {
    const store = new ReviewStore()
    const review = new ReviewAccessService(store)
    await review.activate(`  ${token}\n`)
    expect(await review.hasAccess()).toBe(true)
    expect(await new ReviewAccessService(store).hasAccess()).toBe(true)
    store.saved = 'active=true'
    await review.refresh()
    expect(await review.hasAccess()).toBe(false)
    store.saved = token
    store.fail = true
    await review.refresh()
    expect(await review.hasAccess()).toBe(false)
    expect(review.getSnapshot().busy).toBe(false)
    store.fail = false
    await review.refresh()
    expect(await review.hasAccess()).toBe(true)
    expect(review.getSnapshot().error).toBeUndefined()
  })

  test('a refresh already in flight cannot re-enable access after ending it', async () => {
    const store = new ReviewStore()
    const review = new ReviewAccessService(store)
    await review.activate(token)
    let finish: (result: { active: boolean }) => void = () => {}
    store.getReviewAccess = () => new Promise((resolve) => { finish = resolve })
    const refresh = review.refresh()
    await Promise.resolve()
    const ending = review.end()
    finish({ active: true })
    await Promise.all([refresh, ending])
    expect(await review.hasAccess()).toBe(false)
    expect(store.saved).toBe('')
  })

  test('unlocks book 31 offline; ending preserves books and real ownership; backup cannot transfer review access', async () => {
    const database = new BunSqliteDatabase()
    const restoredDatabase = new BunSqliteDatabase()
    try {
      await migrateStorage(database)
      await migrateStorage(restoredDatabase)
      const library = new LibraryRepository(database)
      await library.replace(Array.from({ length: 30 }, (_, i) => capacityBook(i + 1)))
      const review = new ReviewAccessService(new ReviewStore())
      let owned = false
      const store = {
        getStatus: async () => ({ platform: 'android' as const, owned, available: false, pending: false }),
        restore: async () => ({ platform: 'android' as const, owned, available: false, pending: false }),
        purchase: async () => ({ outcome: 'cancelled' as const }), redeem: async () => {},
      }
      const purchases = new PurchaseService(store, 'android', review)
      setLibraryCapacityPolicy(database, purchases.assertCapacity)
      await review.activate('forged')
      await expect(library.save(capacityBook(31))).rejects.toBeInstanceOf(LibraryUpgradeRequired)
      await review.activate(token)
      await library.save(capacityBook(31))
      expect(purchases.getSnapshot().owned).toBe(false)
      const archive = await new PortableArchiveService(database).create()
      expect(JSON.stringify(archive.archive)).not.toContain(token)
      const restoredPurchases = new PurchaseService(store, 'android', new ReviewAccessService(new ReviewStore()))
      setLibraryCapacityPolicy(restoredDatabase, restoredPurchases.assertCapacity)
      await expect(new PortableArchiveService(restoredDatabase).restore(archive.archive)).rejects.toBeInstanceOf(LibraryUpgradeRequired)
      await review.end()
      expect(await library.list()).toHaveLength(31)
      await library.save({ ...capacityBook(31), notes: 'Still editable' })
      await expect(library.save(capacityBook(32))).rejects.toBeInstanceOf(LibraryUpgradeRequired)
      owned = true
      await purchases.restore()
      await review.activate(token)
      await review.end()
      await library.save(capacityBook(32))
      expect(purchases.getSnapshot().owned).toBe(true)
    } finally { await database.close(); await restoredDatabase.close() }
  })
})
