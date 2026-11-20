/** Tap-to-add alternative to dragging (phones, keyboards): pick a recipe for a day from a searchable list. */
import { useEffect, useRef, useState } from 'react'
import { fileUrl, type RecipeSummary } from '../recipes/recipesApi'
import { dayLabel } from './dates'

interface Props {
  day: string
  recipes: RecipeSummary[]
  onPick: (slug: string) => void
  onClose: () => void
}

export function RecipePicker({ day, recipes, onPick, onClose }: Props) {
  const [filter, setFilter] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const shown = recipes.filter((r) => r.title.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal picker" role="dialog" aria-modal="true" aria-labelledby="picker-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="picker-title">Add a meal to {dayLabel(day)}</h2>
        <input
          ref={input}
          aria-label="Find a recipe"
          placeholder="Find a recipe…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && shown.length === 1 && onPick(shown[0].slug)}
        />
        <ul className="picker-list">
          {shown.map((r) => (
            <li key={r.slug}>
              <button onClick={() => onPick(r.slug)}>
                <img src={fileUrl(r, 'hero.jpg')} alt="" />
                <span>{r.title}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="muted">{recipes.length ? `No recipes match “${filter}”.` : 'No recipes yet.'}</li>}
        </ul>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
