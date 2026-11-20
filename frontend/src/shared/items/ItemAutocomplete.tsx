/**
 * Name box that suggests remembered items while typing (P4/F4): typing "Ba" offers Basil, Balsamic Vinegar.
 * Enter with nothing highlighted, or picking a suggestion, calls onSelect with the name.
 * New names are allowed; the backend dedupes them against the central list.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { itemsApi, type Item } from './itemsApi'

interface Props {
  value: string
  onChange: (value: string) => void
  onSelect?: (name: string) => void
  label?: string
  placeholder?: string
  autoFocus?: boolean
  /** The phone keyboard's Enter key label, e.g. "next" in a list being typed in one go. */
  enterKeyHint?: React.InputHTMLAttributes<HTMLInputElement>['enterKeyHint']
}

export function ItemAutocomplete({ value, onChange, onSelect, label = 'Item name', placeholder, autoFocus, enterKeyHint }: Props) {
  const [suggestions, setSuggestions] = useState<Item[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const latest = useRef('')

  useEffect(() => {
    const q = value.trim()
    latest.current = q
    if (!q) return // list is hidden when the box is empty
    const t = setTimeout(() => {
      itemsApi
        .search(q)
        .then((items) => latest.current === q && setSuggestions(items))
        .catch(() => setSuggestions([]))
    }, 150)
    return () => clearTimeout(t)
  }, [value])

  const showList = open && value.trim() !== '' && suggestions.length > 0
  const exact = suggestions.some((s) => s.name.toLowerCase() === value.trim().toLowerCase())

  const pick = (name: string) => {
    onChange(name)
    setOpen(false)
    setActive(-1)
    onSelect?.(name)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (showList && active >= 0) pick(suggestions[active].name)
      else if (value.trim()) pick(value.trim())
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className="autocomplete">
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        enterKeyHint={enterKeyHint}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul id={listId} role="listbox" className="autocomplete-list">
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the input
              onClick={() => pick(s.name)}
            >
              <Highlight text={s.name} query={value.trim()} />
            </li>
          ))}
          {!exact && <li className="autocomplete-hint" aria-hidden="true">Enter adds “{value.trim()}” as new</li>}
        </ul>
      )}
    </div>
  )
}

/** Bold the part of each word that matches what was typed. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.toLowerCase()
  const lower = text.toLowerCase()
  let at = lower.startsWith(q) ? 0 : lower.indexOf(` ${q}`)
  if (at > 0) at += 1
  if (!q || at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <strong>{text.slice(at, at + q.length)}</strong>
      {text.slice(at + q.length)}
    </>
  )
}
