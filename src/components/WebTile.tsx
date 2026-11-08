import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { ArrowLeft, ArrowRight, Bug, ExternalLink, Globe, Plus, RotateCw, X } from 'lucide-react'
import { api } from '../api'
import { useStore, type WebData, type WebTab } from '../store'
import { toUrl } from '../../shared/url.js'
import { parseSize, Popover, SizeMenu } from './SizeMenu'

const uid = () => crypto.randomUUID().slice(0, 8)
// Present only inside the desktop app (desktop/preload.cjs).
const desktop = window.vibeboardDesktop
// Page sizes: the tile takes that size, so the page is shown exactly as big as it says.
const VIEWPORTS: [string, string][] = [
  ['Fit', 'Fit the tile'],
  ['1920 × 1080', 'Desktop'],
  ['1440 × 900', 'Laptop'],
  ['1280 × 800', 'Small laptop'],
  ['768 × 1024', 'Tablet'],
  ['390 × 844', 'Phone'],
]

const QUICK = [
  ['Google', 'https://www.google.com'],
  ['GitHub', 'https://github.com'],
  ['YouTube', 'https://www.youtube.com'],
  ['MDN', 'https://developer.mozilla.org'],
  ['npm', 'https://www.npmjs.com'],
  ['Hacker News', 'https://news.ycombinator.com'],
]
export const newWebData = (): WebData => {
  const id = uid()
  return { tabs: [{ id, url: '', back: [], fwd: [] }], active: id, viewport: 'Fit' }
}

// Titles come from the server (a cross-origin frame hides its own); one fetch per address.
const titles = new Map<string, Promise<string>>()
const titleOf = (url: string) => {
  if (!titles.has(url)) titles.set(url, api.pageTitle(url).then((r) => r.title).catch(() => ''))
  return titles.get(url)!
}
const hostOf = (url: string) => {
  try {
    const u = new URL(url)
    return u.port ? `${u.hostname}:${u.port}` : u.hostname
  } catch {
    return url
  }
}
function useTitle(url: string) {
  const [title, setTitle] = useState('')
  useEffect(() => {
    let live = true
    setTitle('')
    if (url) titleOf(url).then((t) => live && setTitle(t))
    return () => {
      live = false
    }
  }, [url])
  return url ? title || hostOf(url) : 'New tab'
}

function WebTileImpl({ id, data, selected }: NodeProps<Node<WebData>>) {
  const tabs: WebTab[] = data.tabs ?? [{ id: 't0', url: data.url ?? '', back: [], fwd: [] }]
  const active = tabs.find((t) => t.id === data.active) ?? tabs[0]
  const viewport = data.viewport ?? 'Fit'
  const save = (patch: Partial<WebData>) => useStore.getState().updateData(id, { tabs, active: active.id, ...patch })
  const setTab = (tab: WebTab) => save({ tabs: tabs.map((t) => (t.id === tab.id ? tab : t)) })
  const [address, setAddress] = useState(active.url)
  const [nonce, setNonce] = useState(0)
  const [sizes, setSizes] = useState<DOMRect | null>(null)
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => setAddress(active.url), [active.id, active.url])
  const pickSize = (v: string) => {
    save({ viewport: v })
    setSizes(null)
    if (v === 'Fit') return
    const [w, h] = parseSize(v)
    const bars = [...card.current!.querySelectorAll<HTMLElement>('.wt-title, .wt-tabs, .wt-nav')].reduce((n, b) => n + b.offsetHeight, 0)
    const border = card.current!.offsetHeight - card.current!.clientHeight
    useStore.getState().resizeNode(id, w + border, h + bars + border)
  }
  const title = useTitle(active.url)

  const go = (url: string) => url && url !== active.url && setTab({ ...active, url, back: active.url ? [...active.back, active.url] : active.back, fwd: [] })
  const back = () => active.back.length && setTab({ ...active, url: active.back[active.back.length - 1], back: active.back.slice(0, -1), fwd: [active.url, ...active.fwd] })
  const fwd = () => active.fwd.length && setTab({ ...active, url: active.fwd[0], back: [...active.back, active.url], fwd: active.fwd.slice(1) })
  const addTab = () => {
    const tab = { id: uid(), url: '', back: [], fwd: [] }
    save({ tabs: [...tabs, tab], active: tab.id })
  }
  const closeTab = (tabId: string) => {
    if (tabs.length === 1) return useStore.getState().removeNode(id)
    const rest = tabs.filter((t) => t.id !== tabId)
    save({ tabs: rest, active: tabId === active.id ? rest[Math.max(0, tabs.findIndex((t) => t.id === tabId) - 1)].id : active.id })
  }

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={360} minHeight={260} />
      <div ref={card} className="card-node web-tile">
        <div className="wt-title">
          <Globe size={12} color="var(--muted)" />
          <span className="t">{title}</span>
          <span className="spacer" />
          <button className="icon-btn sm nodrag" title="Close tile" onClick={() => useStore.getState().removeNode(id)}>
            <X size={13} />
          </button>
        </div>
        <div className="wt-tabs nodrag">
          {tabs.map((t) => (
            <TabChip key={t.id} tab={t} on={t.id === active.id} onPick={() => save({ active: t.id })} onClose={() => closeTab(t.id)} />
          ))}
          <button className="icon-btn sm" title="New tab" onClick={addTab}>
            <Plus size={13} />
          </button>
        </div>
        <div className="wt-nav nodrag">
          <button className="icon-btn sm" title="Back" disabled={!active.back.length} onClick={back}>
            <ArrowLeft size={14} />
          </button>
          <button className="icon-btn sm" title="Forward" disabled={!active.fwd.length} onClick={fwd}>
            <ArrowRight size={14} />
          </button>
          <button className="icon-btn sm" title="Reload" disabled={!active.url} onClick={() => setNonce((n) => n + 1)}>
            <RotateCw size={13} />
          </button>
          <input
            value={address}
            placeholder="Search or enter address"
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go(toUrl(address))}
            onFocus={(e) => e.target.select()}
          />
          <button className="vp-chip" data-popover-toggle title="Page size: pick one or type your own" onClick={(e) => setSizes(sizes ? null : e.currentTarget.getBoundingClientRect())}>
            {viewport}
          </button>
          {sizes && (
            <Popover anchor={sizes} onClose={() => setSizes(null)}>
              <SizeMenu current={viewport} sizes={VIEWPORTS} onPick={pickSize} />
            </Popover>
          )}
          {active.url && desktop && (
            <button
              className="icon-btn sm"
              title="Inspect this page"
              onClick={(e) => {
                const frame = e.currentTarget.closest('.web-tile')?.querySelector('.wt-frame')?.getBoundingClientRect()
                if (frame) desktop.inspect(frame.x + frame.width / 2, frame.y + frame.height / 2)
              }}
            >
              <Bug size={13} />
            </button>
          )}
          {active.url && (
            <a className="icon-btn sm" title="Open in your browser" href={active.url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} />
            </a>
          )}
        </div>
        {active.url ? <Frame key={`${active.id}-${nonce}`} url={active.url} viewport={viewport} /> : <StartPage onOpen={go} />}
      </div>
    </>
  )
}
export const WebTile = memo(WebTileImpl)

