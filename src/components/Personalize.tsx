// Settings → Personalize: one-click looks, the accent, the palettes, liquid glass, Windows blur, type and size.
import { useStore } from '../store'
import { ACCENTS, DARK_PALETTES, DEFAULT_LOOK, LIGHT_PALETTES, LOOKS, UI_FONTS, useLook, type Look } from '../appearance'
import { useTheme } from '../theme'

function Slider({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="look-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="v">
        {value}
        {unit}
      </span>
    </label>
  )
}

export function Personalize() {
  const settings = useStore((s) => s.settings)
  const look = useLook()
  const theme = useTheme()
  const win = window.vibeboardDesktop?.platform === 'win32'
  const patch = (p: Partial<Look>, mode?: 'light' | 'dark') => {
    const s = useStore.getState()
    s.set({ settings: { ...s.settings, ...(mode ? { theme: mode } : {}), look: { ...look, ...p } } })
  }
  const isLook = (l: (typeof LOOKS)[number]) => (!l.mode || l.mode === theme) && Object.entries(l.set).every(([k, v]) => look[k as keyof Look] === v)
  const pal = (id: string, light: boolean) => (light ? LIGHT_PALETTES : DARK_PALETTES)[id]

  return (
    <>
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="section-label">Theme</div>
        <div className="pills">
          {(['system', 'light', 'dark'] as const).map((m) => (
            <button key={m} className={(settings.theme ?? 'system') === m ? 'on' : ''} onClick={() => useStore.getState().set({ settings: { ...settings, theme: m } })}>
              {{ system: win ? 'Same as Windows' : 'Same as my system', light: 'Light', dark: 'Dark' }[m]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div className="section-label">Looks</div>
        <div className="look-grid">
          {LOOKS.map((l) => {
            const p = l.mode === 'light' ? pal(l.set.light || look.light, true) : pal(l.set.dark || look.dark, false)
            return (
              <button key={l.name} className={`look-chip ${isLook(l) ? 'on' : ''}`} onClick={() => patch({ tint: DEFAULT_LOOK.tint, ...l.set }, l.mode)}>
                <span className="sw" style={{ background: `radial-gradient(circle at 35% 35%, ${l.set.accent} 0 34%, ${p?.panel || '#222'} 36%)` }} />
                {l.name}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div className="section-label">Accent</div>
        <div className="swatches">
          {ACCENTS.map(([name, hex]) => (
            <button key={hex} title={name} className={`swatch ${look.accent.toLowerCase() === hex ? 'on' : ''}`} style={{ background: hex }} onClick={() => patch({ accent: hex })} />
          ))}
          <span className={`swatch custom ${ACCENTS.some(([, h]) => h === look.accent.toLowerCase()) ? '' : 'on'}`} title="Any colour">
            <input type="color" value={look.accent} onChange={(e) => patch({ accent: e.target.value })} />
          </span>
        </div>
        <Slider label="Tint the window" value={look.tint} min={0} max={100} unit="%" onChange={(v) => patch({ tint: v })} />
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div className="section-label">Palette</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          <span style={{ color: 'var(--muted)' }}>Dark</span>
          <select className="look-select" value={look.dark} onChange={(e) => patch({ dark: e.target.value }, 'dark')}>
            {Object.entries(DARK_PALETTES).map(([id, p]) => (
              <option key={id} value={id}>
                {p.name}
              </option>
            ))}
          </select>
          <span style={{ color: 'var(--muted)', marginLeft: 8 }}>Light</span>
          <select className="look-select" value={look.light} onChange={(e) => patch({ light: e.target.value }, 'light')}>
            {Object.entries(LIGHT_PALETTES).map(([id, p]) => (
              <option key={id} value={id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div className="section-label">Glass</div>
        <div className="pills">
          {(['liquid', 'frosted', 'tinted', 'solid'] as const).map((g) => (
            <button key={g} className={look.glass === g ? 'on' : ''} onClick={() => patch({ glass: g })}>
              {{ liquid: 'Liquid', frosted: 'Frosted', tinted: 'Tinted', solid: 'Solid' }[g]}
            </button>
          ))}
        </div>
        {look.glass !== 'solid' && (
          <>
            <Slider label="Blur" value={look.blur} min={0} max={48} unit="px" onChange={(v) => patch({ blur: v })} />
            <Slider label="Opacity" value={look.opacity} min={10} max={100} unit="%" onChange={(v) => patch({ opacity: v })} />
            <Slider label="Refraction" value={look.refraction} min={0} max={100} onChange={(v) => patch({ refraction: v })} />
            <Slider label="Colour split" value={look.prism} min={0} max={100} onChange={(v) => patch({ prism: v })} />
          </>
        )}
      </div>

      {win && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="section-label">Behind the window</div>
          <div className="pills">
            {(['off', 'mica', 'acrylic'] as const).map((b) => (
              <button key={b} className={look.backdrop === b ? 'on' : ''} onClick={() => patch({ backdrop: b })}>
                {{ off: 'Solid', mica: 'Mica', acrylic: 'Acrylic' }[b]}
              </button>
            ))}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>Mica and Acrylic let your desktop show through the board, blurred by Windows 11.</div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        <div className="section-label">Text</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
          <span style={{ color: 'var(--muted)' }}>Font</span>
          <select className="look-select" value={look.font} onChange={(e) => patch({ font: e.target.value })}>
            {UI_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <Slider label="Interface size" value={look.scale} min={75} max={140} step={5} unit="%" onChange={(v) => patch({ scale: v })} />
      </div>

      <div>
        <button className="btn" onClick={() => patch({ ...DEFAULT_LOOK })}>
          Reset the look
        </button>
      </div>
    </>
  )
}
