import { AlignCenter, AlignLeft, AlignRight, BringToFront, Copy, Pipette, SendToBack, Trash2 } from 'lucide-react'
import type { Node } from '@xyflow/react'
import { useStore, workspace, type NoteData, type ShapeData, type TextData } from '../store'
import { FONTS, PAPER, SIZES } from './Nodes'
import { themed } from '../theme'

const STROKES = ['#ece8e2', '#1d1b18', '#ef4444', '#5fae6a', '#4a8bf0', '#f0773a', '#a98bfa']
const FILLS = ['#f0553a', '#5fae6a', '#4a8bf0', '#c9a64e', '#ef6a8a', '#a98bfa']
const INKS = ['#ece8e2', '#f0553a', '#5fae6a', '#c9a64e', '#ef4444', '#6fd6ee', '#a98bfa', '#8a847c']

// The single selected sticky, shape or text gets its style panel beside the left toolbar.
export function Inspector() {
  const node = useStore((s) => {
    const sel = workspace(s)?.nodes.filter((n) => n.selected) ?? []
    return sel.length === 1 && s.tool === 'select' && ['note', 'shape', 'text'].includes(sel[0].type ?? '') ? sel[0] : null
  })
  if (!node) return null
  const set = (patch: Record<string, unknown>) => useStore.getState().updateData(node.id, patch)
  return (
    <div className="inspector nowheel" onMouseDown={(e) => e.stopPropagation()}>
      {node.type === 'note' && <NoteStyle data={(node as Node<NoteData>).data} set={set} />}
      {node.type === 'shape' && <ShapeStyle data={(node as Node<ShapeData>).data} set={set} />}
      {node.type === 'text' && <TextStyle data={(node as Node<TextData>).data} set={set} />}
      <div className="row actions">
        <button title="Bring to front" onClick={() => useStore.getState().reorderNode(node.id, 'front')}>
          <BringToFront size={15} />
        </button>
        <button title="Send to back" onClick={() => useStore.getState().reorderNode(node.id, 'back')}>
          <SendToBack size={15} />
        </button>
        <button title="Duplicate" onClick={() => useStore.getState().duplicateNode(node.id)}>
          <Copy size={15} />
        </button>
        <button title="Delete" className="danger" onClick={() => useStore.getState().removeNode(node.id)}>
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )
}

function Swatches({ colors, value, onPick, none }: { colors: string[]; value: string; onPick: (c: string) => void; none?: boolean }) {
  const custom = value !== 'none' && !colors.includes(value)
  return (
    <div className="row">
      {none && <button className={`swatch none ${value === 'none' ? 'on' : ''}`} title="None" onClick={() => onPick('none')} />}
      {colors.map((c) => (
        <button key={c} className={`swatch ${value === c ? 'on' : ''}`} style={{ background: themed(c) }} title={c} onClick={() => onPick(c)} />
      ))}
      <label className={`swatch custom ${custom ? 'on' : ''}`} style={custom ? { background: value } : undefined} title="Custom colour">
        <Pipette size={11} />
        <input type="color" value={custom ? value : '#ffffff'} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  )
}

type Set = (patch: Record<string, unknown>) => void

function NoteStyle({ data, set }: { data: NoteData; set: Set }) {
  return (
    <>
      <div className="section-label">Paper</div>
      <Swatches colors={PAPER} value={data.color} onPick={(color) => set({ color })} />
    </>
  )
}

const Stroke = ({ w, dash }: { w: number; dash?: string }) => (
  <svg width="30" height="10" viewBox="0 0 30 10">
    <line x1="2" y1="5" x2="28" y2="5" stroke="currentColor" strokeLinecap="round" strokeWidth={w} strokeDasharray={dash} />
  </svg>
)

function ShapeStyle({ data, set }: { data: ShapeData; set: Set }) {
  const closed = data.kind !== 'line' && data.kind !== 'arrow'
  return (
    <>
      <div className="section-label">Stroke</div>
      <Swatches colors={STROKES} value={data.stroke} onPick={(stroke) => set({ stroke })} />
      {closed && (
        <>
          <div className="section-label">Background</div>
          <Swatches colors={FILLS} value={data.fill} onPick={(fill) => set({ fill })} none />
        </>
      )}
      <div className="section-label">Stroke width</div>
      <div className="row opts">
        {[1, 2, 4].map((w) => (
          <button key={w} className={data.strokeWidth === w ? 'on' : ''} onClick={() => set({ strokeWidth: w })}>
            <Stroke w={w + 1} />
          </button>
        ))}
      </div>
      <div className="section-label">Stroke style</div>
      <div className="row opts">
        {(['solid', 'dashed', 'dotted'] as const).map((d) => (
          <button key={d} className={data.dash === d ? 'on' : ''} title={d} onClick={() => set({ dash: d })}>
            <Stroke w={2} dash={d === 'dashed' ? '6 4' : d === 'dotted' ? '0 4' : undefined} />
          </button>
        ))}
      </div>
      {closed && data.kind !== 'ellipse' && (
        <>
          <div className="section-label">Edges</div>
          <div className="row opts">
            {[false, true].map((round) => (
              <button key={String(round)} className={data.round === round ? 'on' : ''} title={round ? 'Round' : 'Sharp'} onClick={() => set({ round })}>
                <svg width="16" height="16" viewBox="0 0 16 16">
                  <rect x="2" y="2" width="12" height="12" rx={round ? 4 : 0} fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </button>
            ))}
          </div>
        </>
      )}
      <Opacity value={data.opacity} set={set} />
    </>
  )
}

function TextStyle({ data, set }: { data: TextData; set: Set }) {
  return (
    <>
      <div className="section-label">Colour</div>
      <Swatches colors={INKS} value={data.color ?? INKS[0]} onPick={(color) => set({ color })} />
      <div className="section-label">Font</div>
      <div className="fonts">
        {Object.entries(FONTS).map(([name, family]) => (
          <button key={name} className={(data.font ?? 'Mono') === name ? 'on' : ''} style={{ fontFamily: family }} onClick={() => set({ font: name })}>
            {name}
          </button>
        ))}
      </div>
      <div className="section-label">Size</div>
      <div className="row opts">
        {(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((size) => (
          <button key={size} className={(data.size ?? 'M') === size ? 'on' : ''} onClick={() => set({ size })}>
            {size}
          </button>
        ))}
      </div>
      <div className="section-label">Align</div>
      <div className="row opts">
        {(
          [
            ['left', <AlignLeft size={15} />],
            ['center', <AlignCenter size={15} />],
            ['right', <AlignRight size={15} />],
          ] as const
        ).map(([align, icon]) => (
          <button key={align} className={(data.align ?? 'left') === align ? 'on' : ''} onClick={() => set({ align })}>
            {icon}
          </button>
        ))}
      </div>
      <Opacity value={data.opacity ?? 1} set={set} />
    </>
  )
}

function Opacity({ value, set }: { value: number; set: Set }) {
  return (
    <>
      <div className="section-label">Opacity</div>
      <div className="row opacity">
        <input type="range" min={0.1} max={1} step={0.05} value={value} onChange={(e) => set({ opacity: Number(e.target.value) })} />
        <span>{Math.round(value * 100)}%</span>
      </div>
    </>
  )
}
