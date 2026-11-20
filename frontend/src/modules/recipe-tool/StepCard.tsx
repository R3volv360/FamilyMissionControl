/** One method step (spec T6/T7): title, instructions (one line per bullet) and an optional photo. */
import { useId } from 'react'
import type { StepCard as Step, Photo } from './editorState'
import { PhotoPicker } from './PhotoPicker'

interface Props {
  step: Step
  number: number
  first: boolean
  last: boolean
  collapsed: boolean
  keptUrl: (from: number | null) => string | null
  onChange: (patch: Partial<Step>) => void
  onToggle: () => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
  onError: (message: string) => void
}

export function StepCard({ step, number, first, last, collapsed, keptUrl, onChange, onToggle, onMove, onRemove, onError }: Props) {
  const lines = step.text.split('\n').filter((l) => l.trim()).length
  const heading = step.title.trim() || 'Untitled step'
  const id = useId()

  return (
    <li className={`step-card${collapsed ? ' collapsed' : ''}`}>
      <div className="step-head">
        <button type="button" className="step-toggle" aria-expanded={!collapsed} onClick={onToggle}>
          <span className="step-number">{number}</span>
          <span className="step-heading">{heading}</span>
          {collapsed && (
            <span className="muted small">
              {lines} line{lines === 1 ? '' : 's'}
              {step.photo.kind !== 'none' ? ' · photo' : ''}
            </span>
          )}
        </button>
        <div className="step-tools">
          <button type="button" className="icon-button" onClick={() => onMove(-1)} disabled={first} aria-label={`Move step ${number} up`}>
            ↑
          </button>
          <button type="button" className="icon-button" onClick={() => onMove(1)} disabled={last} aria-label={`Move step ${number} down`}>
            ↓
          </button>
          <button type="button" className="icon-button danger-text" onClick={onRemove} aria-label={`Remove step ${number}`}>
            ✕
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="step-body">
          <div className="field">
            <label htmlFor={`${id}-title`}>Title</label>
            <input id={`${id}-title`} value={step.title} placeholder="e.g. Cook the rice" enterKeyHint="next" onChange={(e) => onChange({ title: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-text`}>Instructions</label>
            <textarea
              id={`${id}-text`}
              value={step.text}
              rows={Math.min(12, Math.max(4, step.text.split('\n').length + 1))}
              placeholder={'One instruction per line.\nEach line becomes a bullet point.'}
              onChange={(e) => onChange({ text: e.target.value })}
            />
          </div>
          <PhotoPicker
            photo={step.photo}
            keptUrl={step.photo.kind === 'keep' ? keptUrl(step.photo.from) : null}
            label={`Photo for step ${number}`}
            onChange={(photo: Photo) => onChange({ photo })}
            onError={onError}
          />
        </div>
      )}
    </li>
  )
}
