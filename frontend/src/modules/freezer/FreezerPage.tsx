/** What's in my Freezer (F1–F5): items with their total in grams and pack breakdown. */
import { useCallback, useEffect, useState } from 'react'
import { useConfirm } from '../../shared/ConfirmDialog'
import { KnownItemsManager } from '../../shared/items/KnownItemsManager'
import { useToast } from '../../shared/Toast'
import { AddFreezerItem } from './AddFreezerItem'
import { freezerApi, type FreezerEntry, type Pack } from './freezerApi'
import './freezer.css'
import { parseGrams } from './grams'

export function FreezerPage() {
  const [entries, setEntries] = useState<FreezerEntry[] | null>(null)
  const [flash, setFlash] = useState<number | null>(null)
  const toast = useToast()

  const load = useCallback(() => {
    freezerApi
      .list()
      .then(setEntries)
      .catch((e) => toast(e.message, 'error'))
  }, [toast])

  useEffect(load, [load])

  const replace = (entry: FreezerEntry) => setEntries((list) => list?.map((e) => (e.id === entry.id ? entry : e)) ?? null)

  const onAdded = (entry: FreezerEntry) => {
    load()
    setFlash(entry.id)
    setTimeout(() => setFlash((f) => (f === entry.id ? null : f)), 2000)
  }

  return (
    <section>
      <h1>Freezer</h1>
      <p className="muted">
        What's in the freezer, by weight and pack.
        {entries && entries.length > 0 && ` ${entries.length} items.`}
      </p>

      <AddFreezerItem onAdded={onAdded} />

      {entries === null ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="placeholder">The freezer is empty.</p>
      ) : (
        <ul className="rows freezer-rows">
          {entries.map((e) => (
            <FreezerRow key={e.id} entry={e} flash={flash === e.id} onChange={replace} onGone={load} />
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

function FreezerRow({
  entry,
  flash,
  onChange,
  onGone,
}: {
  entry: FreezerEntry
  flash: boolean
  onChange: (e: FreezerEntry) => void
  onGone: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [newSize, setNewSize] = useState('')
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()
  const toast = useToast()

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
    setBusy(false)
  }

  const plus = (weight_g: number) => run(async () => onChange(await freezerApi.addPack(entry.id, weight_g)))

  const minus = async (pack: Pack) => {
    const last = entry.packs.length === 1 && pack.count === 1
    if (last && !(await confirm({
      title: `Use the last pack of ${entry.name}?`,
      message: `${entry.name} will come off the freezer list. Its name stays remembered.`,
      confirmLabel: 'Use last pack',
    }))) return
    run(async () => {
      const { entry: updated } = await freezerApi.removePack(entry.id, pack.weight_g)
      if (updated) onChange(updated)
      else {
        toast(`${entry.name} is no longer in the freezer`)
        onGone()
      }
    })
  }

  const addSize = () => {
    const g = parseGrams(newSize)
    if (!g) return toast('Type the pack weight, e.g. 400 g or 1 kg', 'error')
    run(async () => {
      onChange(await freezerApi.addPack(entry.id, g))
      setAdding(false)
      setNewSize('')
    })
  }

  const removeAll = async () => {
    const ok = await confirm({
      title: `Take ${entry.name} off the freezer list?`,
      message: `All ${entry.total_label} (${entry.breakdown}) will be removed. Its name stays remembered.`,
      confirmLabel: 'Remove',
      danger: true,
    })
    if (ok) run(async () => {
      await freezerApi.remove(entry.id)
      onGone()
    })
  }

  return (
    <li className={`row freezer-row${flash ? ' flash' : ''}`}>
      <div className="freezer-head">
        <span className="row-name">
          <strong>{entry.name}</strong> <span className="freezer-total">{entry.total_label}</span>
        </span>
        <button className="icon-button" aria-label={`Remove ${entry.name}`} title="Remove from freezer" onClick={removeAll} disabled={busy}>
          ×
        </button>
      </div>
      <div className="packs" aria-label={`${entry.name} packs`}>
        {entry.packs.map((p) => (
          <span key={p.weight_g} className="pack">
            <button className="pack-btn" aria-label={`Use one ${p.label} pack of ${entry.name}`} onClick={() => minus(p)} disabled={busy}>
              −
            </button>
            <span className="pack-label">
              {p.count} × {p.label}
            </span>
            <button className="pack-btn" aria-label={`Add a ${p.label} pack of ${entry.name}`} onClick={() => plus(p.weight_g)} disabled={busy}>
              +
            </button>
          </span>
        ))}
        {adding ? (
          <form
            className="pack-new"
            onSubmit={(e) => {
              e.preventDefault()
              addSize()
            }}
          >
            <input
              autoFocus
              aria-label={`New pack weight for ${entry.name}`}
              inputMode="decimal"
              placeholder="e.g. 500 g"
              value={newSize}
              onChange={(e) => setNewSize(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
            />
            <button type="submit" className="btn-primary" disabled={busy}>
              Add
            </button>
            <button type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button className="link-button" onClick={() => setAdding(true)}>
            + Other size
          </button>
        )}
      </div>
    </li>
  )
}
