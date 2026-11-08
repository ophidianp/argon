import { memo, useState } from 'react'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { CalendarDays, Check, ChevronDown, ChevronUp, Clock, Columns3, ListChecks, MoreHorizontal, Plus, Square, Trash2, X } from 'lucide-react'
import { useStore, type CalEvent, type CalendarData, type ChecklistData, type KanbanCard, type KanbanData, type Priority } from '../store'
import { addDays, isoDay, monthGrid } from '../../shared/calendar.js'

const uid = () => crypto.randomUUID().slice(0, 8)
const today = () => isoDay(new Date())
const shortDay = (iso: string) => new Date(`${iso}T00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' })

export const PRIORITY: Record<Priority, { label: string; color: string }> = {
  none: { label: 'None', color: 'var(--line-2)' },
  low: { label: 'Low', color: '#5fae6a' },
  med: { label: 'Med', color: '#e0a43a' },
  high: { label: 'High', color: '#ef4444' },
}

function Head({ id, icon, title }: { id: string; icon: React.ReactNode; title: string }) {
  return (
    <div className="card-head pl-head">
      {icon}
      <span className="t">{title}</span>
      <span className="spacer" />
      <button className="icon-btn sm nodrag" title="Remove" onClick={() => useStore.getState().removeNode(id)}>
        <X size={14} />
      </button>
    </div>
  )
}

// HTML5 drag inside a node: the payload names the node, so a card never lands on another board.
const dragData = (e: React.DragEvent, type: string, payload: object) => {
  e.dataTransfer.setData(type, JSON.stringify(payload))
  e.dataTransfer.effectAllowed = 'move'
}
const dropData = <T,>(e: React.DragEvent, type: string): T | null => {
  const raw = e.dataTransfer.getData(type)
  return raw ? (JSON.parse(raw) as T) : null
}

// ---------- board (kanban) ----------
type Column = { id: string; title: string; cards: KanbanCard[] }
const CARD = 'application/x-vibeboard-card'
const columnsOf = (data: KanbanData): Column[] =>
  data.columns.map((c, i) => ({
    id: c.id ?? `col${i}`,
    title: c.title,
    cards: c.cards.map((k, j) => (typeof k === 'string' ? { id: `c${i}-${j}`, title: k, priority: 'none' as Priority } : k)),
  }))
export const NEW_BOARD: KanbanData = { columns: ['Backlog', 'To do', 'In progress', 'Done'].map((title) => ({ id: uid(), title, cards: [] })) }

function dueLabel(due: string) {
  const t = today()
  return due === t ? 'Today' : due === addDays(t, 1) ? 'Tomorrow' : shortDay(due)
}

function BoardNodeImpl({ id, data, selected }: NodeProps<Node<KanbanData>>) {
  const columns = columnsOf(data)
  const save = (next: Column[]) => useStore.getState().updateData(id, { columns: next })
  const [dialog, setDialog] = useState<{ col: string; card?: KanbanCard } | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  const upsert = (col: string, card: KanbanCard) =>
    save(columns.map((c) => (c.id !== col ? c : c.cards.some((k) => k.id === card.id) ? { ...c, cards: c.cards.map((k) => (k.id === card.id ? card : k)) } : { ...c, cards: [...c.cards, card] })))
  const removeCard = (cardId: string) => save(columns.map((c) => ({ ...c, cards: c.cards.filter((k) => k.id !== cardId) })))
  const move = (cardId: string, toCol: string, before?: string) => {
    const card = columns.flatMap((c) => c.cards).find((k) => k.id === cardId)
    if (!card || cardId === before) return
    save(
      columns.map((c) => {
        const cards = c.cards.filter((k) => k.id !== cardId)
        if (c.id !== toCol) return { ...c, cards }
        const at = before ? cards.findIndex((k) => k.id === before) : -1
        return { ...c, cards: at < 0 ? [...cards, card] : [...cards.slice(0, at), card, ...cards.slice(at)] }
      }),
    )
  }
  const onDrop = (e: React.DragEvent, col: string, before?: string) => {
    setOver(null)
    const d = dropData<{ node: string; card: string }>(e, CARD)
    if (!d || d.node !== id) return
    e.preventDefault()
    e.stopPropagation()
    move(d.card, col, before)
  }
  // While a card is dragged, a line shows where it will land: before a card, or at the column's end.
  const [over, setOver] = useState<{ col: string; before?: string } | null>(null)
  const accepts = (col: string, before?: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(CARD)) return
    e.preventDefault()
    e.stopPropagation()
    if (over?.col !== col || over.before !== before) setOver({ col, before })
  }

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={480} minHeight={260} />
      <div className="card-node planner">
        <Head id={id} icon={<Columns3 size={15} color="var(--muted)" />} title="Board" />
        <div className="kb nodrag nowheel">
          {columns.map((col) => (
            <div key={col.id} className="kb-col" onDragOver={accepts(col.id)} onDragLeave={(e) => e.currentTarget === e.target && setOver(null)} onDrop={(e) => onDrop(e, col.id)}>
              <div className="kb-colhead">
                <i />
                {renaming === col.id ? (
                  <input
                    autoFocus
                    defaultValue={col.title}
                    onBlur={(e) => {
                      save(columns.map((c) => (c.id === col.id ? { ...c, title: e.target.value.trim() || c.title } : c)))
                      setRenaming(null)
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <span className="name">{col.title}</span>
                )}
                <span className="n">{col.cards.length}</span>
                <span className="spacer" />
                <button className="icon-btn sm" title="Column" onClick={() => setMenu(menu === col.id ? null : col.id)}>
                  <MoreHorizontal size={14} />
                </button>
                {menu === col.id && (
                  <div className="pl-menu" onMouseLeave={() => setMenu(null)}>
                    <button onClick={() => (setRenaming(col.id), setMenu(null))}>Rename</button>
                    <button onClick={() => save(columns.map((c) => (c.id === col.id ? { ...c, cards: c.cards.filter((k) => !k.done) } : c)))}>Clear completed</button>
                    <button className="danger" onClick={() => (save(columns.filter((c) => c.id !== col.id)), setMenu(null))}>
                      Delete column
                    </button>
                  </div>
                )}
              </div>
              {col.cards.map((card) => (
                <div
                  key={card.id}
                  className={`kb-card ${card.done ? 'done' : ''} ${over?.col === col.id && over.before === card.id ? 'drop-before' : ''}`}
                  draggable
                  onDragStart={(e) => dragData(e, CARD, { node: id, card: card.id })}
                  onDragEnd={() => setOver(null)}
                  onDragOver={accepts(col.id, card.id)}
                  onDrop={(e) => onDrop(e, col.id, card.id)}
                  onClick={() => setDialog({ col: col.id, card })}
                >
                  <span className="bar" style={{ background: PRIORITY[card.priority].color }} />
                  <button
                    className="kb-del"
                    title="Delete card"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeCard(card.id)
                    }}
                  >
                    <X size={12} />
                  </button>
                  <button
                    className="tick"
                    title={card.done ? 'Mark as not done' : 'Mark as done'}
                    onClick={(e) => {
                      e.stopPropagation()
                      upsert(col.id, { ...card, done: !card.done })
                    }}
                  >
                    {card.done && <Check size={10} strokeWidth={3.5} />}
                  </button>
                  <div className="body">
                    <div className="t">{card.title}</div>
                    {card.notes && <div className="notes">{card.notes}</div>}
                    {(card.due || card.priority !== 'none') && (
                      <div className="chips">
                        {card.due && (
                          <span className={`chip due ${!card.done && card.due < today() ? 'late' : ''}`}>
                            <CalendarDays size={10} /> {dueLabel(card.due)}
                          </span>
                        )}
                        {card.priority !== 'none' && (
                          <span className="chip" style={{ color: PRIORITY[card.priority].color }}>
                            <i style={{ background: PRIORITY[card.priority].color }} /> {PRIORITY[card.priority].label}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {over?.col === col.id && !over.before && col.cards.length > 0 && <div className="kb-drop" />}
              {!col.cards.length && (
                <div className={`kb-empty ${over?.col === col.id ? 'over' : ''}`}>
                  <Square size={14} /> No cards
                </div>
              )}
              <button className="kb-add" onClick={() => setDialog({ col: col.id })}>
                <Plus size={13} /> Add card
              </button>
            </div>
          ))}
          <button
            className="kb-newcol"
            onClick={() => {
              const col = { id: uid(), title: 'New column', cards: [] }
              save([...columns, col])
              setRenaming(col.id)
            }}
          >
            <Plus size={16} />
            Column
          </button>
        </div>
        {dialog && (
          <CardDialog
            initial={dialog.card}
            onClose={() => setDialog(null)}
            onSave={(card) => (upsert(dialog.col, card), setDialog(null))}
            onDelete={dialog.card && (() => (removeCard(dialog.card!.id), setDialog(null)))}
          />
        )}
      </div>
    </>
  )
}
export const BoardNode = memo(BoardNodeImpl)

function CardDialog({ initial, onSave, onClose, onDelete }: { initial?: KanbanCard; onSave: (c: KanbanCard) => void; onClose: () => void; onDelete?: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [due, setDue] = useState(initial?.due ?? '')
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'none')
  const t = today()
  const presets: [string, string][] = [
    ['Today', t],
    ['Tomorrow', addDays(t, 1)],
    ['Next week', addDays(t, 7)],
  ]
  const submit = () => title.trim() && onSave({ ...initial, id: initial?.id ?? uid(), title: title.trim(), notes: notes.trim() || undefined, due: due || undefined, priority })
  return (
    <div className="pl-overlay nodrag nowheel" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pl-dialog" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="pl-dhead">
          <span className="section-label">{initial ? 'Edit card' : 'New card'}</span>
          <span className="spacer" />
          <button className="icon-btn sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <label className="pl-field title">
          <i style={{ background: PRIORITY[priority].color }} />
          <input autoFocus placeholder="Card title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        <textarea className="pl-field" placeholder="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="pl-field row">
          <CalendarDays size={14} color="var(--muted)" />
          {presets.map(([label, date]) => (
            <button key={label} className={`pl-chip ${due === date ? 'on' : ''}`} onClick={() => setDue(due === date ? '' : date)}>
              {label}
            </button>
          ))}
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} title="Pick a date" />
        </div>
        <div className="pl-seg">
          {(Object.keys(PRIORITY) as Priority[]).map((p) => (
            <button key={p} className={priority === p ? 'on' : ''} onClick={() => setPriority(p)}>
              {p !== 'none' && <i style={{ background: PRIORITY[p].color }} />}
              {PRIORITY[p].label}
            </button>
          ))}
        </div>
        <div className="pl-actions">
          {onDelete && (
            <button className="icon-btn sm danger" title="Delete card" onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          )}
          <span className="spacer" />
          <button className="btn ghost-plain" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!title.trim()} onClick={submit}>
            {initial ? 'Save' : 'Add card'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- calendar ----------
const EVENT = 'application/x-vibeboard-event'
export const EVENT_COLORS = ['#e0773a', '#5fae6a', '#4a8bf0', '#a98bfa', '#ef6a8a', '#3fb8a8']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function CalendarNodeImpl({ id, data, selected }: NodeProps<Node<CalendarData>>) {
  const events = data.events ?? []
  const save = (next: CalEvent[]) => useStore.getState().updateData(id, { events: next })
  const t = today()
  const [month, setMonth] = useState(t.slice(0, 7))
  const [y, m] = month.split('-').map(Number)
  const shift = (n: number) => setMonth(isoDay(new Date(y, m - 1 + n, 1)).slice(0, 7))
  const [dialog, setDialog] = useState<{ date: string; event?: CalEvent } | null>(null)
  const grid = monthGrid(y, m - 1)
  const upsert = (ev: CalEvent) => save(events.some((e) => e.id === ev.id) ? events.map((e) => (e.id === ev.id ? ev : e)) : [...events, ev])

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={420} minHeight={360} />
      <div className="card-node planner">
        <Head id={id} icon={<CalendarDays size={15} color="var(--muted)" />} title="Calendar" />
        <div className="cal nodrag nowheel">
          <div className="cal-top">
            <b>{new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' })}</b>
            <span className="spacer" />
            <button className="pl-chip accent" onClick={() => setDialog({ date: month === t.slice(0, 7) ? t : `${month}-01` })}>
              <Plus size={12} /> New
            </button>
            <button className="pl-chip" onClick={() => setMonth(t.slice(0, 7))}>
              Today
            </button>
            <button className="icon-btn sm" title="Previous month" onClick={() => shift(-1)}>
              <ChevronUp size={14} />
            </button>
            <button className="icon-btn sm" title="Next month" onClick={() => shift(1)}>
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="cal-dow">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="cal-grid">
            {grid.map((c) => (
              <div
                key={c.date}
                className={`cal-cell ${c.inMonth ? '' : 'out'} ${c.date === t ? 'is-today' : ''}`}
                onClick={() => setDialog({ date: c.date })}
                onDragOver={(e) => e.dataTransfer.types.includes(EVENT) && e.preventDefault()}
                onDrop={(e) => {
                  const d = dropData<{ node: string; event: string }>(e, EVENT)
                  if (!d || d.node !== id) return
                  e.preventDefault()
                  save(events.map((ev) => (ev.id === d.event ? { ...ev, date: c.date } : ev)))
                }}
              >
                <span className={`num ${c.date === t ? 'today' : ''}`}>{c.day === 1 ? shortDay(c.date) : c.day}</span>
                {events
                  .filter((ev) => ev.date === c.date)
                  .map((ev) => (
                    <button
                      key={ev.id}
                      className="cal-ev"
                      style={{ ['--c' as string]: ev.color }}
                      draggable
                      onDragStart={(e) => dragData(e, EVENT, { node: id, event: ev.id })}
                      onClick={(e) => {
                        e.stopPropagation()
                        setDialog({ date: ev.date, event: ev })
                      }}
                      title={ev.notes || ev.title}
                    >
                      {!ev.allDay && ev.start && <span className="time">{ev.start}</span>}
                      {ev.title}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
        {dialog && (
          <EventDialog
            date={dialog.date}
            initial={dialog.event}
            onClose={() => setDialog(null)}
            onSave={(ev) => (upsert(ev), setDialog(null))}
            onDelete={dialog.event && (() => (save(events.filter((e) => e.id !== dialog.event!.id)), setDialog(null)))}
          />
        )}
      </div>
    </>
  )
}
export const CalendarNode = memo(CalendarNodeImpl)

function EventDialog({ date, initial, onSave, onClose, onDelete }: { date: string; initial?: CalEvent; onSave: (e: CalEvent) => void; onClose: () => void; onDelete?: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [day, setDay] = useState(initial?.date ?? date)
  const [allDay, setAllDay] = useState(initial?.allDay ?? true)
  const [start, setStart] = useState(initial?.start ?? '09:00')
  const [end, setEnd] = useState(initial?.end ?? '10:00')
  const [color, setColor] = useState(initial?.color ?? EVENT_COLORS[0])
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const submit = () =>
    title.trim() &&
    day &&
    onSave({ id: initial?.id ?? uid(), title: title.trim(), date: day, allDay, ...(allDay ? {} : { start, end }), color, notes: notes.trim() || undefined })
  return (
    <div className="pl-overlay nodrag nowheel" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pl-dialog" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="pl-dhead">
          <input className="ev-title" autoFocus placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <button className="icon-btn sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <label className="pl-line">
          <CalendarDays size={14} color="var(--muted)" />
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <div className="pl-line">
          <Clock size={14} color="var(--muted)" />
          All day
          <span className="spacer" />
          <button className={`switch ${allDay ? 'on' : ''}`} onClick={() => setAllDay(!allDay)} aria-pressed={allDay}>
            <i />
          </button>
        </div>
        {!allDay && (
          <div className="pl-line">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />–
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        )}
        <div className="pl-line">
          {EVENT_COLORS.map((c) => (
            <button key={c} className={`dot-pick ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
        <textarea className="pl-field" placeholder="Add notes…" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="pl-actions">
          {onDelete && (
            <button className="icon-btn sm danger" title="Delete event" onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          )}
          <span className="spacer" />
          <button className="btn ghost-plain" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!title.trim()} onClick={submit}>
            {initial ? 'Save' : 'Add event'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- checklist ----------
function ChecklistNodeImpl({ id, data, selected }: NodeProps<Node<ChecklistData>>) {
  const items = data.items ?? []
  const save = (next: ChecklistData['items']) => useStore.getState().updateData(id, { items: next })
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const done = items.filter((i) => i.done).length
  const add = () => {
    if (!draft.trim()) return
    save([...items, { id: uid(), text: draft.trim(), done: false }])
    setDraft('')
  }
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={240} minHeight={240} />
      <div className="card-node planner">
        <Head id={id} icon={<ListChecks size={15} color="var(--muted)" />} title="Checklist" />
        <div className="cl nodrag nowheel">
          <div className="cl-sum">
            <span className="ring" style={{ ['--p' as string]: `${items.length ? (done / items.length) * 360 : 0}deg` }}>
              <b>{items.length - done}</b>
            </span>
            <span>
              <b>{items.length ? (done === items.length ? 'All done' : `${items.length - done} to go`) : 'No objectives'}</b>
              <small>{items.length ? `${done} of ${items.length} done` : 'Add one to begin'}</small>
            </span>
          </div>
          {!items.length && [70, 52, 60].map((w) => <div key={w} className="cl-ghost" style={{ ['--w' as string]: `${w}%` }} />)}
          {items.map((it) => (
            <div key={it.id} className={`cl-item ${it.done ? 'done' : ''}`}>
              <button className="tick" onClick={() => save(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}>
                {it.done && <Check size={10} strokeWidth={3.5} />}
              </button>
              {editing === it.id ? (
                <input
                  autoFocus
                  defaultValue={it.text}
                  onBlur={(e) => {
                    save(items.map((x) => (x.id === it.id ? { ...x, text: e.target.value.trim() || x.text } : x)))
                    setEditing(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              ) : (
                <span className="text" onDoubleClick={() => setEditing(it.id)}>
                  {it.text}
                </span>
              )}
              <button className="icon-btn sm del" title="Remove" onClick={() => save(items.filter((x) => x.id !== it.id))}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <label className="cl-add nodrag">
          <Plus size={14} />
          <input placeholder="Add an objective" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </label>
      </div>
    </>
  )
}
export const ChecklistNode = memo(ChecklistNodeImpl)
