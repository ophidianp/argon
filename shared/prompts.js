// Reads a question off an agent's screen: the menus CLIs draw when they need an answer (permissions,
// "trust this folder", sign-in method). Pure, so it can be tested on captured screens.
// Anything that does not look exactly like a menu is not one: the person then uses the terminal.
const RULE = /^[─━╌┄-]{20,}$/
const NUMBERED = /^\s*([❯›>])?\s*(\d+)\.\s+(.*\S)\s*$/
const POINTED = /^\s*[❯›>]\s+(.*\S)\s*$/
const KEYS_HINT = /enter to (confirm|select)|esc to (cancel|go back)/i
const MAX_FOOTER = 3 // "Esc to cancel": a real menu is the last thing on screen, a reply list is followed by the input box
const MAX_QUESTION = 16
const MAX_PLAIN_OPTIONS = 9

const unboxed = (line) => line.replace(/^\s*[│┃]\s?/, ' ').replace(/\s*[│┃]\s*$/, '').trimEnd()

const hash = (text) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

// "❯ 1. Yes / 2. No", with options that may wrap onto a second line.
function numberedMenu(lines) {
  let end = lines.length - 1
  let footer = 0
  while (end >= 0 && !NUMBERED.test(lines[end])) {
    if (lines[end].trim() && ++footer > MAX_FOOTER) return null
    end--
  }
  if (end < 0) return null
  const found = []
  let extra = []
  let i = end
  for (; i >= 0; i--) {
    const m = lines[i].match(NUMBERED)
    if (m) {
      found.unshift({ pointed: !!m[1], n: Number(m[2]), text: [m[3], ...extra].join(' ') })
      extra = []
      if (m[2] === '1') break
    } else if (/^\s{3,}\S/.test(lines[i])) {
      extra.unshift(lines[i].trim())
    } else return null
  }
  if (i < 0 || found.some((o, k) => o.n !== k + 1)) return null
  return { found, top: i }
}

// "❯ No, exit / Yes, I trust this folder" with no numbers. Without numbers a list looks like anything,
// so only the "Enter to confirm" line under it makes it a menu.
function plainMenu(lines) {
  let end = lines.length - 1
  let footer = 0
  while (end >= 0 && !KEYS_HINT.test(lines[end])) {
    if (lines[end].trim() && ++footer >= MAX_FOOTER) return null
    end--
  }
  if (end < 0) return null
  end--
  while (end >= 0 && !lines[end].trim()) end--
  const found = []
  let i = end
  for (; i >= 0 && lines[i].trim(); i--) {
    const m = lines[i].match(POINTED)
    found.unshift({ pointed: !!m, text: m ? m[1] : lines[i].trim() })
  }
  return found.length <= MAX_PLAIN_OPTIONS ? { found, top: i + 1 } : null
}

// -> null, or { id, question, options: [{ label, hint }], selected }. `id` ignores the pointer:
// moving through the menu does not change what is being asked.
export function parseAsk(screen) {
  const lines = String(screen).split('\n').map(unboxed)
  const menu = numberedMenu(lines) ?? plainMenu(lines)
  if (!menu || menu.found.length < 2) return null
  const selected = menu.found.findIndex((o) => o.pointed)
  if (selected < 0 || menu.found.filter((o) => o.pointed).length > 1) return null

  const above = []
  for (let j = menu.top - 1; j >= 0 && above.length < MAX_QUESTION; j--) {
    const t = lines[j].trim()
    if (/^[╭┌]/.test(t) || (RULE.test(t) && t[0] !== '╌')) break
    if (!RULE.test(t)) above.unshift(t)
  }
  // A tip is advertising, not the question. When a long one wraps, only its short tail goes with it:
  // what lies below may be the very command being asked about, so nothing else is ever dropped.
  const tip = above.findIndex((t) => t.startsWith('Tip:'))
  if (tip >= 0) above.splice(tip, above[tip].length > 60 && above[tip + 1] && above[tip + 1].length < 25 ? 2 : 1)
  const question = above.join('\n').replace(/\n{2,}/g, '\n').trim()
  const options = menu.found.map((o) => {
    const [label, ...rest] = o.text.split(' · ')
    return { label: label.trim(), hint: rest.join(' · ').trim() }
  })
  return { id: hash(question + '\n' + options.map((o) => o.label).join('\n')), question, options, selected }
}

// A refusal leaves the agent at its prompt; anything else sets it back to work.
export const isRefusal = (label) => /^no\b/i.test(label)
