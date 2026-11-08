import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, Square, TerminalSquare, X } from 'lucide-react'
import { api, type Ask, type ConversationItem } from '../api'
import { renderMarkdown } from '../markdown'
import { useStore, type ConsoleData } from '../store'
import { statusLine } from '../../shared/plain.js'
import { isRefusal } from '../../shared/prompts.js'
import type { ConsoleStatus } from './ConsoleNode'

const NOT_STARTED_MS = 8000
const HELD_SETTLE_MS = 800
const drafts = new Map<string, string>() // what is being typed survives a switch to the terminal and back
const heldPrompts = new Map<string, { epoch: number; text: string }>() // sent while the agent could not take it yet, per run
const EMPTY: ConversationItem[] = []

// The sentence under the console's title: what it is doing, in plain words.
export function StatusStrip({ id, status }: { id: string; status: ConsoleStatus }) {
  const activity = useStore((s) => s.live[id]?.activity)
  return (
    <div className={`simple-status ${status}`}>
      <span className="dot" />
      <span className="t">{statusLine(status, activity ?? undefined)}</span>
    </div>
  )
}

// Memoised: a long conversation re-renders on every step, and markdown is the expensive part.
const Agent = memo(function Agent({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div className="simple-msg agent paper dark" dangerouslySetInnerHTML={{ __html: html }} />
})

// Runs of tool steps fold together, so a long job does not bury what the agent said.
function Steps({ steps, open }: { steps: ConversationItem[]; open: boolean }) {
  const list = (
    <ul>
      {steps.map((s, i) => (
        <li key={i} className={s.failed ? 'failed' : ''}>
          {s.failed ? <X size={12} /> : s.pending ? <span className="dot" /> : <Check size={12} />} {s.text}
        </li>
      ))}
    </ul>
  )
  if (steps.length < 4) return <div className="simple-steps">{list}</div>
  return (
    <details className="simple-steps" open={open}>
      <summary>{steps.length} steps</summary>
      {list}
    </details>
  )
}

function grouped(items: ConversationItem[]) {
  const out: ({ kind: 'steps'; steps: ConversationItem[] } | ConversationItem)[] = []
  for (const it of items) {
    const last = out[out.length - 1]
    if (it.kind === 'step' && last?.kind === 'steps') last.steps.push(it)
    else out.push(it.kind === 'step' ? { kind: 'steps', steps: [it] } : it)
  }
  return out
}

// Claude's conversation, read from its own transcript, laid over the terminal running underneath.
export function Conversation({ id, name }: { id: string; name: string }) {
  const tick = useStore((s) => s.live[id]?.tick ?? 0)
  const alive = useStore((s) => !!s.live[id])
  const [items, setItems] = useState<ConversationItem[]>(EMPTY)
  const pending = useStore((s) => s.pendingPrompt[id])
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    if (!alive) return // what was already read stays on screen after the agent exits
    let gone = false
    api
      .conversation(id)
      .then((r) => !gone && setItems(r.items))
      .catch((e) => console.error('could not read the conversation', e))
    return () => {
      gone = true
    }
  }, [id, tick, alive])

  // Follows the newest line, unless the person has scrolled up to read.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [items, pending])

  const rows = grouped(items)
  const mine = items.filter((i) => i.kind === 'user').length
  const before = useRef({ prompt: pending, count: mine })
  if (before.current.prompt !== pending) before.current = { prompt: pending, count: mine }
  const waiting = pending && mine <= before.current.count
  return (
    <div
      ref={ref}
      className="simple-log nodrag nowheel nopan"
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      {!rows.length && !waiting && <p className="simple-empty">Tell {name} what to do, in your own words. It works in this folder and tells you what it did.</p>}
      {rows.map((r, i) =>
        r.kind === 'steps' ? (
          <Steps key={i} steps={r.steps} open={i === rows.length - 1} />
        ) : r.kind === 'agent' ? (
          <Agent key={i} text={r.text} />
        ) : r.kind === 'note' ? (
          <p key={i} className="simple-note">
            {r.text}
          </p>
        ) : (
          <div key={i} className="simple-msg user">
            {r.text}
          </div>
        ),
      )}
      {waiting && <div className="simple-msg user sending">{pending}</div>}
    </div>
  )
}

function AskCard({ id, name, ask }: { id: string; name: string; ask: Ask }) {
  const [busy, setBusy] = useState(false)
  useEffect(() => setBusy(false), [ask.id])
  const answer = async (index: number) => {
    setBusy(true)
    try {
      await api.choose(id, ask.id, index)
    } catch {
      useStore.getState().notify('The question changed before your answer arrived. Look again.')
      setBusy(false)
    }
  }
  // "Do you want to proceed?" stays in view even when what it refers to needs scrolling.
  const lines = ask.question.split('\n')
  const heading = lines[lines.length - 1].endsWith('?') ? lines[lines.length - 1] : `${name} is asking`
  const detail = heading === lines[lines.length - 1] ? lines.slice(0, -1).join('\n') : ask.question
  return (
    <div className="ask-card nodrag nowheel" role="alertdialog" aria-label={`${name} is asking`}>
      <b>{heading}</b>
      {detail && <pre>{detail}</pre>}
      <div className="ask-options">
        {ask.options.map((o, i) => (
          <button key={i} className={`btn ${i === ask.selected && !isRefusal(o.label) ? 'primary' : ''}`} disabled={busy} title={o.hint || undefined} onClick={() => answer(i)}>
            {o.label}
          </button>
        ))}
        <button className="btn ghost-plain" title="Answer it yourself in the real terminal" onClick={() => useStore.getState().updateData(id, { view: 'terminal' })}>
          <TerminalSquare size={14} /> Terminal
        </button>
      </div>
    </div>
  )
}

