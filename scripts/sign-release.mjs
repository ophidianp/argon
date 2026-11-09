// Signs the installer in release/ for the updater: writes Argon-<version>-setup.exe.sig next to it, in the format
// Tauri's signer uses (base64 of a minisign signature). Upload the .sig to the GitHub release with the installer and
// latest.yml; without it, Argon refuses the update.
//
//   TAURI_SIGNING_PRIVATE_KEY=<key file contents or path>  TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<password, may be empty>
//   node scripts/sign-release.mjs [installer.exe]
//
// The key is read from the environment only and never printed.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const file = path.resolve(process.argv[2] || path.join(ROOT, 'release', `Argon-${version}-setup.exe`))

if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  console.error('Set TAURI_SIGNING_PRIVATE_KEY (the key file or its contents) and TAURI_SIGNING_PRIVATE_KEY_PASSWORD first.')
  process.exit(1)
}
if (!fs.existsSync(file)) {
  console.error(`No installer at ${file}. Run npm run dist first.`)
  process.exit(1)
}

const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '' }
const r = spawnSync('npx', ['--yes', '@tauri-apps/cli@2', 'signer', 'sign', file], { env, encoding: 'utf8', shell: process.platform === 'win32' })
const sig = `${file}.sig`
if (r.status !== 0 || !fs.existsSync(sig)) {
  // stderr can mention the key's path, never its contents.
  console.error(`Signing failed${r.stderr ? `: ${r.stderr.trim().split('\n').pop()}` : '.'}`)
  process.exit(1)
}

// Check it the way the app will, before anyone uploads it.
const { verify } = createRequire(import.meta.url)('../desktop/minisign.cjs')
verify(fs.readFileSync(file), fs.readFileSync(sig, 'utf8'))
console.log(`Signed and checked: ${path.relative(ROOT, sig)}`)
console.log('Upload it to the GitHub release with the installer, its .blockmap and latest.yml.')
