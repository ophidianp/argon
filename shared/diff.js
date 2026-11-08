// Unified diff text (git diff / git show) -> files, hunks and numbered lines for the diff viewer.

/**
 * @typedef {{ kind: 'add' | 'del' | 'ctx', old: number | null, new: number | null, text: string }} DiffLine
 * @typedef {{ header: string, lines: DiffLine[] }} Hunk
 * @typedef {{ path: string, from: string | null, binary: boolean, add: number, del: number, hunks: Hunk[] }} DiffFile
 */

/** @param {string} text @returns {DiffFile[]} */
export function parseDiff(text) {
  /** @type {DiffFile[]} */
  const files = []
  /** @type {DiffFile | null} */
  let file = null
  /** @type {Hunk | null} */
  let hunk = null
  let oldNo = 0
  let newNo = 0
  const start = (path) => {
    file = { path, from: null, binary: false, add: 0, del: 0, hunks: [] }
    files.push(file)
    hunk = null
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.*) b\/(.*)$/)
      start(m ? m[2] : line.slice(11))
      continue
    }
    if (!file && line.startsWith('@@')) start('') // a bare hunk (a new file shown on its own)
    if (!file) continue
    if (line.startsWith('rename from ')) file.from = line.slice(12)
    else if (line.startsWith('Binary files ')) file.binary = true
    else if (line.startsWith('+++ ') && !hunk) {
      const p = line.slice(4)
      if (p !== '/dev/null') file.path = p.replace(/^b\//, '')
    } else if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      oldNo = m ? Number(m[1]) : 0
      newNo = m ? Number(m[2]) : 0
      hunk = { header: line, lines: [] }
      file.hunks.push(hunk)
    } else if (hunk && line.startsWith('+')) {
      hunk.lines.push({ kind: 'add', old: null, new: newNo++, text: line.slice(1) })
      file.add++
    } else if (hunk && line.startsWith('-')) {
      hunk.lines.push({ kind: 'del', old: oldNo++, new: null, text: line.slice(1) })
      file.del++
    } else if (hunk && line.startsWith(' ')) hunk.lines.push({ kind: 'ctx', old: oldNo++, new: newNo++, text: line.slice(1) })
  }
  return files
}
