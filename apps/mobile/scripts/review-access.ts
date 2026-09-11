import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const REVIEW_MESSAGE = 'WLR1:com.hmrguez.wovenleaf:review:unlimited'
const repository = fileURLToPath(new URL('../../../', import.meta.url))
export const bundledPublicKey = fileURLToPath(new URL('../public/review-access-public-key.txt', import.meta.url))

export function publicKeyFor(privatePem: string): string {
  const key = createPrivateKey(privatePem)
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('Review access requires a P-256 signing key.')
  }
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64')
}

export function createReviewToken(privatePem: string): string {
  publicKeyFor(privatePem)
  return `WLR1.${sign('sha256', Buffer.from(REVIEW_MESSAGE), privatePem).toString('base64url')}`
}

export function verifyReviewToken(token: string, publicKey: string): boolean {
  try {
    if (!/^WLR1\.[A-Za-z0-9_-]{1,128}$/.test(token)) return false
    return verify('sha256', Buffer.from(REVIEW_MESSAGE), {
      key: Buffer.from(publicKey.trim(), 'base64'), type: 'spki', format: 'der',
    }, Buffer.from(token.slice(5), 'base64url'))
  } catch { return false }
}

function inside(parent: string, path: string): boolean {
  const suffix = relative(parent, path)
  return suffix === '' || (!suffix.startsWith(`..${sep}`) && suffix !== '..' && !isAbsolute(suffix))
}

async function privateDirectory(path: string): Promise<string> {
  const directory = resolve(path)
  const root = await realpath(repository)
  if (inside(root, directory)) throw new Error('Keep the private key and review token outside the repository.')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const actual = await realpath(directory)
  if (inside(root, actual)) throw new Error('The private directory must not link into the repository.')
  return actual
}

export async function initializeReviewAccess(path: string, publicPath = bundledPublicKey, replacePublicKey = false) {
  const directory = await privateDirectory(path)
  try {
    await readFile(publicPath)
    if (!replacePublicKey) throw new Error('A public key already exists. Use issue with its private key, or --replace-public-key to rotate it.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const pair = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  // Exclusive creation prevents overwriting an existing private key, including a symlink.
  await writeFile(resolve(directory, 'review-private-key.pem'), pair.privateKey, { flag: 'wx', mode: 0o600 })
  await mkdir(dirname(publicPath), { recursive: true })
  await writeFile(publicPath, `${publicKeyFor(pair.privateKey)}\n`, { flag: replacePublicKey ? 'w' : 'wx' })
  return issueReviewAccess(directory, publicPath)
}

export async function issueReviewAccess(path: string, publicPath = bundledPublicKey) {
  const directory = await privateDirectory(path)
  const privatePem = await readFile(resolve(directory, 'review-private-key.pem'), 'utf8')
  const publicKey = (await readFile(publicPath, 'utf8')).trim()
  if (publicKeyFor(privatePem) !== publicKey) throw new Error('This private key does not match the public key bundled in the app.')
  const token = createReviewToken(privatePem)
  if (!verifyReviewToken(token, publicKey)) throw new Error('The generated token failed verification.')
  const tokenPath = resolve(directory, 'review-token.txt')
  const instructionsPath = resolve(directory, 'play-console-instructions.txt')
  // Refuse symlinks before replacing existing output. Secrets are never printed to the terminal.
  for (const output of [tokenPath, instructionsPath]) {
    try {
      if (await realpath(output) !== output) throw new Error('Review output must not be a symlink.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 })
  await writeFile(instructionsPath, `No login. Free: 20 books. Unlimited is a one-time Google Play purchase.\n\nFor free access, open Settings > Advanced > Review access at the bottom. Paste this token and tap Activate review access:\n\n${token}\n\nReusable, no expiry; works offline and after restart. To test normal limits or checkout, tap End review access, then Settings > Upgrade or restore purchase. Review access remains in release builds.\n`, { mode: 0o600 })
  return { directory, tokenPath, instructionsPath, publicPath }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  let directory = resolve(homedir(), '.config/wovenleaf/review-access')
  let replace = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--directory' && args[i + 1]) directory = args[++i]
    else if (args[i] === '--replace-public-key' && command === 'init') replace = true
    else throw new Error(`Unknown argument: ${args[i]}`)
  }
  if (command !== 'init' && command !== 'issue') {
    throw new Error('Usage: bun run review-access init|issue [--directory /absolute/private/directory] [--replace-public-key (init only)]')
  }
  const result = command === 'init'
    ? await initializeReviewAccess(directory, bundledPublicKey, replace)
    : await issueReviewAccess(directory)
  console.log(`Review access ready.\nPublic key: ${result.publicPath}\nPrivate key directory: ${result.directory}\nToken: ${result.tokenPath}\nPlay Console instructions: ${result.instructionsPath}\nOnly the public key belongs in the app or git. Keep a secure backup of the private key.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: Error) => { console.error(error.message); process.exitCode = 1 })
}
