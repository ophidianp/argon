// The Studios' view of a project folder: its tree, and reading or writing one file in it.
// Every path is resolved inside the root and checked again after symlinks are followed, so neither
// "../" nor a link pointing elsewhere can reach outside the project.
import fs from 'node:fs'
import path from 'node:path'
import { noteLinks } from '../shared/notes.js'

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache', 'coverage', '.venv', '__pycache__', '.DS_Store'])
const MAX_ENTRIES = 5000
export const MAX_READ = 1024 * 1024

function inside(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes('\0')) throw new Error('not a path inside the project')
  const base = fs.realpathSync(root)
  const full = path.resolve(base, rel)
  if (!full.startsWith(base + path.sep)) throw new Error('not a path inside the project')
  // The deepest part that exists, with its links followed, must still be inside.
  let probe = full
  while (!fs.existsSync(probe)) probe = path.dirname(probe)
  const real = fs.realpathSync(probe)
  if (real !== base && !real.startsWith(base + path.sep)) throw new Error('that path leads outside the project')
  return full
}

// Folders first, then files, both by name; the usual build and dependency folders are left out.
export function tree(root, only) {
  let count = 0
  const walk = (dir, rel) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return [] // a folder we may not read
    }
    const out = []
    for (const e of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
      if (SKIP.has(e.name) || count >= MAX_ENTRIES) continue
      const p = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        const children = walk(path.join(dir, e.name), p)
        if (!only || children.length) out.push({ name: e.name, path: p, dir: true, children })
      } else if (e.isFile() && (!only || only.test(e.name))) {
        count++
        out.push({ name: e.name, path: p })
      }
    }
    return out
  }
  return { entries: walk(fs.realpathSync(root), ''), truncated: count >= MAX_ENTRIES }
}

export function read(root, rel) {
  const file = inside(root, rel)
  const st = fs.statSync(file)
  if (!st.isFile()) throw new Error('not a file')
  if (st.size > MAX_READ) throw new Error('this file is too big to open here (over 1 MB)')
  const body = fs.readFileSync(file)
  if (body.includes(0)) throw new Error('this is a binary file')
  return { path: rel, text: body.toString('utf8'), size: st.size }
}

// Saving overwrites; `create` makes a new file (and its folders) and refuses an existing one.
export function write(root, rel, text, create = false) {
  if (typeof text !== 'string') throw new Error('nothing to save')
  if (Buffer.byteLength(text) > MAX_READ) throw new Error('too big to save (over 1 MB)')
  const file = inside(root, rel)
  if (create) {
    if (fs.existsSync(file)) throw new Error('a file with that name already exists')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    inside(root, rel) // the new folders must not have walked through a link
  } else if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('no such file')
  fs.writeFileSync(file, text)
  return { path: rel, size: Buffer.byteLength(text) }
}

// Every note and the notes it links to, for the Markdown studio's link graph.
// ponytail: reads every note on each call; cache by mtime if a repo brings thousands of notes.
export function links(root) {
  const notes = []
  const walk = (entries) => entries.forEach((e) => (e.dir ? walk(e.children) : notes.push(e.path)))
  walk(tree(root, /\.(md|mdx|markdown)$/i).entries)
  const edges = []
  for (const from of notes) {
    let text
    try {
      text = read(root, from).text
    } catch {
      continue // too big or unreadable: it stays a note without links
    }
    for (const to of noteLinks(from, text, notes)) edges.push([from, to])
  }
  return { notes, links: edges }
}