function TerminalNote({ id, text }: { id: string; text: string }) {
  return (
    <div className="ask-card note nodrag">
      <span>{text}</span>
      <button className="btn" onClick={() => useStore.getState().updateData(id, { view: 'terminal' })}>
        <TerminalSquare size={14} /> Show terminal
      </button>
    </div>
  )
}

// Everything under the terminal: the question being asked, and the box to write in.
export function SimpleFooter({ id, data, status }: { id: string; data: ConsoleData; status: ConsoleStatus }) {
  const ask = useStore((s) => s.live[id]?.ask)
  const started = useStore((s) => s.live[id]?.started)
  const [text, setTextState] = useState(() => drafts.get(id) ?? '')
  const setText = (v: string) => {
    drafts.set(id, v)
    setTextState(v)
  }
  const [late, setLate] = useState(false)
  const heldNow = () => {
    const h = heldPrompts.get(id)
    return h?.epoch === data.epoch ? h.text : ''
  }
  const [held, setHeldState] = useState(heldNow)
  const setHeld = (v: string) => {
    heldPrompts.set(id, { epoch: data.epoch, text: v })
    setHeldState(v)
  }
  const box = useRef<HTMLTextAreaElement>(null)
  const claude = data.agent === 'claude'
  // Before its session starts, Enter would answer whatever the CLI is showing (it can mean "No, exit").
  // So what is written meanwhile waits for its turn: the box itself is never closed to the person.
  const locked = !!ask || (claude && !started) || status === 'paused'

  useEffect(() => {
    if (!claude || started) return setLate(false)
    const t = setTimeout(() => setLate(true), NOT_STARTED_MS)
    return () => clearTimeout(t)
  }, [claude, started, data.epoch])

  const showPending = (prompt: string) => useStore.setState((s) => ({ pendingPrompt: { ...s.pendingPrompt, [id]: prompt } }))
  // Started again: what waited for the last run is dropped, and back in the box to send or not.
  useEffect(() => {
    const h = heldPrompts.get(id)
    if (!h?.text || h.epoch === data.epoch) return
    heldPrompts.delete(id)
    setText(h.text)
    setHeldState('')
    showPending('')
  }, [data.epoch])
  const deliver = (prompt: string) => {
    showPending(prompt)
    api.prompt(id, prompt).catch((e) => {
      setText(prompt)
      showPending('')
      useStore.getState().notify(`Could not send it: ${(e as Error).message}`)
    })
  }
  // A moment after it becomes free: a CLI that has just started is often still drawing its first screen.
  useEffect(() => {
    if (!held || locked) return
    const t = setTimeout(() => {
      setHeld('')
      deliver(held)
    }, HELD_SETTLE_MS)
    return () => clearTimeout(t)
  }, [held, locked])

  const send = () => {
    const prompt = text.trim()
    if (!prompt) return
    if (data.resumeOffer) useStore.getState().updateData(id, { resumeOffer: false }) // writing starts fresh, as the offer says
    setText('')
    if (locked) {
      setHeld(held ? `${held}\n${prompt}` : prompt)
      showPending(held ? `${held}\n${prompt}` : prompt)
    } else deliver(prompt)
  }
  const unhold = () => {
    setText(held)
    setHeld('')
    showPending('')
  }

  return (
    <div className="simple-footer">
      {ask ? (
        <AskCard id={id} name={data.name} ask={ask} />
      ) : status === 'needs' ? (
        <TerminalNote id={id} text={`${data.name} is asking something that only shows in the terminal.`} />
      ) : (
        late && status !== 'stopped' && <TerminalNote id={id} text={`${data.name} has not started yet. It may need you to sign in.`} />
      )}
      {held && (
        <div className="held-note">
          <span>Goes as soon as {data.name} is ready</span>
          <button type="button" onClick={unhold}>
            Take it back
          </button>
        </div>
      )}
      <form
        className="simple-compose nodrag"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <textarea
          ref={box}
          rows={1}
          value={text}
          placeholder={ask ? 'Write now, it goes after your answer' : status === 'paused' ? 'Write now, it goes when you resume it' : `Tell ${data.name} what to do…`}
          onChange={(e) => {
            setText(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = `${Math.min(e.target.scrollHeight, 110)}px`
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
              if (box.current) box.current.style.height = 'auto'
            }
          }}
        />
        {status === 'working' && (
          <button type="button" className="round-btn" title="Stop what it is doing" onClick={() => api.stop(id)}>
            <Square size={13} fill="currentColor" />
          </button>
        )}
        <button className="round-btn go" title="Send" disabled={!text.trim()}>
          <ArrowUp size={15} />
        </button>
      </form>
    </div>
  )
}
