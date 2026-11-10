// Settings, as a sheet with tabs (General, Agents, Appearance, Updates, Data, About): grouped rows, segments whose pill
// glides to the picked option, switches and sliders.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { askNotifyPermission, useStore } from '../store'
import { AGENTS } from '../../shared/agents.js'
import { ACCENTS, DARK_PALETTES, DEFAULT_LOOK, LIGHT_PALETTES, LOOK_TINT, LOOKS, UI_FONTS, useLook, type Look } from '../appearance'
import { useTheme } from '../theme'
import { AgentIcon } from './icons'
import { checkForUpdates, setUpdateMode, setUpdatePrefs, updater } from '../updates'
import { atomColors, drawAtom } from '../appicon'

type Tab = 'general' | 'agents' | 'look' | 'updates' | 'data' | 'about'
const WIN = window.vibeboardDesktop?.platform === 'win32'

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  useLayoutEffect(() => {
    const place = () => {
      const on = box.current?.querySelector<HTMLElement>('button.on')
      const p = pill.current
      if (!on || !p || !on.offsetWidth) return
      if (first.current) p.style.transition = 'none'
      p.style.width = on.offsetWidth + 'px'
      p.style.transform = `translateX(${on.offsetLeft}px)`
      if (first.current) requestAnimationFrame(() => (p.style.transition = ''))
      first.current = false
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(box.current!)
    return () => ro.disconnect()
  }, [value])
  return (
    <div className="seg" ref={box}>
      <div className="seg-pill" ref={pill} />
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Range({ id, value, min, max, step = 1, unit = '', onChange }: { id: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="range">
      <input id={id} type="range" min={min} max={max} step={step} value={value} style={{ ['--pct' as string]: pct + '%' }} onChange={(e) => onChange(Number(e.target.value))} aria-label={id} />
      <output>
        {value}
        {unit}
      </output>
    </div>
  )
}

const Switch = ({ id, on, onChange }: { id: string; on: boolean; onChange: (v: boolean) => void }) => <input id={id} type="checkbox" className="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />

function Row({ title, desc, stack, children }: { title: string; desc?: ReactNode; stack?: boolean; children?: ReactNode }) {
  return (
    <div className={`srow ${stack ? 'stack' : ''}`}>
      <div className="lbl">
        <b>{title}</b>
        {desc && <span>{desc}</span>}
      </div>
      {children}
    </div>
  )
}
const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <>
    <div className="group-title">{title}</div>
    <div className="sgroup">{children}</div>
  </>
)

export function SettingsSheet() {
  const settings = useStore((s) => s.settings)
  const installed = useStore((s) => s.installed)
  const look = useLook()
  const theme = useTheme()
  const [tab, setTab] = useState<Tab>('general')
  const [closing, setClosing] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const s = useStore.getState()
  const patch = (p: Partial<typeof settings>) => s.set({ settings: { ...useStore.getState().settings, ...p } })
  const patchLook = (p: Partial<Look>, mode?: 'light' | 'dark') => {
    const cur = useStore.getState().settings
    s.set({ settings: { ...cur, ...(mode ? { theme: mode } : {}), look: { ...look, ...p } } })
  }
  const close = () => {
    if (!look.anim || matchMedia('(prefers-reduced-motion: reduce)').matches) return s.set({ modal: null })
    setClosing(true)
    setTimeout(() => s.set({ modal: null }), 260)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })
  const pick = (t: Tab) => {
    setTab(t)
    if (body.current) body.current.scrollTop = 0
  }
  const isLook = (l: (typeof LOOKS)[number]) => (!l.mode || l.mode === theme) && Object.entries(l.set).every(([k, v]) => look[k as keyof Look] === v)

  return (
    <div className={`sheet-scrim ${closing ? 'out' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className={`set-sheet ${closing ? 'out' : ''}`} aria-label="Settings">
        <div className="grab" />
        <div className="sh-head">
          <h2>Settings</h2>
          <button className="icon-btn" title="Close" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="sh-body" ref={body}>
          <div className="set-tabs" role="tablist">
            {(
              [
                ['general', 'General'],
                ['agents', 'Agents'],
                ['look', 'Appearance'],
                ['updates', 'Updates'],
                ['data', 'Data'],
                ['about', 'About'],
              ] as [Tab, string][]
            ).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pick(k)}>
                {l}
              </button>
            ))}
          </div>

          <div className="set-pane" key={tab}>
            {tab === 'general' && (
              <>
                <Group title="Theme">
                  <Row title="Day or night" desc={WIN ? 'Same as Windows follows your system.' : 'Same as my system follows your computer.'} stack>
                    <Seg
                      value={settings.theme ?? 'system'}
                      options={[
                        ['system', WIN ? 'Same as Windows' : 'Same as my system'],
                        ['light', 'Light'],
                        ['dark', 'Dark'],
                      ]}
                      onChange={(v) => patch({ theme: v })}
                    />
                  </Row>
                </Group>
                <Group title="New agents">
                  <Row title="Default agent" desc="Presets and new consoles start with this one." stack>
                    <Seg
                      value={settings.defaultAgent}
                      options={AGENTS.filter((a) => installed.includes(a.id)).map((a) => [
                        a.id,
                        <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <AgentIcon id={a.id} size={16} /> {a.name}
                        </span>,
                      ])}
                      onChange={(v) => patch({ defaultAgent: v })}
                    />
                  </Row>
                  <Row title="Open in the simple view" desc="A conversation and plain buttons instead of a terminal. Each agent can switch at any time.">
                    <Switch id="tg-simple" on={settings.simpleView === true} onChange={(v) => patch({ simpleView: v })} />
                  </Row>
                </Group>
                <Group title="Alerts">
                  <Row title="Tell me when an agent needs me" desc="Only while you are in another window. Click it to jump to the agent.">
                    <Switch
                      id="tg-notify"
                      on={settings.notify !== false}
                      onChange={(v) => {
                        if (v) askNotifyPermission()
                        patch({ notify: v })
                      }}
                    />
                  </Row>
                  <Row title="Speak planner replies" desc="After a voice command, with the system voice.">
                    <Switch id="tg-speak" on={settings.speak !== false} onChange={(v) => patch({ speak: v })} />
                  </Row>
                </Group>
              </>
            )}

            {tab === 'agents' && (
              <>
                <Group title="Permissions">
                  <Row title="Auto-approve" desc="New agents do not ask before acting: Claude starts with --dangerously-skip-permissions. Only on projects you trust.">
                    <Switch id="tg-yolo" on={settings.yolo} onChange={(v) => patch({ yolo: v })} />
                  </Row>
                </Group>
                <Group title="Accounts">
                  <Row
                    title="Extra sign-ins"
                    desc={settings.profiles?.length ? `${settings.profiles.length} extra sign-in${settings.profiles.length > 1 ? 's' : ''}` : 'Run a second sign-in of Claude or Codex side by side.'}
                  >
                    <button className="mini" onClick={() => s.set({ modal: 'usage', usageView: 'accounts' })}>
                      Manage
                    </button>
                  </Row>
                </Group>
                <Group title="Terminal">
                  <Row title="Font size" stack>
                    <Seg value={settings.fontSize} options={[11, 12, 13, 14, 15, 16].map((n) => [n, String(n)])} onChange={(v) => patch({ fontSize: v })} />
                  </Row>
                </Group>
                <Group title="Wires">
                  <Row title="How teams hand over" desc="A wire from one agent to the next says “when done”: what the first one did goes to the second, with its role." stack />
                </Group>
              </>
            )}

            {tab === 'look' && (
              <>
                <Group title="Looks">
                  <Row title="One tap" desc="Claude, Codex, Gemini and Copilot are styled after each agent." stack>
                    <div className="onb-grid">
                      {LOOKS.map((l) => {
                        const p = l.mode === 'light' ? LIGHT_PALETTES[l.set.light || look.light] : DARK_PALETTES[l.set.dark || look.dark]
                        return (
                          <button key={l.name} className={`onb-card ${isLook(l) ? 'on' : ''}`} onClick={() => patchLook({ tint: LOOK_TINT, ...l.set }, l.mode)}>
                            <div className="onb-swatch" style={{ background: `linear-gradient(135deg, ${p.bg}, ${p.panel2})` }}>
                              {[l.set.accent, p.text, p.muted].map((c, i) => (
                                <i key={i} style={{ background: c }} />
                              ))}
                            </div>
                            <b>{l.name}</b>
                            <span>{l.mode === 'light' ? 'Light' : 'Dark'}</span>
                          </button>
                        )
                      })}
                    </div>
                  </Row>
                </Group>
                <Group title="Color">
                  <Row title="Accent" desc="It tints the window, the terminals and the taskbar icon." stack>
                    <div className="swatches">
                      {ACCENTS.map(([name, hex]) => (
                        <button key={hex} title={name} aria-label={name} className={`swatch ${look.accent.toLowerCase() === hex ? 'on' : ''}`} style={{ background: hex }} onClick={() => patchLook({ accent: hex })} />
                      ))}
                      <span className={`swatch custom ${ACCENTS.some(([, h]) => h === look.accent.toLowerCase()) ? '' : 'on'}`} title="Any colour">
                        <input type="color" value={look.accent} onChange={(e) => patchLook({ accent: e.target.value })} aria-label="Any colour" />
                      </span>
                    </div>
                  </Row>
                  <Row title="Tint the window">
                    <Range id="rg-tint" value={look.tint} min={0} max={100} unit="%" onChange={(v) => patchLook({ tint: v })} />
                  </Row>
                  <Row title="Dark palette" stack>
                    <Seg value={look.dark} options={Object.entries(DARK_PALETTES).map(([k, p]) => [k, p.name])} onChange={(v) => patchLook({ dark: v }, 'dark')} />
                  </Row>
                  <Row title="Light palette" stack>
                    <Seg value={look.light} options={Object.entries(LIGHT_PALETTES).map(([k, p]) => [k, p.name])} onChange={(v) => patchLook({ light: v }, 'light')} />
                  </Row>
                </Group>
                <Group title="Liquid glass">
                  <Row title="Style" stack>
                    <Seg
                      value={look.glass}
                      options={[
                        ['liquid', 'Liquid'],
                        ['frosted', 'Frosted'],
                        ['tinted', 'Tinted'],
                        ['solid', 'Solid'],
                      ]}
                      onChange={(v) => patchLook({ glass: v })}
                    />
                  </Row>
                  {look.glass !== 'solid' && (
                    <>
                      <Row title="Blur">
                        <Range id="rg-blur" value={look.blur} min={0} max={48} unit="px" onChange={(v) => patchLook({ blur: v })} />
                      </Row>
                      <Row title="Opacity">
                        <Range id="rg-opacity" value={look.opacity} min={10} max={100} unit="%" onChange={(v) => patchLook({ opacity: v })} />
                      </Row>
                      <Row title="Refraction" desc="The rim bends what is behind it.">
                        <Range id="rg-refraction" value={look.refraction} min={0} max={100} onChange={(v) => patchLook({ refraction: v })} />
                      </Row>
                      <Row title="Chromatic aberration" desc="A little red and blue split, strongest at the rim.">
                        <Range id="rg-prism" value={look.prism} min={0} max={100} unit="%" onChange={(v) => patchLook({ prism: v })} />
                      </Row>
                    </>
                  )}
                </Group>
                <Group title="Window and motion">
                  {WIN && (
                    <Row title="Behind the window" desc="Mica and Acrylic let your desktop show through, blurred by Windows 11." stack>
                      <Seg
                        value={look.backdrop}
                        options={[
                          ['off', 'Solid'],
                          ['mica', 'Mica'],
                          ['acrylic', 'Acrylic'],
                        ]}
                        onChange={(v) => patchLook({ backdrop: v })}
                      />
                    </Row>
                  )}
                  <Row title="Font">
                    <select className="look-select" value={look.font} onChange={(e) => patchLook({ font: e.target.value })}>
                      {UI_FONTS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </Row>
                  <Row title="Interface size">
                    <Range id="rg-scale" value={look.scale} min={75} max={140} step={5} unit="%" onChange={(v) => patchLook({ scale: v })} />
                  </Row>
                  <Row title="Animations" desc="Springs, glides and fly-to.">
                    <Switch id="tg-anim" on={look.anim} onChange={(v) => patchLook({ anim: v })} />
                  </Row>
                </Group>
                <button className="mini spaced" onClick={() => patchLook({ ...DEFAULT_LOOK })}>
                  Reset to Ember
                </button>
              </>
            )}

            {tab === 'updates' && <UpdatesPane />}
            {tab === 'about' && <AboutPane />}
            {tab === 'data' && (
              <>
                <Group title="Where it lives">
                  <Row title="Your boards" desc={WIN ? 'Boards, loops and settings are saved on this PC in %APPDATA%\\Argon.' : 'Boards, loops and settings are saved on your disk.'} stack />
                </Group>
                <Group title="Shortcuts">
                  <div className="set-keys">
                    {[
                      ['Ctrl 0', 'Fit the board'],
                      ['Ctrl Z', 'Bring back what you closed'],
                      ['Backspace', 'Close what is selected'],
                      ['Space (hold)', 'Talk to the ask bar'],
                      ['Esc', 'Leave the current tool or panel'],
                    ].map(([k, l]) => (
                      <div key={k}>
                        <kbd>{k}</kbd>
                        <span>{l}</span>
                      </div>
                    ))}
                  </div>
                </Group>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

// Settings → Updates. Only the installed app updates itself; a checkout updates with git.
function UpdatesPane() {
  const prefs = useStore((s) => s.settings.updates)
  const mode = prefs?.mode === 'auto' ? 'auto' : 'ask'
  const [version, setVersion] = useState('…')
  const [status, setStatus] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const up = updater()
  useEffect(() => {
    up?.version().then(setVersion, () => setVersion('unknown'))
  }, [up])
  if (!up)
    return (
      <Group title="Updates">
        <Row title="Updates" desc="Updates work in the installed Argon app. This copy runs from source, so it updates with git." stack />
      </Group>
    )
  const last = prefs?.lastCheck ? `Last checked ${new Date(prefs.lastCheck).toLocaleString()}` : 'Not checked yet'
  return (
    <>
      <Group title="Updates">
        <Row title="Version" desc="The Argon you are running.">
          <span className="set-value">{version}</span>
        </Row>
        <Row title="When an update is out" desc="Automatic downloads it in the background and installs it when you close Argon. Ask first shows you what is new and lets you pick." stack>
          <Seg
            value={mode}
            options={[
              ['auto', 'Automatic'],
              ['ask', 'Ask first'],
            ]}
            onChange={setUpdateMode}
          />
        </Row>
        <Row title="Check for updates" desc={checking ? 'Checking…' : (status ?? last)}>
          <button
            className="btn"
            disabled={checking}
            onClick={async () => {
              setChecking(true)
              setStatus(await checkForUpdates(true))
              setChecking(false)
            }}
          >
            Check now
          </button>
        </Row>
      </Group>
      {prefs?.skip && (
        <Group title="Skipped">
          <Row title="Skipped version" desc={`You skipped ${prefs.skip}. It comes back if you clear this.`}>
            <button className="btn" onClick={() => setUpdatePrefs({ skip: undefined })}>
              Clear
            </button>
          </Row>
        </Group>
      )}
      <Group title="Safety">
        <Row title="Signed releases" desc="Argon installs an update only if it carries Argon's own signature. Installing closes Argon, so it asks first when agents are running." stack />
      </Group>
    </>
  )
}

// Settings → About: the atom in the current accent (the same drawing as the taskbar icon), the version, credits.
function AboutPane() {
  useLook() // redraw when the look changes
  const atom = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const k = atomColors()
    if (atom.current && k) drawAtom(atom.current, k, 192)
  })
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noreferrer">
      {text}
    </a>
  )
  return (
    <>
      <div className="about-hero">
        <canvas ref={atom} className="about-atom" aria-label="The Argon logo" role="img" />
        <h3>Argon</h3>
        <span className="about-version">Version {__APP_VERSION__}</span>
        <p>A board where your coding agents run side by side in real terminals, and hand work to one another along wires.</p>
      </div>
      <Group title="Credits">
        <Row title="Made by" desc="Pavan Nemani" />
        <Row title="Built on vibeboard" desc={<>Argon is built on {link('https://github.com/ricca200xx/vibeboard', 'vibeboard')} by Riccardo Niccolò Agosti, used under the MIT License.</>} stack />
        <Row title="Open-source parts" desc="Electron, React, React Flow, xterm.js, node-pty, zustand and Lucide icons, each under its own licence." stack />
      </Group>
      <Group title="Argon">
        <Row title="Source code" desc={link('https://github.com/ophidianp/argon', 'github.com/ophidianp/argon')} />
        <Row title="Copyright" desc="© 2026 Pavan Nemani. All rights reserved." />
      </Group>
    </>
  )
}
