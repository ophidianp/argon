import { useEffect, useState } from 'react'
import {
  Activity,
  AlarmClock,
  ChevronDown,
  ChevronUp,
  Clock,
  Crosshair,
  Ellipsis,
  Footprints,
  GitCommitVertical,
  LayoutGrid,
  ListChecks,
  Moon,
  Play,
  Plus,
  Repeat,
  ScanText,
  Search,
  ShieldCheck,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react'
import { api, type Loop } from '../api'
import { consoles, project, useStore, workspace } from '../store'

type Trigger = 'schedule' | 'idle' | 'output'
const INTERVALS: [string, number][] = [
  ['5 min', 5],
  ['10 min', 10],
  ['15 min', 15],
  ['30 min', 30],
  ['1 h', 60],
  ['2 h', 120],
]
// The stepper's stops, in minutes.
const STEPS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440]

type Template = { name: string; icon: React.ReactNode; about: string; instruction: string; trigger: Trigger; minutes?: number; pattern?: string }
const TEMPLATES: Template[] = [
  {
    name: 'Progress check',
    icon: <Activity size={15} />,
    about: 'Every 15 min, each agent says what it got done, what comes next and what is in its way.',
    instruction: 'Give a short progress report: what you finished since the last check, what you are doing next, and anything blocking you.',
    trigger: 'schedule',
    minutes: 15,
  },
  {
    name: 'Keep them moving',
    icon: <Footprints size={15} />,
    about: 'When an agent goes idle, it picks up the next task, so the team never stalls.',
    instruction: 'If your current task is done, pick up the next open task and keep going. If nothing is left, say so in one line.',
    trigger: 'idle',
  },
  {
    name: 'Build rescue',
    icon: <Wrench size={15} />,
    about: 'As soon as a console prints FAILED, that agent stops and fixes the failure first.',
    instruction: 'The last command failed. Stop what you are doing, find the root cause of the failure and fix it before moving on.',
    trigger: 'output',
    pattern: 'FAILED',
  },
  {
    name: 'Test watchdog',
    icon: <ShieldCheck size={15} />,
    about: 'Every 30 min the test suite runs, and anything failing gets fixed right there.',
    instruction:
      'Run the test suite. If anything fails, fix the root cause (not the test), run it again and commit the fix with a short message. If everything passes, reply only "ALL GREEN".',
    trigger: 'schedule',
    minutes: 30,
  },
  {
    name: 'Commit checkpoint',
    icon: <GitCommitVertical size={15} />,
    about: 'Every 20 min the work in progress is committed with a clear message, so nothing gets lost.',
    instruction: 'Commit your working changes now with a clear message that says what changed. Do not push.',
    trigger: 'schedule',
    minutes: 20,
  },
  {
    name: 'Review sweep',
    icon: <Search size={15} />,
    about: 'Every 30 min the latest changes are checked for bugs and dead code, and fixed.',
    instruction: 'Review the changes made since the last sweep for bugs, dead code and missed edge cases, and fix what you find.',
    trigger: 'schedule',
    minutes: 30,
  },
  {
    name: 'Hourly standup',
    icon: <AlarmClock size={15} />,
    about: 'Once an hour, every agent writes a three-line standup: done, doing, blocked.',
    instruction: 'Write a three-line standup: done, doing, blocked.',
    trigger: 'schedule',
    minutes: 60,
  },
]

const minutesLabel = (m: number) => (m % 60 === 0 ? `${m / 60} h` : `${m} min`)

export function LoopsModal() {
  const loops = useStore((s) => s.loops)
  const [form, setForm] = useState<{ loop?: Loop; template?: Template } | null>(null)
  const close = () => useStore.getState().set({ modal: null })
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal narrow loops-modal">
        <div className="modal-head">
          <span className="ico">
            <Repeat size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <h2>Loops</h2>
            <div className="sub">Recurring instructions for your agents — on a schedule, when they go idle, or when their output says so. Loops can stop themselves when a goal is met.</div>
          </div>
          {!form && loops.length > 0 && (
            <button className="btn primary pill-btn" onClick={() => setForm({})}>
              <Plus size={15} /> New loop
            </button>
          )}
          <button className="icon-btn" onClick={close}>
            <X size={18} />
          </button>
        </div>
        {form ? (
          <LoopForm key={form.loop?.id ?? form.template?.name ?? 'new'} initial={form.loop} template={form.template} onDone={() => setForm(null)} />
        ) : loops.length ? (
          <div className="modal-body nowheel">
            <LoopList loops={loops} onEdit={(loop) => setForm({ loop })} />
          </div>
        ) : (
          <div className="modal-body nowheel">
            <Autopilot onPick={(template) => setForm({ template })} />
          </div>
        )}
      </div>
    </div>
  )
}

