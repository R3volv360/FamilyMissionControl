/**
 * A photo slot (spec T7): shows the photo, or a big "Add photo" button. Picking opens the phone's own choice of
 * camera or gallery (no `capture` attribute, so both are offered). Photos are shrunk before they're kept.
 */
import { useId, useRef, useState } from 'react'
import type { Photo } from './editorState'
import { objectUrl, shrinkPhoto } from './photos'

interface Props {
  photo: Photo
  /** URL of the stored photo, for photo.kind === 'keep'. */
  keptUrl: string | null
  label: string // "Recipe photo", "Photo for step 2"
  onChange: (photo: Photo) => void
  onError: (message: string) => void
  variant?: 'hero' | 'step'
}

export function PhotoPicker({ photo, keptUrl, label, onChange, onError, variant = 'step' }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const url = photo.kind === 'new' ? objectUrl(photo.blob) : photo.kind === 'keep' ? keptUrl : null
  const inputId = useId()

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      onChange({ kind: 'new', blob: await shrinkPhoto(file) })
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = '' // picking the same file again still fires
    }
  }

  return (
    <div className={`photo-picker photo-${variant}`}>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept="image/*"
        className="visually-hidden"
        aria-label={`${url ? 'Change' : 'Add'} ${label.toLowerCase()}`}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {url ? (
        <>
          <img src={url} alt={label} />
          <div className="photo-actions">
            <label htmlFor={inputId} className="button">
              {busy ? 'Preparing…' : 'Change'}
            </label>
            <button type="button" onClick={() => onChange({ kind: 'none' })}>
              Remove photo
            </button>
          </div>
        </>
      ) : (
        <label htmlFor={inputId} className="photo-empty">
          <span aria-hidden="true">📷</span> {busy ? 'Preparing photo…' : `Add ${label.toLowerCase()}`}
        </label>
      )}
    </div>
  )
}
