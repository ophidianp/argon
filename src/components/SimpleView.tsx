import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, ImagePlus, Square, TerminalSquare, X } from 'lucide-react'
import { api, type Ask, type ConversationItem } from '../api'
import { renderMarkdown } from '../markdown'
import { useStore, type ConsoleData, type ConsoleImage } from '../store'
import { statusLine } from '../../shared/plain.js'
import { isRefusal } from '../../shared/prompts.js'
import { hasImages, IMAGE_TYPES, imagesIn, uploadImage, useAutoGrow, useTypeIntoBox } from '../consoleImages'
import type { ConsoleStatus } from './ConsoleNode'

const NOT_STARTED_MS = 8000
const HELD_SETTLE_MS = 800
const drafts = new Map<string, string>() // what is being typed survives a switch to the terminal and back
const draftImages = new Map<string, ConsoleImage[]>() // pictures attached to the draft, likewise
type Held = { epoch: number; text: string; images: ConsoleImage[] }
const heldPrompts = new Map<string, Held>() // sent while the agent could not take it yet, per run
const pendingImages = new Map<string, string[]>() // pictures of the prompt on its way, shown until the transcript has it
const EMPTY: ConversationItem[] = []
const NO_IMAGES: ConsoleImage[] = []

// A picture, small in the conversation; a click shows it full size.
export function Thumb({ src, onRemove }: { src: string; onRemove?: () => void }) {
  const [big, setBig] = useState(false)
  return (
    <>
      <span className="img-thumb">
        <img src={src} alt="" loading="lazy" draggable={false} onClick={() => setBig(true)} />
        {onRemove && (
          <button type="button" className="img-x" title="Take this picture out" onClick={onRemove}>
            <X size={11} />
          </button>
        )}
      </span>
      {big && (
        <div className="img-view nodrag nowheel" onClick={() => setBig(false)}>
          <img src={src} alt="" />
        </div>
      )}
    </>
  )
}

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
            {r.images && r.images.length > 0 && (
              <div className="msg-images">
                {r.images.map((k) => (
                  <Thumb key={k} src={api.transcriptImageUrl(id, k)} />
                ))}
              </div>
            )}
            {r.text}
          </div>
        ),
      )}
      {waiting && (
        <div className="simple-msg user sending">
          {(pendingImages.get(id)?.length ?? 0) > 0 && (
            <div className="msg-images">
              {pendingImages.get(id)!.map((u) => (
                <Thumb key={u} src={u} />
              ))}
            </div>
          )}
          {pending}
        </div>
      )}
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
  const [images, setImagesState] = useState<ConsoleImage[]>(() => draftImages.get(id) ?? NO_IMAGES)
  const setImages = (v: ConsoleImage[]) => {
    draftImages.set(id, v)
    setImagesState(v)
  }
  const [adding, setAdding] = useState(0) // pictures still uploading
  const [late, setLate] = useState(false)
  const heldNow = (): Held => {
    const h = heldPrompts.get(id)
    return h?.epoch === data.epoch ? h : { epoch: data.epoch, text: '', images: NO_IMAGES }
  }
  const [heldState, setHeldState] = useState(heldNow)
  const held = heldState.text
  const setHeld = (text: string, imgs: ConsoleImage[] = NO_IMAGES) => {
    const h = { epoch: data.epoch, text, images: imgs }
    heldPrompts.set(id, h)
    setHeldState(h)
  }
  const box = useRef<HTMLTextAreaElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const root = useRef<HTMLElement | null>(null)
  useEffect(() => {
    root.current = form.current?.closest<HTMLElement>('.console') ?? null
  }, [])
  useAutoGrow(box, text)
  useTypeIntoBox(root, box, (k) => setText((drafts.get(id) ?? '') + k))
  const fileRef = useRef<HTMLInputElement>(null)
  // Pictures wait in the box with the text, and go in front of it when it is sent.
  const attach = async (files: File[]) => {
    if (!files.length) return
    setAdding((n) => n + files.length)
    for (const f of files) {
      const img = await uploadImage(id, f, false)
      if (img) setImages([...(draftImages.get(id) ?? []), img])
      setAdding((n) => n - 1)
    }
  }
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
  const showImages = (imgs: ConsoleImage[]) => (imgs.length ? pendingImages.set(id, imgs.map((i) => i.url)) : pendingImages.delete(id))
  const isHeld = !!(held || heldState.images.length)
  useEffect(() => {
    const h = heldPrompts.get(id)
    if (!h || (!h.text && !h.images.length) || h.epoch === data.epoch) return
    heldPrompts.delete(id)
    setText(h.text)
    setImages(h.images)
    setHeldState({ epoch: data.epoch, text: '', images: NO_IMAGES })
    showImages(NO_IMAGES)
    showPending('')
  }, [data.epoch])
  // An empty prompt with pictures still shows as a bubble on its way.
  const deliver = (prompt: string, imgs: ConsoleImage[]) => {
    showImages(imgs)
    showPending(prompt || ' ')
    api
      .prompt(
        id,
        prompt,
        imgs.map((i) => i.path),
      )
      .catch((e) => {
        setText(prompt)
        setImages(imgs)
        showImages(NO_IMAGES)
        showPending('')
        useStore.getState().notify(`Could not send it: ${(e as Error).message}`)
      })
  }
  // A moment after it becomes free: a CLI that has just started is often still drawing its first screen.
  useEffect(() => {
    if (!isHeld || locked) return
    const t = setTimeout(() => {
      const h = heldState
      setHeld('')
      deliver(h.text, h.images)
    }, HELD_SETTLE_MS)
    return () => clearTimeout(t)
  }, [heldState, locked])

  const send = () => {
    const prompt = text.trim()
    if ((!prompt && !images.length) || adding) return
    if (data.resumeOffer) useStore.getState().updateData(id, { resumeOffer: false }) // writing starts fresh, as the offer says
    const imgs = images
    setText('')
    setImages(NO_IMAGES)
    if (locked) {
      const all = [...heldState.images, ...imgs]
      const t = held && prompt ? `${held}\n${prompt}` : held || prompt
      setHeld(t, all)
      showImages(all)
      showPending(t || ' ')
    } else deliver(prompt, imgs)
  }
  const unhold = () => {
    setText(held)
    setImages(heldState.images)
    setHeld('')
    showImages(NO_IMAGES)
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
      {isHeld && (
        <div className="held-note">
          <span>Goes as soon as {data.name} is ready</span>
          <button type="button" onClick={unhold}>
            Take it back
          </button>
        </div>
      )}
      {(images.length > 0 || adding > 0) && (
        <div className="compose-images nodrag">
          {images.map((img) => (
            <Thumb key={img.url} src={img.url} onRemove={() => setImages(images.filter((x) => x !== img))} />
          ))}
          {adding > 0 && <span className="img-thumb loading" />}
        </div>
      )}
      <form
        ref={form}
        className="simple-compose nodrag"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        onDragOver={(e) => {
          if (hasImages(e.dataTransfer)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(e) => {
          const files = imagesIn(e.dataTransfer)
          if (!files.length) return
          e.preventDefault()
          e.stopPropagation()
          attach(files)
        }}
      >
        <textarea
          ref={box}
          rows={1}
          value={text}
          placeholder={ask ? 'Write now, it goes after your answer' : status === 'paused' ? 'Write now, it goes when you resume it' : `Tell ${data.name} what to do…`}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = imagesIn(e.clipboardData)
            if (!files.length) return
            e.preventDefault()
            attach(files)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button type="button" className="round-btn" title="Add a picture (or paste or drop one here)" onClick={() => fileRef.current?.click()}>
          <ImagePlus size={15} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          multiple
          hidden
          onChange={(e) => {
            attach([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        {status === 'working' && (
          <button type="button" className="round-btn" title="Stop what it is doing" onClick={() => api.stop(id)}>
            <Square size={13} fill="currentColor" />
          </button>
        )}
        <button className="round-btn go" title="Send" disabled={(!text.trim() && !images.length) || adding > 0}>
          <ArrowUp size={15} />
        </button>
      </form>
    </div>
  )
}