function Autopilot({ onPick }: { onPick: (t?: Template) => void }) {
  return (
    <div className="autopilot">
      <span className="ico big">
        <Repeat size={24} />
      </span>
      <h3>Put your agents on autopilot</h3>
      <p>
        A loop sends one instruction to your consoles at a fixed interval, whenever an agent finishes and goes idle, or the moment a console prints something you care about. Give it a
        goal and it retires itself once the job is really done.
      </p>
      <div className="section-label" style={{ justifySelf: 'start' }}>
        Templates
      </div>
      <div className="tpl-grid">
        {TEMPLATES.map((t) => (
          <button key={t.name} className="tpl-card" onClick={() => onPick(t)}>
            <div className="t">
              {t.icon} {t.name}
            </div>
            <div className="s">{t.about}</div>
          </button>
        ))}
      </div>
      <button className="btn" style={{ borderRadius: 20, marginTop: 10 }} onClick={() => onPick()}>
        Start from scratch
      </button>
    </div>
  )
}

// Ticks once a second so the countdown moves.
export function useNow() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

const describe = (l: Loop) => {
  const when = l.trigger.type === 'schedule' ? `Every ${minutesLabel(Math.round(l.trigger.everyMs / 60000))}` : l.trigger.type === 'idle' ? 'When an agent goes idle' : `When output contains “${l.trigger.pattern}”`
  const who = l.target?.ids ? `${l.target.ids.length} console${l.target.ids.length === 1 ? '' : 's'}` : 'All consoles'
  const until = l.stop.goal ? (l.stop.goal.type === 'judge' ? 'until Claude calls it met' : `until \`${l.stop.goal.command}\` passes`) : l.stop.runs ? `for ${l.stop.runs} runs` : l.stop.timeMs ? `for ${Math.round(l.stop.timeMs / 3600000)} h` : null
  return [when, who, until, l.background !== false ? 'background' : 'this tab only'].filter(Boolean).join(' · ')
}

