// A small Markdown renderer for agent replies and notes. Everything is escaped first, so an agent's text can
// never inject HTML; only the formatting below is turned back on. Links open in the user's browser.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="#" data-href="${u}">${t}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, p, u) => `${p}<a href="#" data-href="${u}">${u}</a>`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}

export function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i];
    const fence = l.match(/^\s*(```+|~~~+)\s*([\w+-]*)/);
    if (fence) {
      flush();
      const close = fence[1], buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(close)) buf.push(lines[i++]);
      i++;
      out.push(`<pre${fence[2] ? ` data-lang="${esc(fence[2])}"` : ''}><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    const hd = l.match(/^(#{1,6})\s+(.*)$/);
    if (hd) { flush(); const n = Math.min(6, hd[1].length + 2); out.push(`<h${n}>${inline(hd[2])}</h${n}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(l)) {
      flush(); const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`); continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const row = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(l); i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const li = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m && /\d/.test(m[2]) === ordered) { items.push(m[3]); i++; continue; }
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      const task = (t) => t.replace(/^\[( |x)\]\s+/i, (_, x) => `<span class="md-box${x.trim() ? ' on' : ''}"></span>`);
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((t) => `<li>${task(inline(t))}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    para.push(l.trim());
    i++;
  }
  flush();
  return out.join('');
}

// Links inside rendered Markdown open outside Argon.
export function wireLinks(root) {
  root.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-href]'); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    window.argon.openExternal && window.argon.openExternal(a.dataset.href);
  });
}
