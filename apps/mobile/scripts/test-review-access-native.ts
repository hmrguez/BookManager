import { generateKeyPairSync, sign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReviewToken, publicKeyFor } from './review-access.ts'

const directory = await mkdtemp(join(tmpdir(), 'wovenleaf-review-native-'))
const mobile = fileURLToPath(new URL('../', import.meta.url))
const privateKey = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey
const key = privateKey()
const publicKey = publicKeyFor(key)
const token = createReviewToken(key)
const changed = Buffer.from(token.slice(5), 'base64url')
changed[changed.length - 1] ^= 1
const cases: [string, string, boolean][] = [
  [token, publicKey, true], [token, publicKeyFor(privateKey()), false],
  [createReviewToken(privateKey()), publicKey, false],
  [`WLR1.${changed.toString('base64url')}`, publicKey, false],
  [`WLR1.${sign('sha256', Buffer.from('another-app:review:unlimited'), key).toString('base64url')}`, publicKey, false],
  [token.replace('WLR1', 'WLR2'), publicKey, false], [`${token}.extra`, publicKey, false],
  [`${token}\n`, publicKey, false], ['', publicKey, false], ['true', publicKey, false],
  [`WLR1.${'A'.repeat(500)}`, publicKey, false], [token, '', false], [token, 'invalid', false],
]
// Base64 protects test framing for empty strings, newlines, and malformed tokens.
const input = cases.map(([candidate, pub, expected]) =>
  `${Buffer.from(candidate).toString('base64')}\t${Buffer.from(pub).toString('base64')}\t${expected}`,
).join('\n') + '\n'

function run(command: string, args: string[], stdin?: string) {
  const result = spawnSync(command, args, { input: stdin, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr}`)
  if (result.stdout.trim()) console.log(result.stdout.trim())
}

try {
  const javaHome = spawnSync('/usr/libexec/java_home', [], { encoding: 'utf8' }).stdout?.trim()
  const javaBin = javaHome ? join(javaHome, 'bin') : ''
  const javaFile = join(directory, 'ReviewVerifierTest.java')
  await writeFile(javaFile, `import com.hmrguez.wovenleaf.ReviewAccessVerifier;
import java.util.*;
import java.nio.charset.StandardCharsets;
public class ReviewVerifierTest {
  public static void main(String[] args) {
    Scanner input = new Scanner(System.in); int count = 0;
    while (input.hasNextLine()) {
      String[] fields = input.nextLine().split("\\t", -1);
      String token = new String(Base64.getDecoder().decode(fields[0]), StandardCharsets.UTF_8);
      String key = new String(Base64.getDecoder().decode(fields[1]), StandardCharsets.UTF_8);
      if (ReviewAccessVerifier.verify(token, key) != Boolean.parseBoolean(fields[2]))
        throw new AssertionError("Java verification case " + count);
      count++;
    }
    System.out.println("Android Java verifier: " + count + " cases passed");
  }
}`)
  run(javaBin ? join(javaBin, 'javac') : 'javac', ['-d', directory,
    join(mobile, 'android/app/src/main/java/com/hmrguez/wovenleaf/ReviewAccessVerifier.java'), javaFile])
  run(javaBin ? join(javaBin, 'java') : 'java', ['-cp', directory, 'ReviewVerifierTest'], input)
  const swiftFile = join(directory, 'main.swift')
  await writeFile(swiftFile, `import Foundation
var count = 0
while let line = readLine() {
    let fields = line.split(separator: "\\t", omittingEmptySubsequences: false).map(String.init)
    let token = String(data: Data(base64Encoded: fields[0])!, encoding: .utf8)!
    let key = String(data: Data(base64Encoded: fields[1])!, encoding: .utf8)!
    precondition(ReviewAccessVerifier.verify(token, publicKeyDER: key) == (fields[2] == "true"), "Swift verification case \\(count)")
    count += 1
}
print("iOS CryptoKit verifier: \\(count) cases passed")
`)
  run('swiftc', ['-module-cache-path', join(directory, 'swift-cache'),
    join(mobile, 'ios/App/App/ReviewAccessVerifier.swift'), swiftFile, '-o', join(directory, 'verify-swift')])
  run(join(directory, 'verify-swift'), [], input)
} finally { await rm(directory, { recursive: true, force: true }) }
