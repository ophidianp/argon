// The updater's minisign check (desktop/minisign.cjs): it must accept Argon's own signatures and refuse anything else.
// Signing with the real key needs TAURI_SIGNING_PRIVATE_KEY (and _PASSWORD); without them that part is skipped and a
// throwaway key made here covers the same checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const { verify, ARGON_PUBKEY } = createRequire(import.meta.url)('../desktop/minisign.cjs')

// A minisign key pair and signer in plain Node, the same format as `tauri signer`.
function throwawayKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const keyId = crypto.randomBytes(8)
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url')
  const pub = Buffer.from(`untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')}\n`).toString('base64')
  const sign = (data, { alg = 'ED', id = keyId, trusted = 'timestamp:1\tfile:x.exe' } = {}) => {
    const msg = alg === 'ED' ? crypto.createHash('blake2b512').update(data).digest() : data
    const sig = crypto.sign(null, msg, privateKey)
    const global = crypto.sign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey)
    const text = `untrusted comment: signature\n${Buffer.concat([Buffer.from(alg), id, sig]).toString('base64')}\ntrusted comment: ${trusted}\n${global.toString('base64')}\n`
    return Buffer.from(text).toString('base64')
  }
  return { pub, sign }
}

test('accepts a good signature, prehashed or not, and refuses a changed byte, another key, a changed comment, no .sig', () => {
  const k = throwawayKey()
  const data = crypto.randomBytes(5000)
  assert.ok(verify(data, k.sign(data), k.pub))
  assert.ok(verify(data, k.sign(data, { alg: 'Ed' }), k.pub))
  const changed = Buffer.from(data)
  changed[10] ^= 1
  assert.throws(() => verify(changed, k.sign(data), k.pub), /does not match/)
  assert.throws(() => verify(data, k.sign(data, { id: crypto.randomBytes(8) }), k.pub), /different key/)
  const tampered = Buffer.from(Buffer.from(k.sign(data), 'base64').toString().replace('file:x.exe', 'file:y.exe')).toString('base64')
  assert.throws(() => verify(data, tampered, k.pub), /trusted comment/)
  assert.throws(() => verify(data, '', k.pub))
  assert.throws(() => verify(data, k.sign(data), ARGON_PUBKEY), /different key/, "a stranger's signature fails against Argon's key")
})

test('a file signed with the real Argon key through the Tauri CLI', { skip: !process.env.TAURI_SIGNING_PRIVATE_KEY && 'TAURI_SIGNING_PRIVATE_KEY not set' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argon-sig-'))
  const file = path.join(dir, 'Argon-test-setup.exe')
  fs.writeFileSync(file, crypto.randomBytes(20000))
  const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '' }
  const r = spawnSync('npx', ['--yes', '@tauri-apps/cli@2', 'signer', 'sign', file], { env, encoding: 'utf8', shell: process.platform === 'win32' })
  assert.equal(r.status, 0, 'the Tauri signer failed')
  const data = fs.readFileSync(file)
  const sig = fs.readFileSync(`${file}.sig`, 'utf8')
  assert.ok(verify(data, sig).trusted.includes('Argon-test-setup.exe'))
  data[100] ^= 1
  assert.throws(() => verify(data, sig), /does not match/)
  // The same signature with its key id changed.
  const text = Buffer.from(sig, 'base64').toString()
  const ls = text.split('\n')
  const raw = Buffer.from(ls[1], 'base64')
  raw[2] ^= 0xff
  ls[1] = raw.toString('base64')
  assert.throws(() => verify(fs.readFileSync(file), Buffer.from(ls.join('\n')).toString('base64')), /different key/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("the BLAKE2b-512 fallback (Electron's crypto has none) matches Node's", () => {
  const { blake2b512 } = createRequire(import.meta.url)('../desktop/blake2b.cjs')
  assert.equal(blake2b512(Buffer.from('abc'), { forceJs: true }).toString('hex').slice(0, 32), 'ba80a53f981c4d0d6a2797b69f12f6e9', 'RFC 7693 test vector')
  for (const n of [0, 1, 127, 128, 129, 256, 257, 10_000]) {
    const d = crypto.randomBytes(n)
    assert.ok(blake2b512(d, { forceJs: true }).equals(crypto.createHash('blake2b512').update(d).digest()), `length ${n}`)
  }
})

test('verifyFile checks a file in a worker thread', async () => {
  const { verifyFile } = createRequire(import.meta.url)('../desktop/minisign.cjs')
  const k = throwawayKey()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argon-vf-'))
  const file = path.join(dir, 'x.exe')
  const data = crypto.randomBytes(3000)
  fs.writeFileSync(file, data)
  assert.ok((await verifyFile(file, k.sign(data), k.pub)).trusted)
  await assert.rejects(verifyFile(file, k.sign(crypto.randomBytes(10)), k.pub), /does not match/)
  fs.rmSync(dir, { recursive: true, force: true })
})

// desktop/updater.cjs replaces this method so our check runs; if electron-updater drops it, updates turn off.
test('electron-updater still has the verifySignature the updater replaces', () => {
  const { NsisUpdater } = createRequire(import.meta.url)('electron-updater')
  assert.equal(typeof NsisUpdater.prototype.verifySignature, 'function')
})

test('the embedded public key is the one in ~/.tauri, when that file is here', (t) => {
  const pubFile = path.join(os.homedir(), '.tauri', 'argon-updater.key.pub')
  if (!fs.existsSync(pubFile)) return t.skip('no key file on this PC')
  assert.equal(fs.readFileSync(pubFile, 'utf8').trim(), ARGON_PUBKEY)
})
