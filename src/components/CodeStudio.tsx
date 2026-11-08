import { memo, useEffect, useState } from 'react'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight, CodeXml, File, FileJson, FileText, Folder, FolderOpen, FolderPlus, Image, PanelTop, Plus, RotateCw, Save, X } from 'lucide-react'
import { api, type FileEntry } from '../api'
import { insertCard } from '../board'
import { project, useStore } from '../store'
import { CodeView, langLabel } from './CodeView'

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
const lines = (text: string) => (text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0)
const base = (p: string) => p.split('/').pop() || p

export function FileIcon({ name }: { name: string }) {
  const e = name.split('.').pop()?.toLowerCase()
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'css', 'html', 'sh', 'rs', 'go', 'swift'].includes(e ?? '')) return <CodeXml size={14} color="#79b8ff" />
  if (e === 'json') return <FileJson size={14} color="#e0a43a" />
  if (['md', 'mdx', 'txt'].includes(e ?? '')) return <FileText size={14} color="var(--muted)" />
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(e ?? '')) return <Image size={14} color="#a98bfa" />
  return <File size={14} color="var(--muted)" />
}

// A folder tree; folders open and close, a file is picked with a click.
// `expanded`: every folder starts open.
export function FileTree({ entries, current, onOpen, label = (e: FileEntry) => e.name, depth = 0, expanded = false }: { entries: FileEntry[]; current?: string; onOpen: (path: string) => void; label?: (e: FileEntry) => string; depth?: number; expanded?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(expanded ? entries.filter((e) => e.dir).map((e) => e.path) : []))
  return (
    <>
      {entries.map((e) =>
        e.dir ? (
          <div key={e.path}>
            <button className="ft-row" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setOpen((s) => (s.delete(e.path) ? new Set(s) : new Set(s).add(e.path)))}>
              {open.has(e.path) ? <ChevronDown size={13} className="chev" /> : <ChevronRight size={13} className="chev" />}
              {open.has(e.path) ? <FolderOpen size={14} color="var(--accent)" /> : <Folder size={14} color="var(--accent)" />}
              <span>{label(e)}</span>
            </button>
            {open.has(e.path) && <FileTree entries={e.children ?? []} current={current} onOpen={onOpen} label={label} depth={depth + 1} expanded={expanded} />}
          </div>
        ) : (
          <button key={e.path} className={`ft-row ${current === e.path ? 'on' : ''}`} style={{ paddingLeft: 22 + depth * 14 }} onClick={() => onOpen(e.path)}>
            <FileIcon name={e.name} />
            <span>{label(e)}</span>
          </button>
        ),
      )}
    </>
  )
}

type Open = { root: string; path: string; saved: string; text: string; size: number } | null

