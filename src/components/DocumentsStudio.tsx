import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { ArrowUp, Braces, Code, Copy, Database, FileDown, FileText, Footprints, Layers, LoaderCircle, MessageSquareText, PanelTop, Rabbit, RotateCcw, Scale, ShieldCheck, Square, TextAlignStart, Turtle, X } from 'lucide-react'
import { api, type DocEntry, type DocJob, type Depth } from '../api'
import { insertCard } from '../board'
import { project, useStore } from '../store'
import { agentById } from '../../shared/agents.js'
import { TEMPLATES, countWords, readMinutes } from '../../shared/docs.js'
import { printPaper, renderMarkdown } from '../markdown'
import { AgentGlyph, ClaudeMark } from './icons'
import { useNow } from './LoopsModal'

const WRITERS = ['claude', 'codex', 'gemini', 'grok', 'opencode']
const ICONS: Record<string, typeof FileText> = { overview: FileText, onboarding: Footprints, architecture: Layers, readme: TextAlignStart, api: Braces, 'data-model': Database, security: ShieldCheck }
const DEPTH_UI: [Depth, string, typeof Rabbit][] = [
  ['quick', 'Quick', Rabbit],
  ['balanced', 'Balanced', Scale],
  ['thorough', 'Thorough', Turtle],
]
const agentName = (id: string) => agentById(id)?.name ?? id
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`
const readTime = (text: string) => {
  const w = countWords(text)
  return `${w.toLocaleString()} words · ~${readMinutes(w)} min read`
}

// The white page a document is read on, in the studio, on the board and in the PDF.
function Paper({ text, writing }: { text: string; writing?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return (
    <article className={`paper ${writing ? 'writing' : ''}`}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {writing && <span className="caret" />}
    </article>
  )
}

export function DocumentsStudio() {
  const p = useStore(project)!
  const installed = useStore((s) => s.installed)
  const job = useStore((s) => s.docJobs.find((j) => j.cwd === p.path))
  const s = useStore.getState()
  const close = () => s.set({ modal: null })
  const [agent, setAgent] = useState(installed.includes('claude') ? 'claude' : (WRITERS.find((a) => installed.includes(a)) ?? 'claude'))
  const [depth, setDepth] = useState<Depth>('balanced')
  const [lib, setLib] = useState<{ docs: DocEntry[]; timed: Record<Depth, number | null> }>({ docs: [], timed: { quick: null, balanced: null, thorough: null } })
  const [picked, setPicked] = useState(job?.doc ?? 'overview')
  const [open, setOpen] = useState<(DocEntry & { text: string }) | null>(null)
  const [source, setSource] = useState(false)
  const [ask, setAsk] = useState('')
  const [error, setError] = useState<string | null>(null)
  const now = useNow()
  const scroller = useRef<HTMLDivElement>(null)

  const reload = () => api.docs(p.path).then(setLib, (e) => setError((e as Error).message))
  useEffect(() => {
    reload()
  }, [p.path])

  // The picked document from the library (a running or failed one shows the run instead).
  const entry = lib.docs.find((d) => d.id === picked)
  useEffect(() => {
    if (!entry) return setOpen(null)
    if (open?.id === entry.id && open.createdAt === entry.createdAt) return
    api.readDoc(p.path, entry.id).then(setOpen, (e) => setError((e as Error).message))
  }, [entry?.id, entry?.createdAt])

  // A finished run is in the library now: show it from there and let the server forget the run.
  useEffect(() => {
    if (job?.status !== 'done') return
    reload().then(() => api.clearDoc(p.path))
  }, [job?.status])

  // While the document is written, follow its end unless the reader scrolled up.
  useEffect(() => {
    const el = scroller.current
    if (el && job?.status === 'running' && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
  }, [job?.text])

  const start = async (o: { template: string; ask?: string }) => {
    setError(null)
    try {
      const j = await api.writeDoc(p.path, { ...o, agent, depth })
      setPicked(j.doc)
      setSource(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const regenerate = (d: DocEntry) => start(d.template === 'ask' ? { template: 'ask', ask: d.ask ?? d.title } : { template: d.template })
  const place = (d: DocEntry) => {
    insertCard('document', 520, 680, { cwd: p.path, id: d.id })
    close()
  }
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => s.notify('Markdown copied'))

  const running = job?.status === 'running' ? job : null
  const shown: DocJob | null = job && job.doc === picked && job.status !== 'done' ? job : null
  const template = TEMPLATES.find((t) => t.id === picked)
  const asked = lib.docs.filter((d) => d.template === 'ask')
  const Icon = ICONS[picked] ?? MessageSquareText

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal studio docs-studio">
        <aside className="studio-side">
          <div className="studio-title">
            <span className="ico">
              <FileText size={19} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>Documents</b>
              <small className="wrap">Generate a PDF from your repo — with your CLI.</small>
            </span>
          </div>
          <div className="docs-writers">
            {WRITERS.map((a) => (
              <button key={a} className={agent === a ? 'on' : ''} disabled={!installed.includes(a)} title={installed.includes(a) ? `Write with ${agentName(a)}` : `${agentName(a)} is not installed`} onClick={() => setAgent(a)}>
                <AgentGlyph id={a} size={15} />
              </button>
            ))}
          </div>
          <div className="docs-depths">
            {DEPTH_UI.map(([id, label, DIcon]) => (
              <button key={id} className={depth === id ? 'on' : ''} onClick={() => setDepth(id)}>
                <span>
                  <DIcon size={13} /> {label}
                </span>
                <small>{lib.timed[id] ? clock(lib.timed[id]!) : 'not timed'}</small>
              </button>
            ))}
          </div>
          <div className="studio-tree nowheel">
            <div className="ft-root">Documents</div>
            {TEMPLATES.map((t) => {
              const TIcon = ICONS[t.id]
              return (
                <button key={t.id} className={`doc-row ${picked === t.id ? 'on' : ''}`} onClick={() => setPicked(t.id)}>
                  <TIcon size={16} />
                  <span className="t">
                    <b>{t.title}</b>
                    <small>{t.sub}</small>
                  </span>
                  {running?.doc === t.id ? <span className="doc-dot busy" /> : lib.docs.some((d) => d.id === t.id) && <span className="doc-dot" title="Written" />}
                </button>
              )
            })}
            <div className="ft-root">Ask for anything</div>
            <form
              className="docs-ask"
              onSubmit={(e) => {
                e.preventDefault()
                if (ask.trim()) start({ template: 'ask', ask }).then(() => setAsk(''))
              }}
            >
              <textarea
                value={ask}
                rows={3}
                placeholder="e.g. a migration plan from REST to GraphQL"
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.currentTarget.form?.requestSubmit()}
              />
              <button className="send" disabled={!ask.trim() || !!running} title="Write it (⌘↵)">
                <ArrowUp size={14} />
              </button>
            </form>
            {asked.map((d) => (
              <button key={d.id} className={`doc-row ${picked === d.id ? 'on' : ''}`} onClick={() => setPicked(d.id)}>
                <MessageSquareText size={16} />
                <span className="t">
                  <b>{d.title}</b>
                  <small>{new Date(d.createdAt).toLocaleDateString()}</small>
                </span>
              </button>
            ))}
            {running?.doc.startsWith('ask-') && !asked.some((d) => d.id === running.doc) && (
              <button className={`doc-row ${picked === running.doc ? 'on' : ''}`} onClick={() => setPicked(running.doc)}>
                <MessageSquareText size={16} />
                <span className="t">
                  <b>{running.title}</b>
                  <small>Writing…</small>
                </span>
                <span className="doc-dot busy" />
              </button>
            )}
          </div>
        </aside>
        <section className="studio-main">
          <div className="studio-bar">
            <Icon size={15} color="var(--accent)" />
            <span className="doc-head">
              <b>{shown?.title ?? open?.title ?? template?.title ?? 'Document'}</b>
              {shown?.status === 'running' ? (
                <small>
                  {shown.step < 2 ? `Reading the repo with ${agentName(shown.agent)}` : `Writing with ${agentName(shown.agent)}`} · {Math.max(0, Math.floor((now - shown.startedAt) / 1000))}s
                </small>
              ) : (
                open && !shown && <small>{readTime(open.text)}</small>
              )}
            </span>
            <span className="spacer" />
            {shown?.status === 'running' && (
              <button className="btn sm danger" onClick={() => api.clearDoc(p.path)}>
                <Square size={12} fill="currentColor" /> Stop
              </button>
            )}
            {open && !shown && (
              <>
                <span className="seg">
                  <button className={source ? '' : 'on'} title="Formatted" onClick={() => setSource(false)}>
                    <FileText size={14} />
                  </button>
                  <button className={source ? 'on' : ''} title="Markdown source" onClick={() => setSource(true)}>
                    <Code size={14} />
                  </button>
                </span>
                <button className="icon-btn sm" title={`Write it again with ${agentName(agent)}`} disabled={!!running} onClick={() => regenerate(open)}>
                  <RotateCcw size={14} />
                </button>
                <button className="icon-btn sm" title="Copy the Markdown" onClick={() => copy(open.text)}>
                  <Copy size={14} />
                </button>
                <button className="icon-btn sm" title="Place on the board" onClick={() => place(open)}>
                  <PanelTop size={14} />
                </button>
                <button className="btn primary sm" onClick={() => printPaper(renderMarkdown(open.text), open.title)}>
                  <FileDown size={14} /> Export PDF
                </button>
              </>
            )}
            <button className="icon-btn" onClick={close}>
              <X size={17} />
            </button>
          </div>
          {error && <div className="studio-error">{error}</div>}
          <div className="docs-view nowheel" ref={scroller}>
            {shown?.status === 'failed' ? (
              <div className="studio-empty">
                <Icon size={28} />
                <b>{agentName(shown.agent)} could not write it</b>
                <span>{shown.error}</span>
                <button className="btn primary" onClick={() => api.clearDoc(p.path).then(() => start(shown.doc.startsWith('ask-') ? { template: 'ask', ask: shown.title } : { template: shown.doc }))}>
                  Try again
                </button>
              </div>
            ) : shown ? (
              shown.text ? (
                <Paper text={shown.text} writing />
              ) : (
                <div className="studio-empty">
                  <LoaderCircle size={26} className="spin" />
                  <b>{agentName(shown.agent)} is reading the repo</b>
                  <span>The page fills in as soon as it starts writing.</span>
                </div>
              )
            ) : open ? (
              source ? (
                <pre className="paper source">{open.text}</pre>
              ) : (
                <Paper text={open.text} />
              )
            ) : (
              <div className="studio-empty">
                <Icon size={28} color="var(--accent)" />
                <b>{template?.title ?? 'Document'}</b>
                <span>{template?.sub}</span>
                <button className="btn primary" disabled={!!running || !template} onClick={() => template && start({ template: template.id })}>
                  {agent === 'claude' ? <ClaudeMark size={14} color="#fff" /> : <AgentGlyph id={agent} size={14} />} Generate with {agentName(agent)}
                </button>
                <small>{running ? `Wait for “${running.title}” to finish.` : 'Saved to this repo’s library when it finishes.'}</small>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

// A document on the board: the library copy, read on its paper, with its own Export PDF.
function DocumentNodeImpl({ data, selected }: NodeProps<Node<{ cwd: string; id: string }>>) {
  const [doc, setDoc] = useState<(DocEntry & { text: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.readDoc(data.cwd, data.id).then(setDoc, (e) => setError((e as Error).message))
  }, [data.cwd, data.id])
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={320} minHeight={260} />
      <div className="card-node doc-card">
        <div className="card-head">
          <FileText size={14} color="var(--accent)" />
          <span className="t">{doc?.title ?? 'Document'}</span>
        </div>
        <div className="doc-card-body nowheel">
          <div className="doc-card-label">
            <span>Document</span>
            {doc && (
              <span className="by">
                <AgentGlyph id={doc.agent} size={12} /> {agentName(doc.agent)}
              </span>
            )}
          </div>
          {error ? <div className="studio-error">{error}</div> : doc && <Paper text={doc.text} />}
        </div>
        {doc && (
          <div className="doc-card-foot">
            <span>{new Date(doc.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
            <span className="spacer" />
            <button className="btn primary sm nodrag" onClick={() => printPaper(renderMarkdown(doc.text), doc.title)}>
              <FileDown size={13} /> Export PDF
            </button>
          </div>
        )}
      </div>
    </>
  )
}
export const DocumentNode = memo(DocumentNodeImpl)
