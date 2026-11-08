// Board helpers shared by the board, its menus and its toolbars.
import { useStore } from './store'

export const nid = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`

type Point = { x: number; y: number }

// A card centred on a point of the board (the middle of the view when none is given).
export function insertCard(type: string, width: number, height: number, data: Record<string, unknown>, at?: Point) {
  const s = useStore.getState()
  const c = at ?? s.viewCenter()
  const id = nid(type[0])
  s.addNode({ id, type, position: { x: c.x - width / 2, y: c.y - height / 2 }, style: { width, height }, data })
  s.reveal(id)
  return id
}

// An orchestrator lands with Connect already on: wiring is the next step.
export function addOrchestrator(at?: Point) {
  const id = insertCard('orchestrator', 380, 460, {}, at)
  useStore.getState().set({ connecting: id })
}

export function addImage(file: File, at: { x: number; y: number }) {
  if (!file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = () => {
    const img = new window.Image()
    img.onload = () => {
      const scale = Math.min(1, 480 / Math.max(img.width, img.height))
      const width = Math.round(img.width * scale)
      const height = Math.round(img.height * scale)
      // The whole board is saved on every change: store the picture at 2x its shown size, not the
      // camera original, or a few photos push the state past the server's body limit.
      let src = String(reader.result)
      const store = Math.min(1, 960 / Math.max(img.width, img.height))
      if (file.type !== 'image/svg+xml' && store < 1) {
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * store)
        canvas.height = Math.round(img.height * store)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        src = canvas.toDataURL('image/webp', 0.85)
      }
      useStore.getState().addNode({ id: nid('i'), type: 'image', position: { x: at.x - width / 2, y: at.y - height / 2 }, style: { width, height }, data: { src } })
    }
    img.src = String(reader.result)
  }
  reader.readAsDataURL(file)
}
