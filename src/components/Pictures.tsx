// Pictures waiting in a composer (the bottom bar, an orchestrator), shown and removed the way a console's own
// box shows them: the same thumbnails, the same "take it out" button, a click to see it full size.
import { useRef } from 'react'
import { ImagePlus } from 'lucide-react'
import { IMAGE_TYPES } from '../consoleImages'
import type { ConsoleImage } from '../store'
import { Thumb } from './SimpleView'

export function ComposePictures({ images, adding, onRemove, className = '' }: { images: ConsoleImage[]; adding: number; onRemove: (img: ConsoleImage) => void; className?: string }) {
  if (!images.length && !adding) return null
  return (
    <div className={`compose-images nodrag nowheel ${className}`}>
      {images.map((img) => (
        <Thumb key={img.url} src={img.url} onRemove={() => onRemove(img)} />
      ))}
      {adding > 0 && <span className="img-thumb loading" />}
    </div>
  )
}

/** The picture button: picks pictures from this PC. */
export function PictureButton({ onFiles, className = 'round-btn', size = 15 }: { onFiles: (files: File[]) => void; className?: string; size?: number }) {
  const file = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className={className} title="Add a picture (or paste or drop one here)" onClick={() => file.current?.click()}>
        <ImagePlus size={size} />
      </button>
      <input
        ref={file}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        multiple
        hidden
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
    </>
  )
}
