import { memo, useEffect, useMemo, useState } from 'react'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { ExternalLink, FileDown, FileText, Network, PanelTop, Plus, Search, X } from 'lucide-react'
import { api, type FileEntry } from '../api'
import { insertCard } from '../board'
import { project, useStore } from '../store'
import { countWords, readMinutes } from '../../shared/docs.js'
import { layoutGraph, resolveLink } from '../../shared/notes.js'
import { printPaper, renderMarkdown } from '../markdown'
import { FileTree, PathInput } from './CodeStudio'
import { CodeView } from './CodeView'

type View = 'reading' | 'source' | 'graph'
const MD = /\.(md|mdx|markdown)$/i
const noteName = (path: string) => (path.split('/').pop() ?? path).replace(MD, '')
const flatten = (entries: FileEntry[]): string[] => entries.flatMap((e) => (e.dir ? flatten(e.children ?? []) : [e.path]))

// [[note]] and [[note|label]] become links the reader resolves by note name.
const wikiLinks = (md: string) => md.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, name: string, label?: string) => `[${(label ?? name).trim()}](#wiki:${encodeURIComponent(name.trim())})`)

// Rendered Markdown on the dark page. A link to another note opens it here; links inside the repo
// never leave the board, web links open in a new tab.
function Reading({ text, from, notes, onOpen }: { text: string; from?: string; notes?: string[]; onOpen?: (path: string) => void }) {
  const html = useMemo(() => renderMarkdown(wikiLinks(text)), [text])
  return (
    <article
      className="paper dark"
      onClick={(e) => {
        const href = (e.target as HTMLElement).closest('a')?.getAttribute('href')
        if (!href || /^[a-z][\w+.-]*:/i.test(href)) return
        e.preventDefault()
        if (!onOpen || !notes) return
        let target: string | null | undefined
        try {
          if (href.startsWith('#wiki:')) {
            const name = decodeURIComponent(href.slice(6)).replace(MD, '').toLowerCase()
            target = notes.find((n) => noteName(n).toLowerCase() === name)
          } else if (from) target = resolveLink(from, decodeURI(href.split('#')[0]))
        } catch {
          return // a link with a broken escape goes nowhere
        }
        if (target && notes.includes(target)) onOpen(target)
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export function MarkdownStudio() {
  const p = useStore(project)!
  const s = useStore.getState()
  const [root, setRoot] = useState(s.studioRoot ?? p.path)
  const roots = [p.path, ...(p.folders ?? [])]
  const [entries, setEntries] = useState<FileEntry[] | null>(null)
  const [query, setQuery] = useState('')
  const [file, setFile] = useState<{ path: string; saved: string; text: string } | null>(null)
  const [view, setView] = useState<View>('reading')
  const [graph, setGraph] = useState<{ notes: string[]; links: [string, string][] } | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notes = useMemo(() => flatten(entries ?? []), [entries])
  const edited = !!file && file.text !== file.saved

  const fail = (e: unknown) => setError(/not a directory/.test((e as Error).message) ? 'This folder is not there any more. Disconnect it under Context › Folders, or plug its disk in.' : (e as Error).message)
  const loadTree = () => api.tree(root, 'md').then((r) => (setEntries(r.entries), flatten(r.entries)), (e) => (fail(e), [] as string[]))
  // Edits in Source are kept: they are saved before another note or another view replaces them.
  const save = async () => {
    if (!file || !edited) return
    try {
      await api.writeFile(root, file.path, file.text)
      setFile({ ...file, saved: file.text })
    } catch (e) {
      fail(e)
      throw e
    }
  }
  const openNote = async (path: string) => {
    try {
      await save()
      const r = await api.readFile(root, path)
      setFile({ path, saved: r.text, text: r.text })
      setError(null)
      if (view === 'graph') setView('reading')
    } catch (e) {
      fail(e)
    }
  }
  const show = async (v: View) => {
    await save().catch(() => {})
    setView(v)
    if (v === 'graph') api.noteLinks(root).then(setGraph, fail)
  }

  useEffect(() => {
    loadTree().then((all) => {
      const start = s.studioPath ?? all.find((x) => /^readme\.md$/i.test(x)) ?? all[0]
      if (s.studioPath || s.studioRoot) s.set({ studioPath: null, studioRoot: null })
      if (start) openNote(start)
    })
  }, [root])

  // Another folder: what was being edited is saved in the folder it belongs to first.
  const switchRoot = async (next: string) => {
    try {
      await save()
    } catch {
      return
    }
    setFile(null)
    setEntries(null)
    setQuery('')
    setRoot(next)
  }

  const close = () => save().then(() => s.set({ modal: null }), () => {})
  const place = () => {
    if (!file) return
    insertCard('markdown', 460, 560, { root, path: file.path })
    close()
  }
  const words = file ? countWords(file.text) : 0
  const crumbs = file ? file.path.split('/') : []
  const found = query.trim() ? notes.filter((n) => n.toLowerCase().includes(query.trim().toLowerCase())) : null

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal studio md-studio">
        <aside className="studio-side">
          <div className="studio-title">
            <span className="ico">
              <FileText size={19} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>Markdown</b>
              {roots.length > 1 ? (
                <select className="root-pick" aria-label="Which folder" value={root} onChange={(e) => switchRoot(e.target.value)}>
                  {roots.map((r) => (
                    <option key={r} value={r}>
                      {r === p.path ? p.name : r.split('/').filter(Boolean).pop()}
                    </option>
                  ))}
                </select>
              ) : (
                <small>{p.name}</small>
              )}
            </span>
            <button className="icon-btn sm" title="New note" onClick={() => setCreating((v) => !v)}>
              <Plus size={15} />
            </button>
          </div>
          {creating && (
            <PathInput
              placeholder="docs/new-note.md"
              onCancel={() => setCreating(false)}
              onSubmit={async (rel) => {
                const path = MD.test(rel) ? rel : `${rel}.md`
                try {
                  await api.writeFile(root, path, `# ${noteName(path)}\n\n`, true)
                  setCreating(false)
                  await loadTree()
                  await openNote(path)
                  setView('source')
                } catch (e) {
                  fail(e)
                }
              }}
            />
          )}
          <label className="md-search">
            <Search size={13} />
            <input value={query} placeholder="Search files" onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="studio-tree nowheel">
            {found ? (
              found.map((n) => (
                <button key={n} className={`ft-row ${file?.path === n ? 'on' : ''}`} style={{ paddingLeft: 10 }} onClick={() => openNote(n)}>
                  <FileText size={14} color="var(--muted)" />
                  <span>{n.replace(MD, '')}</span>
                </button>
              ))
            ) : entries?.length ? (
              <FileTree entries={entries} current={file?.path} onOpen={openNote} label={(e) => (e.dir ? e.name : e.name.replace(MD, ''))} expanded />
            ) : (
              entries && <div className="md-none">No Markdown files in this repo yet. Add one with +.</div>
            )}
          </div>
        </aside>
        <section className="studio-main">
          <div className="studio-bar">
            {view === 'graph' ? (
              <>
                <Network size={15} color="var(--accent)" />
                <b className="md-graph-title">Link graph</b>
                <span className="meta">{graph ? `${graph.notes.length} notes` : ''}</span>
              </>
            ) : file ? (
              <>
                <FileText size={15} color="var(--muted)" />
                <span className="crumbs">
                  {crumbs.map((c, i) => (
                    <span key={i} className={i === crumbs.length - 1 ? 'last' : ''}>
                      {i === crumbs.length - 1 ? c.replace(MD, '') : c}
                    </span>
                  ))}
                </span>
                <span className="meta">
                  {words.toLocaleString()} words · ~{readMinutes(words)} min
                </span>
                {edited && <span className="edited">• Edited</span>}
              </>
            ) : (
              <span className="meta">Pick a note on the left</span>
            )}
            <span className="spacer" />
            <span className="md-views">
              {(['reading', 'source', 'graph'] as View[]).map((v) => (
                <button key={v} className={view === v ? 'on' : ''} disabled={v !== 'graph' && !file} onClick={() => show(v)}>
                  {v[0].toUpperCase() + v.slice(1)}
                </button>
              ))}
            </span>
            {view !== 'graph' && file && (
              <>
                <button className="btn sm" onClick={place} title="Put this note on the board">
                  <PanelTop size={14} /> Add to Board
                </button>
                <button className="btn primary sm" onClick={() => printPaper(renderMarkdown(file.text), noteName(file.path))}>
                  <FileDown size={14} /> Export PDF
                </button>
              </>
            )}
            <button className="icon-btn" onClick={close}>
              <X size={17} />
            </button>
          </div>
          {error && <div className="studio-error">{error}</div>}
          {view === 'graph' ? (
            <div className="md-graph">{graph && <LinkGraph notes={graph.notes} links={graph.links} current={file?.path} onOpen={openNote} />}</div>
          ) : view === 'source' && file ? (
            <div className="studio-editor">
              <CodeView text={file.saved} path={file.path} onChange={(text) => setFile((f) => f && { ...f, text })} onSave={() => save().catch(() => {})} />
            </div>
          ) : (
            <div className="docs-view nowheel">
              {file ? (
                <Reading text={file.text} from={file.path} notes={notes} onOpen={openNote} />
              ) : (
                <div className="studio-empty">
                  <FileText size={28} />
                  <b>Your repo's notes</b>
                  <span>Read every Markdown file, follow its links, see how they connect.</span>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// Notes as dots, links as lines. The open note and the notes it touches are lit and labelled.
function LinkGraph({ notes, links, current, onOpen }: { notes: string[]; links: [string, string][]; current?: string; onOpen: (path: string) => void }) {
  const W = 960
  const H = 620
  const at = useMemo(() => layoutGraph(notes, links, { width: W, height: H }), [notes, links])
  const [hover, setHover] = useState<string | null>(null)
  const focus = hover ?? current
  const near = useMemo(() => new Set(links.filter(([a, b]) => a === focus || b === focus).flat()), [links, focus])
  const degree = useMemo(() => {
    const d = new Map<string, number>()
    for (const [a, b] of links) (d.set(a, (d.get(a) ?? 0) + 1), d.set(b, (d.get(b) ?? 0) + 1))
    return d
  }, [links])
  if (!notes.length) return <div className="studio-empty">No notes to connect yet.</div>
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {links.map(([a, b], i) => {
        const lit = a === focus || b === focus
        return <line key={i} x1={at[a].x} y1={at[a].y} x2={at[b].x} y2={at[b].y} className={lit ? 'lit' : ''} />
      })}
      {notes.map((n) => {
        const r = 5 + Math.min(degree.get(n) ?? 0, 8) * 0.9
        const cls = n === focus ? 'focus' : near.has(n) ? 'near' : ''
        return (
          <g key={n} className={`gnode ${cls}`} transform={`translate(${at[n].x} ${at[n].y})`} onClick={() => onOpen(n)} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}>
            <circle r={r} />
            {cls && (
              <text y={r + 13} textAnchor="middle">
                {noteName(n)}
              </text>
            )}
            <title>{n}</title>
          </g>
        )
      })}
    </svg>
  )
}

// A note on the board, read where it lies; it opens in the studio or prints to PDF.
function MarkdownNodeImpl({ data, selected }: NodeProps<Node<{ root: string; path: string }>>) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.readFile(data.root, data.path).then(
      (r) => setText(r.text),
      (e) => setError((e as Error).message),
    )
  }, [data.root, data.path])
  const name = data.path.split('/').pop() ?? data.path
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={300} minHeight={220} />
      <div className="card-node md-card">
        <div className="card-head">
          <FileText size={14} color="var(--muted)" />
          <span className="t">{name}</span>
        </div>
        <div className="md-card-body nowheel">{error ? <div className="studio-error">{error}</div> : text !== null && <Reading text={text} />}</div>
        <div className="doc-card-foot">
          <button className="btn sm nodrag" onClick={() => useStore.getState().set({ modal: 'markdown', studioPath: data.path })}>
            <ExternalLink size={13} /> Open in Studio
          </button>
          <span className="spacer" />
          <button className="btn primary sm nodrag" disabled={text === null} onClick={() => text !== null && printPaper(renderMarkdown(text), noteName(data.path))}>
            <FileDown size={13} /> PDF
          </button>
        </div>
      </div>
    </>
  )
}
export const MarkdownNode = memo(MarkdownNodeImpl)