export function CodeStudio() {
  const p = useStore(project)!
  const close = () => useStore.getState().set({ modal: null })
  const [roots, setRoots] = useState<string[]>([p.path, ...(p.folders ?? [])])
  const [trees, setTrees] = useState<Record<string, FileEntry[]>>({})
  const [file, setFile] = useState<Open>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [adding, setAdding] = useState(false)

  const loadTree = (root: string) =>
    api
      .tree(root)
      .then((r) => setTrees((t) => ({ ...t, [root]: r.entries })))
      .catch((e) => setError((e as Error).message))
  useEffect(() => {
    roots.forEach(loadTree)
  }, [roots.join('|')])

  // Switching away from unsaved edits waits for Save or Discard (the bar above the editor).
  const [pending, setPending] = useState<{ root: string; path: string } | null>(null)
  const openFile = async (root: string, path: string, force = false) => {
    if (!force && file && file.text !== file.saved) return setPending({ root, path })
    setPending(null)
    try {
      const r = await api.readFile(root, path)
      setFile({ root, path, saved: r.text, text: r.text, size: r.size })
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const save = async () => {
    if (!file || file.text === file.saved) return
    try {
      const r = await api.writeFile(file.root, file.path, file.text)
      setFile({ ...file, saved: file.text, size: r.size })
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const insert = () => {
    if (!file) return
    insertCard('code', 640, 520, { root: file.root, path: file.path })
    close()
  }
  const edited = !!file && file.text !== file.saved
  const crumbs = file ? file.path.split('/') : []

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal studio">
        <aside className="studio-side">
          <div className="studio-title">
            <span className="ico">
              <CodeXml size={19} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>Code</b>
              <small>{p.name}</small>
            </span>
            <button className="icon-btn sm" title="Show in Finder" onClick={() => api.reveal(p.path)}>
              <FolderOpen size={14} />
            </button>
            <button className="icon-btn sm" title="Show another folder here" onClick={() => setAdding((v) => !v)}>
              <FolderPlus size={14} />
            </button>
            <button className="icon-btn sm" title="New file" onClick={() => setCreating((v) => !v)}>
              <Plus size={15} />
            </button>
          </div>
          {adding && (
            <PathInput
              placeholder="/Users/you/another-folder"
              onCancel={() => setAdding(false)}
              onSubmit={async (dir) => {
                try {
                  await api.ls(dir)
                  setRoots((r) => (r.includes(dir) ? r : [...r, dir]))
                  setAdding(false)
                } catch (e) {
                  setError((e as Error).message)
                }
              }}
            />
          )}
          {creating && (
            <PathInput
              placeholder="src/new-file.ts"
              onCancel={() => setCreating(false)}
              onSubmit={async (rel) => {
                try {
                  await api.writeFile(roots[0], rel, '', true)
                  setCreating(false)
                  await loadTree(roots[0])
                  openFile(roots[0], rel)
                } catch (e) {
                  setError((e as Error).message)
                }
              }}
            />
          )}
          <div className="studio-tree nowheel">
            {roots.map((root) => (
              <div key={root}>
                {roots.length > 1 && <div className="ft-root">{base(root)}</div>}
                <FileTree entries={trees[root] ?? []} current={file?.root === root ? file.path : undefined} onOpen={(path) => openFile(root, path)} />
              </div>
            ))}
          </div>
        </aside>
        <section className="studio-main">
          <div className="studio-bar">
            {file && (
              <>
                <span className="crumbs" title={`${langLabel(file.path)} · ${lines(file.text)} lines · ${size(file.size)}`}>
                  {crumbs.map((c, i) => (
                    <span key={i} className={i === crumbs.length - 1 ? 'last' : ''}>
                      {c}
                    </span>
                  ))}
                </span>
                {edited && <span className="edited">• Not saved</span>}
              </>
            )}
            <span className="spacer" />
            {edited && (
              <button className="btn primary sm" onClick={save} title="Save (⌘S)">
                <Save size={14} /> Save
              </button>
            )}
            {file && (
              <button className="btn sm" onClick={insert} title="Show this file as a card on the board">
                <PanelTop size={14} /> Put on board
              </button>
            )}
            <button className="icon-btn" title="Close" onClick={close}>
              <X size={17} />
            </button>
          </div>
          {error && <div className="studio-error">{error}</div>}
          {pending && file && (
            <div className="studio-pending">
              {base(file.path)} has unsaved changes.
              <span className="spacer" />
              <button className="btn sm" onClick={() => openFile(pending.root, pending.path, true)}>
                Discard them
              </button>
              <button className="btn primary sm" onClick={async () => (await save(), openFile(pending.root, pending.path, true))}>
                Save and open
              </button>
            </div>
          )}
          <div className="studio-editor">
            {file ? (
              <CodeView text={file.saved} path={`${file.root}/${file.path}`} onChange={(text) => setFile((f) => f && { ...f, text })} onSave={save} />
            ) : (
              <div className="studio-empty">
                <CodeXml size={28} />
                <b>Pick a file on the left</b>
                <span>Read it, change it here, or put it on the board.</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export function PathInput({ placeholder, onSubmit, onCancel }: { placeholder: string; onSubmit: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('')
  return (
    <form
      className="path-input"
      onSubmit={(e) => {
        e.preventDefault()
        if (v.trim()) onSubmit(v.trim())
      }}
    >
      <input autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onCancel()} />
    </form>
  )
}

// A file on the board: highlighted, read-only, always the file's current content.
function CodeNodeImpl({ data, selected }: NodeProps<Node<{ root: string; path: string }>>) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () =>
    api
      .readFile(data.root, data.path)
      .then((r) => (setText(r.text), setError(null)))
      .catch((e) => setError((e as Error).message))
  useEffect(() => {
    load()
  }, [data.root, data.path])
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={320} minHeight={200} />
      <div className="card-node code-card">
        <div className="card-head">
          <CodeXml size={15} color="var(--muted)" />
          <span className="t">{base(data.path)}</span>
          <span className="spacer" />
          <span className="lang-chip">{langLabel(data.path)}</span>
          <button className="icon-btn sm nodrag" title="Read the file again" onClick={load}>
            <RotateCw size={13} />
          </button>
        </div>
        <div className="code-card-body">{error ? <div className="studio-error">{error}</div> : text !== null && <CodeView text={text} path={data.path} readOnly />}</div>
      </div>
    </>
  )
}
export const CodeNode = memo(CodeNodeImpl)
