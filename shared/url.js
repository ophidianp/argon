// What was typed in a web tile's address field: an address gets a scheme, anything else becomes a search.
/** @param {string} input */
export function toUrl(input) {
  const s = input.trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  if (/^:\d+/.test(s)) return `http://localhost${s}`
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(s)) return `http://${s}`
  if (!/\s/.test(s) && /\.[a-z]{2,}(:\d+)?(\/|$)/i.test(s)) return `https://${s}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`
}
