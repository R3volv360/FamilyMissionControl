/** What's in my Pantry (P1–P5): add staples by name, set stock levels, manage remembered names. */
import { useCallback, useEffect, useState } from 'react'
import { useConfirm } from '../../shared/ConfirmDialog'
import { ItemAutocomplete } from '../../shared/items/ItemAutocomplete'
import { KnownItemsManager } from '../../shared/items/KnownItemsManager'
import { useToast } from '../../shared/Toast'
import { LEVELS, pantryApi, type Level, type PantryEntry } from './pantryApi'
import './pantry.css'

export function PantryPage() {
  const [entries, setEntries] = useState<PantryEntry[] | null>(null)
  const [name, setName] = useState('')
  const [show, setShow] = useState<'all' | 'buy'>('all')
  const [flash, setFlash] = useState<number | null>(null)
  const confirm = useConfirm()
  const toast = useToast()

  const load = useCallback(() => {
    pantryApi
      .list()
      .then(setEntries)
      .catch((e) => toast(e.message, 'error'))
  }, [toast])

  useEffect(load, [load])

  const highlight = (id: number) => {
    setFlash(id)
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 2000)
  }

  const add = async (raw: string) => {
    const typed = raw.trim()
    if (!typed) return
    try {
      const { entry, created } = await pantryApi.add(typed)
      setName('')
      toast(created ? `Added ${entry.name}` : `${entry.name} is already in the pantry`, created ? 'success' : 'info')
      setShow('all')
      load()
      highlight(entry.id)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const setLevel = async (entry: PantryEntry, level: Level) => {
    if (level === entry.level) return
    setEntries((list) => list?.map((x) => (x.id === entry.id ? { ...x, level } : x)) ?? null) // optimistic
    try {
      await pantryApi.setLevel(entry.id, level)
    } catch (e) {
      toast((e as Error).message, 'error')
      load()
    }
  }

  const remove = async (entry: PantryEntry) => {
    const ok = await confirm({
      title: `Take ${entry.name} off the pantry list?`,
      message: 'It stays remembered, so it will still be suggested when you type.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    try {
      await pantryApi.remove(entry.id)
      load()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const toBuy = entries?.filter((e) => e.level !== 'full') ?? []
  const shown = show === 'buy' ? toBuy : (entries ?? [])

  return (
    <section>
      <h1>Pantry</h1>
      <p className="muted">
        Staples we always keep on hand.
        {entries && entries.length > 0 && ` ${entries.length} items · ${toBuy.length} to buy.`}
      </p>

      <form
        className="add-bar"
        onSubmit={(e) => {
          e.preventDefault()
          add(name)
        }}
      >
        <ItemAutocomplete value={name} onChange={setName} onSelect={add} label="Add to pantry" placeholder="Add an item, e.g. Basil" />
        <button type="submit" className="btn-primary" disabled={!name.trim()}>
          Add
        </button>
      </form>

      <div className="segmented" role="group" aria-label="Show">
        <button aria-pressed={show === 'all'} onClick={() => setShow('all')}>
          All
        </button>
        <button aria-pressed={show === 'buy'} onClick={() => setShow('buy')}>
          To buy ({toBuy.length})
        </button>
      </div>

      {entries === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="placeholder">{show === 'buy' ? 'Nothing to buy: everything is fully stocked.' : 'The pantry is empty. Add an item above.'}</p>
      ) : (
        <ul className="rows pantry-rows">
          {shown.map((entry) => (
            <li key={entry.id} className={`row${flash === entry.id ? ' flash' : ''}`}>
              <span className="row-name">{entry.name}</span>
              <span className="levels" role="radiogroup" aria-label={`Stock level for ${entry.name}`}>
                {LEVELS.map((l) => (
                  <button
                    key={l.value}
                    role="radio"
                    aria-checked={entry.level === l.value}
                    className={`level level-${l.value}`}
                    title={l.hint}
                    onClick={() => setLevel(entry, l.value)}
                  >
                    {l.label}
                  </button>
                ))}
              </span>
              <button className="icon-button" aria-label={`Remove ${entry.name}`} title="Remove from pantry" onClick={() => remove(entry)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="manage">
        <summary>Manage remembered items</summary>
        <KnownItemsManager onChanged={load} />
      </details>
    </section>
  )
}
