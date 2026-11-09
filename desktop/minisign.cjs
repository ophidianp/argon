// Checks an update installer against its minisign signature, the format Tauri's signer writes (`tauri signer sign`):
// the .sig file is base64 of a minisign signature text, and the public key is base64 of a minisign public key text.
// Plain Node crypto, so it runs in Electron's main process and in the tests alike.
const crypto = require('node:crypto')
const { blake2b512 } = require('./blake2b.cjs')

// Argon's release key (C:\Users\neman\.tauri\argon-updater.key.pub). Public by design.
const ARGON_PUBKEY =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDMwNEM0NDY5N0M4NDEwNUEKUldSYUVJUjhhVVJNTUJ1dUtWZC9UNDN1Q3UrZ2NWWWJJdGdMd0F3cTE0b2lncGtVN2hoU1pkdEgK'

// A minisign text may come wrapped in one more layer of base64 (Tauri does that); take either.
function minisignText(input) {
  const s = Buffer.isBuffer(input) ? input.toString('utf8') : String(input)
  if (/untrusted comment:/.test(s)) return s
  const decoded = Buffer.from(s.trim(), 'base64').toString('utf8')
  if (/untrusted comment:/.test(decoded)) return decoded
  throw new Error('not a minisign text')
}
const lines = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

function parsePublicKey(input) {
  const [, b64] = lines(minisignText(input))
  const raw = Buffer.from(b64 || '', 'base64')
  if (raw.length !== 42 || raw.subarray(0, 2).toString('latin1') !== 'Ed') throw new Error('not a minisign Ed25519 public key')
  const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.subarray(10).toString('base64url') }, format: 'jwk' })
  return { keyId: raw.subarray(2, 10), key }
}

function parseSignature(input) {
  const l = lines(minisignText(input))
  const sigLine = l.find((x, i) => i > 0 && !/^(untrusted|trusted) comment:/.test(x))
  const trusted = l.find((x) => x.startsWith('trusted comment: '))
  const global = trusted ? l[l.indexOf(trusted) + 1] : undefined
  const raw = Buffer.from(sigLine || '', 'base64')
  const alg = raw.subarray(0, 2).toString('latin1')
  if (raw.length !== 74 || (alg !== 'Ed' && alg !== 'ED')) throw new Error('not a minisign signature')
  if (!trusted || !global) throw new Error('the signature has no trusted comment')
  return { alg, keyId: raw.subarray(2, 10), sig: raw.subarray(10), trusted: trusted.slice('trusted comment: '.length), global: Buffer.from(global, 'base64') }
}

/**
 * Throws unless `data` (the installer's bytes) carries a valid signature from `pubkey`.
 * Checks the key id, the signature over the file (or its BLAKE2b-512 hash, for prehashed "ED" signatures),
 * and the global signature over the signature plus its trusted comment.
 */
function verify(data, sigText, pubkey = ARGON_PUBKEY) {
  const pk = parsePublicKey(pubkey)
  const s = parseSignature(sigText)
  if (!s.keyId.equals(pk.keyId)) throw new Error('signed with a different key')
  const msg = s.alg === 'ED' ? blake2b512(data) : data
  if (!crypto.verify(null, msg, pk.key, s.sig)) throw new Error('the signature does not match the file')
  if (!crypto.verify(null, Buffer.concat([s.sig, Buffer.from(s.trusted, 'utf8')]), pk.key, s.global)) throw new Error('the trusted comment was changed')
  return { trusted: s.trusted }
}

/** The same check on a file, in a worker thread: hashing a large installer would otherwise stall the window. */
function verifyFile(file, sigText, pubkey = ARGON_PUBKEY) {
  const { Worker } = require('node:worker_threads')
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { file, sigText, pubkey } })
    w.once('message', (r) => (r.error ? reject(new Error(r.error)) : resolve(r)))
    w.once('error', reject)
    w.once('exit', (code) => code && reject(new Error('the signature check stopped')))
  })
}

module.exports = { ARGON_PUBKEY, verify, verifyFile, parsePublicKey, parseSignature }

const wt = require('node:worker_threads')
if (!wt.isMainThread && wt.workerData && wt.workerData.sigText !== undefined) {
  const { file, sigText, pubkey } = wt.workerData
  try {
    wt.parentPort.postMessage(verify(require('node:fs').readFileSync(file), sigText, pubkey))
  } catch (e) {
    wt.parentPort.postMessage({ error: e.message })
  }
}
