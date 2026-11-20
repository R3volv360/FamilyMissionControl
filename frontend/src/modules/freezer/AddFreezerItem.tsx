/**
 * F1: add an item with its total weight and how it splits into packs,
 * e.g. Mince, 1 kg as 2 × 400 g + 1 × 200 g. The total is optional; if given, the packs must add up to it.
 */
import { useState } from 'react'
import { ItemAutocomplete } from '../../shared/items/ItemAutocomplete'
import { useToast } from '../../shared/Toast'
import { freezerApi, type FreezerEntry } from './freezerApi'
import { formatGrams, parseGrams } from './grams'

interface Row {
  key: number
  count: string
  weight: string
}

let nextKey = 1
const blankRow = (): Row => ({ key: nextKey++, count: '1', weight: '' })

export function AddFreezerItem({ onAdded }: { onAdded: (entry: FreezerEntry) => void }) {
  const [name, setName] = useState('')
  const [total, setTotal] = useState('')
  const [rows, setRows] = useState<Row[]>([blankRow()])
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  // A row with no weight typed is ignored; any other row must be a valid weight and count.
  const parsed = rows.map((r) => ({
    blank: r.weight.trim() === '',
    count: Number.parseInt(r.count, 10),
    weight_g: parseGrams(r.weight),
  }))
  const rowsValid = parsed.every((p) => p.blank || (p.weight_g !== null && p.count >= 1 && p.count <= 999))
  const packs = parsed
    .filter((p) => !p.blank && p.weight_g !== null && p.count >= 1)
    .map((p) => ({ count: p.count, weight_g: p.weight_g as number }))
  const packTotal = packs.reduce((sum, p) => sum + p.count * p.weight_g, 0)
  const totalG = total.trim() ? parseGrams(total) : null
  const totalInvalid = total.trim() !== '' && totalG === null
  const mismatch = totalG !== null && packs.length > 0 && totalG !== packTotal
  const canSubmit = name.trim() !== '' && packs.length > 0 && rowsValid && !totalInvalid && !mismatch

  const update = (key: number, change: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)))

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const { entry, created } = await freezerApi.add(name.trim(), packs, totalG)
      toast(created ? `Added ${entry.name}, ${entry.total_label}` : `Added packs to ${entry.name}: now ${entry.total_label}`, 'success')
      setName('')
      setTotal('')
      setRows([blankRow()])
      onAdded(entry)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
    setBusy(false)
  }

  return (
    <form
      className="card freezer-add"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <h2>Add to the freezer</h2>
      <div className="freezer-add-top">
        <ItemAutocomplete value={name} onChange={setName} label="Item name" placeholder="Item, e.g. Mince" />
        <label className="inline-field">
          Total
          <input
            aria-label="Total weight"
            inputMode="decimal"
            placeholder="e.g. 1 kg"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            aria-invalid={totalInvalid || mismatch}
          />
        </label>
      </div>

      <fieldset className="pack-rows">
        <legend>Packs</legend>
        {rows.map((r, i) => (
          <div key={r.key} className="pack-row">
            <input
              aria-label={`Number of packs, row ${i + 1}`}
              type="number"
              min={1}
              max={999}
              value={r.count}
              onChange={(e) => update(r.key, { count: e.target.value })}
            />
            <span aria-hidden="true">×</span>
            <input
              aria-label={`Pack weight, row ${i + 1}`}
              inputMode="decimal"
              placeholder="e.g. 400 g"
              value={r.weight}
              onChange={(e) => update(r.key, { weight: e.target.value })}
              aria-invalid={r.weight.trim() !== '' && parseGrams(r.weight) === null}
            />
            {rows.length > 1 && (
              <button type="button" className="icon-button" aria-label={`Remove pack row ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                ×
              </button>
            )}
          </div>
        ))}
        <button type="button" className="link-button add-row" onClick={() => setRows((rs) => [...rs, blankRow()])}>
          + Another pack size
        </button>
      </fieldset>

      <p className={`pack-check${mismatch || totalInvalid || !rowsValid ? ' error' : ''}`} aria-live="polite">
        {totalInvalid
          ? 'Type the total as grams or kg, e.g. 1 kg or 750 g.'
          : !rowsValid
            ? 'Check the packs: a number of packs (1–999) and a weight like 400 g.'
            : packs.length === 0
            ? 'Add at least one pack size.'
            : mismatch
              ? `The packs add up to ${formatGrams(packTotal)}, not ${formatGrams(totalG!)}.`
              : `${packs.map((p) => `${p.count} × ${formatGrams(p.weight_g)}`).join(' + ')} = ${formatGrams(packTotal)}${totalG !== null ? ' ✓' : ''}`}
      </p>

      <button type="submit" className="btn-primary" disabled={!canSubmit || busy}>
        {busy ? 'Adding…' : 'Add to freezer'}
      </button>
    </form>
  )
}
