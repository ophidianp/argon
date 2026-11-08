import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, GitBranch, Plus, RotateCw, Trash2, Undo2, X } from 'lucide-react'
import { api } from '../api'
import { parseDiff, type DiffFile } from '../../shared/diff.js'

// One file's changes or one commit, in a wide pane beside the git panel.
export type GitView = { kind: 'file'; path: string } | { kind: 'commit'; hash: string }

export function GitDrawer({ cwd, view, onClose, onChanged }: { cwd: string; view: GitView; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ title: string; sub?: string; body?: string; files: DiffFile[]; note?: string; cut?: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const key = view.kind === 'file' ? view.path : view.hash

  useEffect(() => {
    setData(null)
    setError(null)
    setConfirm(false)
    const load =
      view.kind === 'file'
        ? api.gitDiff(cwd, view.path).then((r) => ({ title: r.path, files: parseDiff(r.text), note: r.note, cut: r.cut }))
        : api.gitShow(cwd, view.hash).then((r) => ({ title: r.subject, sub: `${r.hash.slice(0, 7)} · ${r.author} · ${r.when}`, body: r.body, files: parseDiff(r.text), cut: r.cut }))
    load.then(setData).catch((e) => setError((e as Error).message))
  }, [cwd, key])

  const discard = async () => {
    if (view.kind !== 'file') return
    try {
      await api.gitAction('discard', cwd, undefined, [view.path])
      onChanged()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const add = data?.files.reduce((n, f) => n + f.add, 0) ?? 0
  const del = data?.files.reduce((n, f) => n + f.del, 0) ?? 0

  return (
    <div className="menu git-drawer nowheel">
      <div className="gd-head">
        <span style={{ flex: 1, minWidth: 0 }}>
          <div className="t">{data?.title ?? (view.kind === 'file' ? view.path : 'Commit')}</div>
          <div className="s">
            {data?.sub && <span className="mono">{data.sub}</span>}
            {data && (
              <span className="n">
                <span className="plus">+{add}</span> <span className="minus">-{del}</span>
                {data.files.length > 1 && ` · ${data.files.length} files`}
              </span>
            )}
          </div>
        </span>
        {view.kind === 'file' &&
          (confirm ? (
            <span className="gd-confirm">
              Throw these changes away?
              <button className="btn sm" onClick={() => setConfirm(false)}>
                Keep
              </button>
              <button className="btn primary sm" onClick={discard}>
                <Trash2 size={13} /> Discard
              </button>
            </span>
          ) : (
            <button className="btn sm" onClick={() => setConfirm(true)} title="Go back to the last commit for this file">
              <Undo2 size={13} /> Discard
            </button>
          ))}
        <button className="round-btn sm" title="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      {data?.body && <pre className="gd-body">{data.body}</pre>}
      <div className="gd-scroll">
        {error && <div className="gd-note bad">{error}</div>}
        {!data && !error && (
          <div className="gd-note">
            <RotateCw size={14} className="spin" /> Reading the changes…
          </div>
        )}
        {data?.note && <div className="gd-note">{data.note}</div>}
        {data?.files.map((f, i) => <FileDiff key={`${f.path}-${i}`} file={f} open={data.files.length < 6 || i === 0} showName={view.kind === 'commit' || data.files.length > 1} />)}
        {data && !data.files.length && !data.note && <div className="gd-note">No line changes (a mode change or an empty file).</div>}
        {data?.cut && <div className="gd-note">The diff is very long: only its start is shown.</div>}
      </div>
    </div>
  )
}

function FileDiff({ file, open, showName }: { file: DiffFile; open: boolean; showName: boolean }) {
  const [expanded, setExpanded] = useState(open)
  return (
    <div className="gd-file">
      {showName && (
        <button className="gd-fname" onClick={() => setExpanded((v) => !v)}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="mono">{file.from ? `${file.from} → ${file.path}` : file.path}</span>
          <span className="spacer" />
          <span className="plus">+{file.add}</span> <span className="minus">-{file.del}</span>
        </button>
      )}
      {expanded &&
        (file.binary ? (
          <div className="gd-note">Binary file changed.</div>
        ) : (
          <table className="gd-table">
            <tbody>
              {file.hunks.map((h, hi) => [
                <tr key={`h${hi}`} className="hunk">
                  <td colSpan={3}>{h.header}</td>
                </tr>,
                ...h.lines.map((l, li) => (
                  <tr key={`${hi}-${li}`} className={l.kind}>
                    <td className="no">{l.old ?? ''}</td>
                    <td className="no">{l.new ?? ''}</td>
                    <td className="code">
                      <span className="sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
                      {l.text}
                    </td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        ))}
    </div>
  )
}

// Switch to another local branch or start one, named by what it is for.
export function BranchMenu({ cwd, current, onDone, onClose }: { cwd: string; current: string; onDone: (msg: string, ok: boolean) => void; onClose: () => void }) {
  const [branches, setBranches] = useState<string[]>([])
  const [prefix, setPrefix] = useState('feat/')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.gitBranches(cwd).then((r) => setBranches(r.branches)).catch(() => setBranches([]))
  }, [cwd])
  const go = async (branch: string, create: boolean) => {
    setBusy(true)
    try {
      await api.gitBranch(cwd, branch, create)
      onDone(create ? `On a new branch: ${branch}` : `Switched to ${branch}`, true)
    } catch (e) {
      onDone((e as Error).message, false)
    } finally {
      setBusy(false)
    }
  }
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (
    <div className="menu branch-menu" onMouseLeave={onClose}>
      <div className="menu-title">Branches</div>
      {branches.map((b) => (
        <button key={b} className="menu-item" disabled={busy || b === current} onClick={() => go(b, false)}>
          <GitBranch size={14} /> <span className="mono">{b}</span>
          {b === current && <Check size={14} style={{ marginLeft: 'auto' }} />}
        </button>
      ))}
      <div className="menu-title" style={{ marginTop: 6 }}>
        New branch
      </div>
      <div className="branch-kinds">
        {['feat/', 'fix/', 'release/'].map((p) => (
          <button key={p} className={prefix === p ? 'on' : ''} onClick={() => setPrefix(p)}>
            {p.slice(0, -1)}
          </button>
        ))}
      </div>
      <form
        className="branch-new"
        onSubmit={(e) => {
          e.preventDefault()
          if (slug) go(prefix + slug, true)
        }}
      >
        <span className="mono">{prefix}</span>
        <input value={name} placeholder="what it is for" onChange={(e) => setName(e.target.value)} />
        <button className="round-btn sm" disabled={!slug || busy} title="Create and switch to it">
          <Plus size={14} />
        </button>
      </form>
    </div>
  )
}
