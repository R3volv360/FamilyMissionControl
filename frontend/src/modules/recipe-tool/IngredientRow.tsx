/**
 * One ingredient (spec T3–T5): amount on the number keypad, unit from a native picker (a wheel or sheet on a
 * phone), and the name with suggestions from remembered items. Less-used actions sit behind a "⋯" button so the
 * row stays one line on a phone.
 */
import { useEffect, useRef } from 'react'
import { ItemAutocomplete } from '../../shared/items/ItemAutocomplete'
import { badNumber, changeUnit, UNIT_LABELS, UNITS, type UnitChoice } from './amount'
import type { IngredientRow as Row } from './editorState'

interface Props {
  row: Row
  index: number // 1-based within its section, for labels
  first: boolean
  last: boolean
  expanded: boolean
  focus: boolean // put the cursor in the amount box (a row just added)
  onChange: (patch: Partial<Row>) => void
  onNext: () => void // Enter in the name box: go to the next row (adding one at the end)
  onToggle: () => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
}

export function IngredientRow({ row, index, first, last, expanded, focus, onChange, onNext, onToggle, onMove, onRemove }: Props) {
  const amountRef = useRef<HTMLInputElement>(null)
  const noun = row.cupboard ? 'cupboard staple' : 'ingredient'
  const what = row.name.trim() || `${noun} ${index}`

  useEffect(() => {
    if (focus) amountRef.current?.focus()
  }, [focus])

  const units: UnitChoice[] = row.unit === 'written' ? ['written', ...UNITS] : [...UNITS]

  return (
    <li className={`ing-row${expanded ? ' expanded' : ''}`}>
      <div className="ing-main">
        <input
          ref={amountRef}
          className={`ing-amount${badNumber(row) ? ' invalid' : ''}`}
          aria-label={`Amount for ${what}`}
          inputMode={row.unit === 'written' ? 'text' : 'decimal'}
          enterKeyHint="next"
          placeholder="Qty"
          value={row.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.currentTarget.closest('.ing-row')?.querySelector('[role="combobox"]') as HTMLElement | null)?.focus()
            }
          }}
        />
        <select
          className="ing-unit"
          aria-label={`Unit for ${what}`}
          value={row.unit}
          onChange={(e) => onChange(changeUnit(row, e.target.value as UnitChoice))}
        >
          {units.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABELS[u]}
            </option>
          ))}
        </select>
        <div className="ing-name">
          <ItemAutocomplete
            label={`${row.cupboard ? 'Cupboard staple' : 'Ingredient'} ${index} name`}
            placeholder="Ingredient"
            value={row.name}
            onChange={(name) => onChange({ name })}
            onSelect={onNext}
            enterKeyHint="next"
          />
        </div>
        <button type="button" className="icon-button" aria-label={`More for ${what}`} aria-expanded={expanded} onClick={onToggle}>
          ⋯
        </button>
      </div>
      {expanded && (
        <div className="ing-actions">
          <button type="button" onClick={() => onMove(-1)} disabled={first} aria-label={`Move ${what} up`}>
            ↑ Up
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={last} aria-label={`Move ${what} down`}>
            ↓ Down
          </button>
          <button type="button" onClick={() => onChange({ cupboard: !row.cupboard })}>
            {row.cupboard ? 'Move to ingredients' : 'Cupboard staple'}
          </button>
          <button type="button" className="danger-text" onClick={onRemove} aria-label={`Remove ${what}`}>
            Remove
          </button>
        </div>
      )}
    </li>
  )
}
