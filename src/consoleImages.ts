// Pictures put into a console, the bottom bar or an orchestrator: pasted, dropped or picked from this PC. The server
// keeps the file and the agent gets its path, which Claude Code and Codex turn into an attached image; the console
// shows the picture itself.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { api } from './api'
import { useStore, workspace, type ConsoleData, type ConsoleImage } from './store'

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_BYTES = 15 * 1024 * 1024
const KEEP = 8 // pictures shown along a terminal's bottom edge

/** The pictures in a paste or a drop. */
export const imagesIn = (dt: DataTransfer | null) => [...(dt?.files ?? [])].filter((f) => IMAGE_TYPES.includes(f.type))
export const hasImages = (dt: DataTransfer | null) => !!dt && [...dt.items].some((i) => i.kind === 'file' && IMAGE_TYPES.includes(i.type))

const base64 = (f: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(f)
  })

// The same checks and messages wherever a picture goes in.
async function save(file: File, send: (body: { type: string; data: string }) => Promise<ConsoleImage>): Promise<ConsoleImage | null> {
  const s = useStore.getState()
  if (!IMAGE_TYPES.includes(file.type)) {
    s.notify('Only PNG, JPEG, GIF and WebP pictures can be added.')
    return null
  }
  if (file.size > MAX_BYTES) {
    s.notify('That picture is larger than 15 MB.')
    return null
  }
  try {
    return await send({ type: file.type, data: await base64(file) })
  } catch (e) {
    s.notify(`Could not add the picture: ${(e as Error).message}`)
    return null
  }
}

/** Saves a picture for console `id`. With `insert` it is also typed into the agent at once (terminal view). */
export const uploadImage = (id: string, file: File, insert: boolean) => save(file, (body) => api.consoleImage(id, { ...body, insert }))

/**
 * Pictures waiting in a composer (the bottom bar, an orchestrator) for the message they go with. They are saved
 * at once under `owner`; whoever the message goes to gets them by path.
 */
export function useComposeImages(owner: string) {
  const [images, setImages] = useState<ConsoleImage[]>([])
  const [adding, setAdding] = useState(0)
  const attach = async (files: File[]) => {
    for (const f of files) {
      setAdding((n) => n + 1)
      const img = await save(f, (body) => api.attachImage(owner, body))
      if (img) setImages((cur) => [...cur, img].slice(0, 10))
      setAdding((n) => n - 1)
    }
  }
  const remove = (img: ConsoleImage) => setImages((cur) => cur.filter((x) => x !== img))
  const clear = () => setImages([])
  // Paste and drop on the composer, as on a console.
  const handlers = {
    onPaste: (e: React.ClipboardEvent) => {
      const files = imagesIn(e.clipboardData)
      if (!files.length) return
      e.preventDefault()
      attach(files)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasImages(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDrop: (e: React.DragEvent) => {
      const files = imagesIn(e.dataTransfer)
      if (!files.length) return
      e.preventDefault()
      e.stopPropagation()
      attach(files)
    },
  }
  return { images, adding, attach, remove, clear, handlers }
}

/** Typed into the terminal now, and shown along the console's bottom edge. */
export async function insertImages(id: string, files: File[]) {
  for (const f of files) {
    const img = await uploadImage(id, f, true)
    if (!img) continue
    const s = useStore.getState()
    const d = workspace(s)?.nodes.find((n) => n.id === id)?.data as ConsoleData | undefined
    s.updateData(id, { images: [...(d?.images ?? []), img].slice(-KEEP) })
  }
}

/**
 * Typing anywhere in `root` (the console or orchestrator last clicked) goes into its text box, even when the box
 * itself isn't focused: the first key moves the caret there and the rest follow. A lone space with an empty box is
 * left alone, so holding space still dictates.
 */
export function useTypeIntoBox(root: RefObject<HTMLElement | null>, box: RefObject<HTMLTextAreaElement | null>, append: (key: string) => void, enabled = true) {
  const inside = useRef(false)
  const add = useRef(append)
  add.current = append
  useEffect(() => {
    if (!enabled) return
    const down = (e: PointerEvent) => (inside.current = !!root.current?.contains(e.target as Node))
    const key = (e: KeyboardEvent) => {
      if (!inside.current || !box.current || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.key.length !== 1) return
      const t = document.activeElement as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"], .xterm')) return
      if (useStore.getState().modal) return
      if (e.key === ' ' && !box.current.value) return
      e.preventDefault()
      e.stopPropagation()
      add.current(e.key)
      const b = box.current
      b.focus()
      requestAnimationFrame(() => b.setSelectionRange(b.value.length, b.value.length))
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [enabled])
}

/** A text box that grows with what is in it, line by line, up to `max` pixels, then scrolls. */
export function useAutoGrow(box: RefObject<HTMLTextAreaElement | null>, value: string, max = 220) {
  useEffect(() => {
    const b = box.current
    if (!b) return
    b.style.height = 'auto'
    b.style.height = `${Math.min(b.scrollHeight, max)}px`
    b.style.overflowY = b.scrollHeight > max ? 'auto' : 'hidden'
  }, [value, max])
}
