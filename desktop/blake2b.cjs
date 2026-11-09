// BLAKE2b-512 (RFC 7693), unkeyed. Electron's crypto (BoringSSL) has no blake2b512, and minisign's prehashed
// signatures sign that hash of the file. Node's own is used when it exists; this is the fallback.
// 64-bit words are kept as pairs of 32-bit halves (low, high) in typed arrays, for speed without BigInt.
const crypto = require('node:crypto')

const IV = new Uint32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a, 0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b,
  0x1f83d9ab, 0x137e2179, 0x5be0cd19,
])
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
]
// Word indexes doubled, for the (low, high) layout.
const SIGMA2 = SIGMA.concat(SIGMA.slice(0, 2)).map((r) => r.map((x) => x * 2))

const v = new Uint32Array(32)
const m = new Uint32Array(32)

// v[a] += v[b] (64-bit), and v[a] += (lo, hi).
function add64(a, b) {
  const lo = v[a] + v[b]
  v[a + 1] = v[a + 1] + v[b + 1] + (lo >= 0x100000000 ? 1 : 0)
  v[a] = lo
}
function add64c(a, lo0, hi0) {
  const lo = v[a] + lo0
  v[a + 1] = v[a + 1] + hi0 + (lo >= 0x100000000 ? 1 : 0)
  v[a] = lo
}
function G(a, b, c, d, ix, iy) {
  add64(a, b)
  add64c(a, m[ix], m[ix + 1])
  // d = (d ^ a) >>> 32
  let xlo = v[d] ^ v[a]
  let xhi = v[d + 1] ^ v[a + 1]
  v[d] = xhi
  v[d + 1] = xlo
  add64(c, d)
  // b = (b ^ c) >>> 24
  xlo = v[b] ^ v[c]
  xhi = v[b + 1] ^ v[c + 1]
  v[b] = (xlo >>> 24) ^ (xhi << 8)
  v[b + 1] = (xhi >>> 24) ^ (xlo << 8)
  add64(a, b)
  add64c(a, m[iy], m[iy + 1])
  // d = (d ^ a) >>> 16
  xlo = v[d] ^ v[a]
  xhi = v[d + 1] ^ v[a + 1]
  v[d] = (xlo >>> 16) ^ (xhi << 16)
  v[d + 1] = (xhi >>> 16) ^ (xlo << 16)
  add64(c, d)
  // b = (b ^ c) >>> 63, i.e. rotate left by 1
  xlo = v[b] ^ v[c]
  xhi = v[b + 1] ^ v[c + 1]
  v[b] = (xhi >>> 31) ^ (xlo << 1)
  v[b + 1] = (xlo >>> 31) ^ (xhi << 1)
}

function compress(h, block, off, t, last) {
  for (let i = 0; i < 16; i++) {
    v[i] = h[i]
    v[i + 16] = IV[i]
  }
  // t is at most 2^53, so its high 32 bits fit in a double.
  v[24] ^= t >>> 0
  v[25] ^= Math.floor(t / 0x100000000)
  if (last) {
    v[28] = ~v[28]
    v[29] = ~v[29]
  }
  for (let i = 0; i < 32; i++) {
    const p = off + i * 4
    m[i] = block[p] ^ (block[p + 1] << 8) ^ (block[p + 2] << 16) ^ (block[p + 3] << 24)
  }
  for (let r = 0; r < 12; r++) {
    const s = SIGMA2[r]
    G(0, 8, 16, 24, s[0], s[1])
    G(2, 10, 18, 26, s[2], s[3])
    G(4, 12, 20, 28, s[4], s[5])
    G(6, 14, 22, 30, s[6], s[7])
    G(0, 10, 20, 30, s[8], s[9])
    G(2, 12, 22, 24, s[10], s[11])
    G(4, 14, 16, 26, s[12], s[13])
    G(6, 8, 18, 28, s[14], s[15])
  }
  for (let i = 0; i < 16; i++) h[i] ^= v[i] ^ v[i + 16]
}

function blake2b512js(data) {
  const h = new Uint32Array(IV)
  h[0] ^= 0x01010000 ^ 64 // digest length 64, no key, fanout 1, depth 1
  const n = data.length
  let off = 0
  // Every full block but the last is compressed as it comes; the last (possibly partial) one is padded.
  while (n - off > 128) {
    compress(h, data, off, off + 128, false)
    off += 128
  }
  const tail = new Uint8Array(128)
  tail.set(data.subarray(off))
  compress(h, tail, 0, n, true)
  const out = Buffer.alloc(64)
  for (let i = 0; i < 16; i++) out.writeUInt32LE(h[i] >>> 0, i * 4)
  return out
}

let native = null
try {
  crypto.createHash('blake2b512')
  native = true
} catch {
  native = false
}

/** BLAKE2b-512 of `data` (a Buffer or Uint8Array). */
function blake2b512(data, { forceJs = false } = {}) {
  if (native && !forceJs) return crypto.createHash('blake2b512').update(data).digest()
  return blake2b512js(data)
}

module.exports = { blake2b512 }
