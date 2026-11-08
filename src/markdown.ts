import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Links in a rendered note open outside the board instead of replacing it.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

// Markdown from a repo or a CLI is untrusted and this page drives terminals: it always goes through DOMPurify.
// "> [!NOTE]" blockquotes (GitHub's callout syntax) become labelled callouts.
export function renderMarkdown(md: string) {
  const html = DOMPurify.sanitize(marked.parse(md, { gfm: true, async: false }), { ADD_ATTR: ['target'] })
  return html.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/g, (_, k: string) => `<blockquote class="callout ${k.toLowerCase()}"><p><span class="callout-label">${k}</span>`)
}

// Export PDF: the page prints only this paper (see `#print-root` in styles.css); the print
// dialog's "Save as PDF" writes the file, in the browser and in the desktop app alike.
export function printPaper(html: string, title: string) {
  const root = document.createElement('div')
  root.id = 'print-root'
  root.innerHTML = `<article class="paper">${html}</article>`
  document.body.appendChild(root)
  const was = document.title
  document.title = title // the PDF's default file name
  const done = () => {
    root.remove()
    document.title = was
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  window.print()
}
