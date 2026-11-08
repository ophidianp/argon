import { memo, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react'
import { Users, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { WirePick } from './ConsoleNode'
import { useStore, workspace, type GroupData, type InkData, type NoteData, type TextData } from '../store'
import { themed } from '../theme'

// Paper for sticky notes: warm, a little worn, light text on top.
export const PAPER = ['#c99a35', '#d9733a', '#c94a4f', '#4f9a66', '#3a9690', '#4a6fcf', '#7d5cd6', '#3b3833']
export const FONTS: Record<string, string> = {
  Mono: 'var(--mono)',
  Sans: "system-ui, -apple-system, sans-serif",
  Serif: "'New York', 'Iowan Old Style', Georgia, serif",
  Rounded: "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif",
  Hand: "'Bradley Hand', 'Chalkboard SE', 'Segoe Print', cursive",
  Marker: "'Marker Felt', 'Chalkboard SE', fantasy",
  Condensed: "'Avenir Next Condensed', 'Arial Narrow', sans-serif",
  Typewriter: "'American Typewriter', 'Courier New', monospace",
}
export const SIZES = { S: 16, M: 22, L: 32, XL: 48 }

function GroupNodeImpl({ id, data, selected }: NodeProps<Node<GroupData>>) {
  const members = useStore(useShallow((s) => workspace(s)?.nodes.filter((n) => n.parentId === id).map((n) => n.id) ?? []))
  const working = useStore((s) => members.filter((m) => s.live[m]?.status === 'working').length)
  const [editing, setEditing] = useState(false)
  const updateData = useStore((s) => s.updateData)
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={240} minHeight={140} />
      <Handle type="target" position={Position.Left} className="cmd-handle" isConnectable={false} />
      <div className="group-node" style={{ ['--g' as string]: data.color }}>
        <WirePick id={id} />
        <div className="group-head" onDoubleClick={() => setEditing(true)}>
          <Users size={13} color={data.color} />
          {editing ? (
            <input
              className="nodrag"
              autoFocus
              defaultValue={data.label}
              onBlur={(e) => {
                updateData(id, { label: e.target.value.trim() || data.label })
                setEditing(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            data.label
          )}
          <span className="meta">
            {members.length} · {working ? `${working} running` : 'idle'}
          </span>
          <button className="icon-btn sm nodrag ungroup" title="Ungroup (consoles stay)" onClick={() => useStore.getState().ungroup(id)}>
            <X size={13} />
          </button>
        </div>
        {!members.length && <div className="group-empty">Drag consoles here</div>}
      </div>
    </>
  )
}
export const GroupNode = memo(GroupNodeImpl)

// React Flow focuses a freshly selected node after mount; take the focus back on the next tick.
function useFocusWhenNew(ref: React.RefObject<HTMLTextAreaElement | null>, isNew: boolean) {
  useEffect(() => {
    if (!isNew) return
    const t = setTimeout(() => ref.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])
}

function NoteNodeImpl({ id, data, selected }: NodeProps<Node<NoteData>>) {
  const updateData = useStore((s) => s.updateData)
  const ref = useRef<HTMLTextAreaElement>(null)
  useFocusWhenNew(ref, !data.text)
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={120} minHeight={100} />
      <div className="note-node" style={{ ['--paper' as string]: data.color }}>
        <textarea ref={ref} className="nodrag nowheel" value={data.text} placeholder="Write something…" onChange={(e) => updateData(id, { text: e.target.value })} />
      </div>
    </>
  )
}
export const NoteNode = memo(NoteNodeImpl)

function TextNodeImpl({ id, data }: NodeProps<Node<TextData>>) {
  const updateData = useStore((s) => s.updateData)
  const [editing, setEditing] = useState(!data.text)
  const ref = useRef<HTMLTextAreaElement>(null)
  useFocusWhenNew(ref, !data.text)
  return (
    <div
      className="text-node"
      style={{ color: data.color && themed(data.color), fontFamily: FONTS[data.font ?? 'Mono'], fontSize: SIZES[data.size ?? 'M'], textAlign: data.align, opacity: data.opacity }}
      onDoubleClick={() => setEditing(true)}
    >
      {editing ? (
        <textarea
          ref={ref}
          className="nodrag nowheel"
          autoFocus
          rows={Math.max(1, data.text.split('\n').length)}
          defaultValue={data.text}
          onBlur={(e) => {
            const text = e.target.value
            if (!text.trim()) useStore.getState().removeNode(id)
            else updateData(id, { text })
            setEditing(false)
          }}
        />
      ) : (
        data.text
      )}
    </div>
  )
}
export const TextNode = memo(TextNodeImpl)

function ImageNodeImpl({ data, selected }: NodeProps<Node<{ src: string }>>) {
  return (
    <>
      <NodeResizer isVisible={selected} keepAspectRatio minWidth={80} minHeight={60} />
      <div className="image-node" style={{ width: '100%', height: '100%' }}>
        <img src={data.src} alt="" draggable={false} />
      </div>
    </>
  )
}
export const ImageNode = memo(ImageNodeImpl)

function InkNodeImpl({ data, width, height }: NodeProps<Node<InkData>>) {
  return (
    <div className="ink-node">
      <svg width={width ?? 10} height={height ?? 10}>
        {data.paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={themed(data.color)} strokeWidth={data.width ?? 3} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    </div>
  )
}
export const InkNode = memo(InkNodeImpl)
