// The slash commands a console's agent understands, for the simple view's menu: the CLI's built-ins
// (shared/slash.js), plus, for Claude Code, custom commands and skills from the project, the user's config folder
// and enabled plugins. Only names and descriptions are read; no file's contents leave this module.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BUILTIN_COMMANDS } from '../shared/slash.js'

const HEAD_BYTES = 8 * 1024 // frontmatter and the first lines are all we look at
const CACHE_MS = 30 * 1000
const MAX_DESC = 140
const cache = new Map()

const isDir = (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } }
const isFile = (p) => { try { return fs.statSync(p).isFile() } catch { return false } }
const list = (dir) => { try { return fs.readdirSync(dir) } catch { return [] } }

function head(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(HEAD_BYTES)
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0)
    return buf.subarray(0, n).toString('utf8').replace(/^﻿/, '')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

const unquote = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2').trim()
const clip = (s) => (s.length > MAX_DESC ? s.slice(0, MAX_DESC - 1).trimEnd() + '…' : s)

// name, description and user-invocable from YAML frontmatter (flat keys, plain or folded strings), else the
// first line of the text.
export function meta(text) {
  const out = {}
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (fm) {
    const lines = fm[1].split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const m = /^([\w-]+):\s*(.*)$/.exec(lines[i])
      if (!m) continue
      let v = m[2]
      if (/^[>|][+-]?$/.test(v.trim())) {
        const parts = []
        while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim())
        v = parts.join(' ')
      }
      out[m[1].toLowerCase()] = unquote(v)
    }
  }
  if (!out.description) {
    const body = fm ? text.slice(fm[0].length) : text
    const first = body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean)
    if (first) out.description = first
  }
  if (out.description) out.description = clip(out.description.replace(/\s+/g, ' '))
  return out
}

// .claude/commands/**/*.md: the file name is the command.
function commandsIn(dir, prefix, source) {
  const found = []
  const walk = (d, depth) => {
    for (const f of list(d)) {
      const p = path.join(d, f)
      if (depth < 4 && isDir(p)) walk(p, depth + 1)
      else if (f.toLowerCase().endsWith('.md') && isFile(p)) {
        const m = meta(head(p))
        found.push({ name: prefix + f.slice(0, -3), description: m.description || '', source })
      }
    }
  }
  walk(dir, 0)
  return found
}

// skills/<name>/SKILL.md: the frontmatter's name, or the folder's.
function skillsIn(dir, prefix, source) {
  const found = []
  for (const f of list(dir)) {
    const file = path.join(dir, f, 'SKILL.md')
    if (!isFile(file)) continue
    const m = meta(head(file))
    if (m['user-invocable'] === 'false') continue
    found.push({ name: prefix + (m.name || f), description: m.description || '', source })
  }
  return found
}

// The project folder and the folders above it, as far as the home folder (Claude Code reads .claude in each).
function projectDirs(cwd) {
  const out = []
  const home = path.resolve(os.homedir())
  let d = cwd ? path.resolve(cwd) : null
  while (d) {
    out.push(d)
    if (d.toLowerCase() === home.toLowerCase()) break
    const up = path.dirname(d)
    if (up === d) break
    d = up
  }
  return out
}

function enabledPlugins(configDir) {
  let installed = {}, enabled = null
  try { installed = JSON.parse(fs.readFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {} } catch {}
  try { enabled = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8')).enabledPlugins ?? null } catch {}
  const out = []
  for (const [key, installs] of Object.entries(installed)) {
    if (enabled && enabled[key] !== true) continue
    const where = Array.isArray(installs) ? installs.find((i) => i?.installPath && isDir(i.installPath)) : null
    if (where) out.push({ name: key.split('@')[0], dir: where.installPath })
  }
  return out
}

function claudeExtras(cwd, configDir) {
  const found = []
  for (const d of projectDirs(cwd)) {
    if (path.resolve(d, '.claude') === path.resolve(configDir)) continue // the home folder's .claude is the user's
    found.push(...commandsIn(path.join(d, '.claude', 'commands'), '', 'project'), ...skillsIn(path.join(d, '.claude', 'skills'), '', 'project'))
  }
  found.push(...commandsIn(path.join(configDir, 'commands'), '', 'user'), ...skillsIn(path.join(configDir, 'skills'), '', 'user'))
  for (const p of enabledPlugins(configDir)) found.push(...commandsIn(path.join(p.dir, 'commands'), `${p.name}:`, 'plugin'), ...skillsIn(path.join(p.dir, 'skills'), `${p.name}:`, 'plugin'))
  return found
}

/** The menu's list for one console: [{ name, description, source }]. Built-ins first; the first of a name wins. */
export function slashCommands({ agentId, cwd, configDir }) {
  const builtins = BUILTIN_COMMANDS[agentId]
  if (!builtins) return []
  const key = `${agentId}|${cwd || ''}|${configDir || ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list
  const all = [...builtins.map((c) => ({ ...c, source: 'built-in' })), ...(agentId === 'claude' && configDir ? claudeExtras(cwd, configDir) : [])]
  const seen = new Set()
  const out = all.filter((c) => /^[\w:.-]{1,80}$/.test(c.name) && !seen.has(c.name) && seen.add(c.name))
  cache.set(key, { at: Date.now(), list: out })
  return out
}