function TabChip({ tab, on, onPick, onClose }: { tab: WebTab; on: boolean; onPick: () => void; onClose: () => void }) {
  const title = useTitle(tab.url)
  return (
    <div className={`wt-tab ${on ? 'on' : ''}`} onClick={onPick} title={tab.url || 'New tab'}>
      <span>{title}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        <X size={11} />
      </button>
    </div>
  )
}

// A fixed page size renders the page at that size and scales it down to the tile, like a device preview.
function Frame({ url, viewport }: { url: string; viewport: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 1, h: 1 })
  useLayoutEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [vw, vh] = viewport === 'Fit' ? [0, 0] : viewport.split(' × ').map(Number)
  const scale = vw ? Math.min(size.w / vw, size.h / vh) : 1
  return (
    <div ref={box} className="wt-frame nodrag nowheel">
      <iframe
        src={url}
        title={url}
        style={vw ? { width: vw, height: vh, transform: `scale(${scale})`, transformOrigin: 'top left' } : undefined}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
      />
    </div>
  )
}

function StartPage({ onOpen }: { onOpen: (url: string) => void }) {
  const [ports, setPorts] = useState<{ port: number; live: boolean }[] | null>(null)
  const [typed, setTyped] = useState('')
  const scan = () => {
    setPorts(null)
    api.ports().then(setPorts).catch(() => setPorts([]))
  }
  useEffect(scan, [])
  const live = ports?.filter((p) => p.live).length ?? 0
  return (
    <div className="wt-start nodrag nowheel">
      <h3>Open a page</h3>
      <input autoFocus value={typed} placeholder="Search or enter address" onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onOpen(toUrl(typed))} />
      <div className="wt-sec">
        <span className="section-label">Localhost</span>
        <span className={`live ${live ? 'on' : ''}`}>{ports ? `${live} live` : 'looking…'}</span>
        <button className="icon-btn sm" title="Look again" onClick={scan}>
          <RotateCw size={12} />
        </button>
      </div>
      <div className="wt-ports">
        {(ports ?? []).map((p) => (
          <button key={p.port} className={p.live ? 'on' : ''} title={p.live ? 'Something is running here' : 'Nothing is listening'} onClick={() => onOpen(`http://localhost:${p.port}`)}>
            <i />:{p.port}
          </button>
        ))}
      </div>
      <div className="wt-sec">
        <span className="section-label">Quick links</span>
      </div>
      <div className="wt-quick">
        {QUICK.map(([name, url]) => (
          <button key={name} onClick={() => onOpen(url)}>
            <span className="fav">{name[0]}</span>
            {name}
          </button>
        ))}
      </div>
      {!desktop && <p className="hint">In the browser some sites (Google, GitHub…) refuse to be shown inside another page: open them in your browser, or use the desktop app (npm run desktop), where every site loads.</p>}
    </div>
  )
}