function LoopList({ loops, onEdit }: { loops: Loop[]; onEdit: (l: Loop) => void }) {
  const now = useNow()
  const [menu, setMenu] = useState<string | null>(null)
  const notify = useStore((s) => s.notify)
  const fail = (e: Error) => notify(`Loop: ${e.message}`)
  return (
    <div className="loops">
      {loops.map((l) => {
        const left = l.active && l.trigger.type === 'schedule' && l.nextAt ? Math.max(0, l.nextAt - now) : null
        return (
          <div key={l.id} className={`loop-row ${l.active ? '' : 'off'}`}>
            <span className="dot" style={{ background: l.active ? 'var(--accent)' : 'var(--faint)' }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <div className="name">
                {l.name} <span className="runs">{l.runs} run{l.runs === 1 ? '' : 's'}</span>
              </div>
              <div className="what">{l.active ? describe(l) : `Stopped: ${l.finishedReason}`}</div>
              <div className="instr">{l.instruction}</div>
            </span>
            {left !== null && (
              <span className="countdown">
                in {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}
              </span>
            )}
            <button
              className="round-btn sm"
              title="Run now"
              disabled={!l.active}
              onClick={() =>
                api
                  .runLoop(l.id)
                  .then((r) => notify(`${l.name}: sent to ${r.consoles} console${r.consoles === 1 ? '' : 's'}`))
                  .catch(fail)
              }
            >
              <Play size={13} fill="currentColor" />
            </button>
            <button className={`toggle ${l.active ? 'on' : ''}`} title={l.active ? 'Turn off' : 'Turn on'} onClick={() => api.setLoopActive(l.id, !l.active).catch(fail)} />
            <span style={{ position: 'relative' }}>
              <button className="icon-btn sm" onClick={() => setMenu(menu === l.id ? null : l.id)}>
                <Ellipsis size={16} />
              </button>
              {menu === l.id && (
                <div className="menu" style={{ right: 0, top: 30, width: 150, padding: 6 }} onMouseLeave={() => setMenu(null)}>
                  <button
                    className="menu-item"
                    onClick={() => {
                      setMenu(null)
                      onEdit(l)
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="menu-item"
                    style={{ color: 'var(--accent)' }}
                    onClick={() => {
                      setMenu(null)
                      api.removeLoop(l.id).catch(fail)
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function LoopForm({ initial, template, onDone }: { initial?: Loop; template?: Template; onDone: () => void }) {
  const nodes = useStore((s) => workspace(s)?.nodes)
  const all = consoles(nodes ?? [])
  const goal0 = initial?.stop.goal
  const [name, setName] = useState(initial?.name ?? template?.name ?? '')
  const [instruction, setInstruction] = useState(initial?.instruction ?? template?.instruction ?? '')
  const [trigger, setTrigger] = useState<Trigger>(initial?.trigger.type ?? template?.trigger ?? 'schedule')
  const [minutes, setMinutes] = useState(initial?.trigger.type === 'schedule' ? Math.round(initial.trigger.everyMs / 60000) : template?.minutes ?? 15)
  const [pattern, setPattern] = useState(initial?.trigger.type === 'output' ? initial.trigger.pattern : template?.pattern ?? '')
  const [pick, setPick] = useState(!!initial?.target?.ids)
  const [picked, setPicked] = useState<string[]>(initial?.target?.ids ?? [])
  const [runsOn, setRunsOn] = useState(!!initial?.stop.runs)
  const [runs, setRuns] = useState(initial?.stop.runs ?? 10)
  const [timeOn, setTimeOn] = useState(!!initial?.stop.timeMs)
  const [hours, setHours] = useState(initial?.stop.timeMs ? initial.stop.timeMs / 3600000 : 2)
  const [goalOn, setGoalOn] = useState(initial ? !!goal0 : true)
  const [goalType, setGoalType] = useState<'command' | 'judge'>(goal0?.type ?? 'judge')
  const [goal, setGoal] = useState(goal0 ? (goal0.type === 'command' ? goal0.command : goal0.text) : '')
  const [background, setBackground] = useState(initial?.background ?? true)

  const useTemplate = (t: Template) => {
    setName(t.name)
    setInstruction(t.instruction)
    setTrigger(t.trigger)
    if (t.minutes) setMinutes(t.minutes)
    if (t.pattern) setPattern(t.pattern)
  }
  const step = (dir: 1 | -1) => {
    const i = STEPS.findIndex((m) => m >= minutes)
    const at = i < 0 ? STEPS.length - 1 : STEPS[i] === minutes ? i + dir : dir > 0 ? i : i - 1
    setMinutes(STEPS[Math.max(0, Math.min(STEPS.length - 1, at))])
  }

  const targetCount = pick ? picked.length : all.length
  const when = trigger === 'schedule' ? `Every ${minutesLabel(minutes)}` : trigger === 'idle' ? 'Whenever a targeted agent goes idle' : `Whenever a console prints “${pattern || '…'}”`
  const who = pick ? `${picked.length} picked console${picked.length === 1 ? '' : 's'}` : 'every console on the board'
  const until = goalOn && goal.trim() ? (goalType === 'judge' ? ', until Claude judges the goal met' : `, until \`${goal.trim()}\` passes`) : runsOn ? `, for ${runs} runs` : timeOn ? `, for ${hours} h` : ''
  const rate =
    trigger === 'schedule'
      ? `≈ ${((60 / minutes) * Math.max(1, targetCount)).toFixed(1)} prompts/h across ${Math.max(1, targetCount)} console${targetCount === 1 ? '' : 's'}`
      : 'fires on events · 10 s cooldown per console'

  const save = async () => {
    const { notify } = useStore.getState()
    if (!instruction.trim()) return notify('Write the instruction to send')
    // An empty pick would otherwise read as "no filter" and hit every console.
    if (pick && !picked.length) return notify('Pick at least one console')
    if (trigger === 'output') {
      if (!pattern.trim()) return notify('Write the text or regex to watch for')
      try {
        new RegExp(pattern, 'i')
      } catch {
        return notify('That pattern is not a valid regular expression')
      }
    }
    const body: Partial<Loop> = {
      name: name.trim(),
      instruction: instruction.trim(),
      trigger: trigger === 'schedule' ? { type: 'schedule', everyMs: minutes * 60000 } : trigger === 'idle' ? { type: 'idle' } : { type: 'output', pattern },
      target: pick ? { ids: picked } : {},
      scope: initial?.scope ?? project(useStore.getState())?.path,
      background,
      stop: {
        ...(runsOn ? { runs: Math.max(1, Math.round(runs)) } : {}),
        ...(timeOn ? { timeMs: hours * 3600000 } : {}),
        ...(goalOn && goal.trim() ? { goal: goalType === 'command' ? { type: 'command' as const, command: goal.trim() } : { type: 'judge' as const, text: goal.trim() } } : {}),
      },
    }
    try {
      await (initial ? api.updateLoop(initial.id, body) : api.addLoop(body))
    } catch (e) {
      return notify(`Loop not saved: ${(e as Error).message}`)
    }
    onDone()
  }

  return (
    <>
      <div className="modal-body nowheel">
        <div className="loops">
          <div className="field-group">
            <div className="section-label">Templates</div>
            <div className="tpl-chips">
              {TEMPLATES.map((t) => (
                <button key={t.name} className={name === t.name ? 'on' : ''} onClick={() => useTemplate(t)}>
                  {t.icon} {t.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field-group">
            <div className="section-label">Name</div>
            <input className="field" placeholder="Optional. Named from the instruction if left blank." value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field-group">
            <div className="section-label">Instruction</div>
            <textarea className="field" placeholder="e.g. Run the test suite. If anything fails, fix it and run again." value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            <div className="hint">Typed into each targeted console exactly as written.</div>
          </div>

          <div className="field-group">
            <div className="section-label">When</div>
            <div className="trigger-cards">
              <button className={`trigger ${trigger === 'schedule' ? 'on' : ''}`} onClick={() => setTrigger('schedule')}>
                <Clock size={19} className="ico" />
                <span>
                  <div className="t">On a schedule</div>
                  <div className="s">Repeats at a fixed interval.</div>
                </span>
              </button>
              <button className={`trigger ${trigger === 'idle' ? 'on' : ''}`} onClick={() => setTrigger('idle')}>
                <Moon size={19} className="ico" />
                <span>
                  <div className="t">When an agent goes idle</div>
                  <div className="s">Fires the moment a targeted console finishes.</div>
                </span>
              </button>
              <button className={`trigger ${trigger === 'output' ? 'on' : ''}`} onClick={() => setTrigger('output')}>
                <ScanText size={19} className="ico" />
                <span>
                  <div className="t">When output contains…</div>
                  <div className="s">Fires when a console prints matching text.</div>
                </span>
              </button>
            </div>
            {trigger === 'schedule' && (
              <div className="interval-row">
                <div className="pills">
                  {INTERVALS.map(([label, m]) => (
                    <button key={m} className={minutes === m ? 'on' : ''} onClick={() => setMinutes(m)}>
                      {label}
                    </button>
                  ))}
                </div>
                <span className="spacer" />
                <span className="stepper mono">
                  every {minutesLabel(minutes)}
                  <span className="arrows">
                    <button onClick={() => step(1)} title="Longer">
                      <ChevronUp size={11} />
                    </button>
                    <button onClick={() => step(-1)} title="Shorter">
                      <ChevronDown size={11} />
                    </button>
                  </span>
                </span>
              </div>
            )}
            {trigger === 'output' && <input className="field mono" placeholder="Text or regex, e.g. tests? failed" value={pattern} onChange={(e) => setPattern(e.target.value)} />}
          </div>

          <div className="field-group">
            <div className="section-label">Target</div>
            <button className={`radio-row ${!pick ? 'on' : ''}`} onClick={() => setPick(false)}>
              <span className="radio" />
              <LayoutGrid size={17} color="var(--muted)" />
              <span className="t">All consoles</span>
              <span className="s">{all.length} on the board, plus any opened later</span>
            </button>
            <button className={`radio-row ${pick ? 'on' : ''}`} onClick={() => setPick(true)}>
              <span className="radio" />
              <ListChecks size={17} color="var(--muted)" />
              <span className="t">Pick consoles</span>
              <span className="s">Choose exactly which consoles receive it</span>
            </button>
            {pick && (
              <div className="pills" style={{ paddingLeft: 8 }}>
                {all.map((n) => (
                  <button key={n.id} className={picked.includes(n.id) ? 'on' : ''} onClick={() => setPicked((p) => (p.includes(n.id) ? p.filter((x) => x !== n.id) : [...p, n.id]))}>
                    {n.data.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="field-group">
            <div className="section-label">Stop</div>
            <div className="list-box" style={{ padding: '10px 18px', display: 'grid', gap: 6 }}>
              <div className="toggle-row">
                <button className={`toggle ${runsOn ? 'on' : ''}`} onClick={() => setRunsOn((v) => !v)} />
                After a number of runs
                {runsOn && <input className="field" style={{ width: 90, padding: '6px 10px' }} type="number" min={1} value={runs} onChange={(e) => setRuns(Number(e.target.value) || 1)} />}
              </div>
              <div className="toggle-row">
                <button className={`toggle ${timeOn ? 'on' : ''}`} onClick={() => setTimeOn((v) => !v)} />
                After a time limit
                {timeOn && (
                  <>
                    <input className="field" style={{ width: 90, padding: '6px 10px' }} type="number" min={1} value={hours} onChange={(e) => setHours(Number(e.target.value) || 1)} /> h
                  </>
                )}
              </div>
              <div className="toggle-row">
                <button className={`toggle ${goalOn ? 'on' : ''}`} onClick={() => setGoalOn((v) => !v)} />
                When a goal is met
              </div>
              {goalOn && (
                <div style={{ display: 'grid', gap: 10, paddingLeft: 58, paddingBottom: 6 }}>
                  <div className="pills" style={{ alignItems: 'center' }}>
                    <button className={goalType === 'command' ? 'on' : ''} onClick={() => setGoalType('command')}>
                      <SquareTerminal size={14} style={{ marginRight: 6, verticalAlign: -2 }} />A command passes
                    </button>
                    <button className={goalType === 'judge' ? 'on' : ''} onClick={() => setGoalType('judge')}>
                      <Crosshair size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                      An agent judges
                    </button>
                    {goalType === 'judge' && <span style={{ color: 'var(--text-2)', fontSize: 13.5, marginLeft: 6 }}>Claude</span>}
                  </div>
                  <input
                    className="field mono"
                    placeholder={goalType === 'command' ? 'e.g. npm test' : 'e.g. All tests pass and the README documents the new flag'}
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                  />
                  <div className="hint">
                    {goalType === 'command'
                      ? 'Runs in the repo folder when a targeted agent settles and before each scheduled round; exit 0 finishes the loop.'
                      : 'A throwaway Claude session reads the console output and gives a verdict — it never changes anything. Checked when a targeted agent settles and before each scheduled round.'}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="field-group">
            <div className="section-label">Behavior</div>
            <div className="toggle-row">
              <button className={`toggle ${background ? 'on' : ''}`} onClick={() => setBackground((v) => !v)} />
              <span>
                Keep running behind other tabs
                <div className="hint">
                  On, the loop keeps firing into its consoles while you look at another workspace tab. Off, it pauses with its tab and catches up when you come back.
                </div>
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="loop-foot">
        <span style={{ flex: 1, minWidth: 0 }}>
          <div className="summary">
            {when}, the instruction is sent to {who}
            {until}.
          </div>
          <div className="rate mono">{rate}</div>
        </span>
        <button className="btn ghost-plain" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary pill-btn" onClick={save}>
          {initial ? 'Save loop' : 'Create loop'}
        </button>
      </div>
    </>
  )
}
