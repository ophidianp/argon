// node-pty's spawn helper must be executable on macOS and Linux; Windows needs nothing.
import fs from 'node:fs'
import path from 'node:path'
if (process.platform !== 'win32') {
  const dir = path.join('node_modules', 'node-pty', 'prebuilds')
  for (const d of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const f = path.join(dir, d, 'spawn-helper')
    try { fs.chmodSync(f, 0o755) } catch {}
  }
}
