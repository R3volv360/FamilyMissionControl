/**
 * Rename or delete remembered items (P5/F5), e.g. to fix a typo. Both ask "Are you sure?" first.
 * Renaming onto a name that already exists offers to merge the two.
 */
import { useCallback, useEffect, useState } from 'react'
import { useConfirm } from '../ConfirmDialog'
import { useToast } from '../Toast'
import { describeUsage, itemsApi, renameConflict, type Item } from './itemsApi'

export function KnownItemsManager({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null)
  const confirm = useConfirm()
  const toast = useToast()

  const load = useCallback(() => {
    itemsApi.list().then(setItems).catch(() => toast('Could not load items', 'error'))
  }, [toast])

  useEffect(load, [load])

  const changed = () => {
    load()
    onChanged?.()
  }

  const rename = async (item: Item, newName: string) => {
    const name = newName.trim()
    if (!name || name === item.name) return setEditing(null)
    if (!(await confirm({ title: `Rename “${item.name}” to “${name}”?`, confirmLabel: 'Rename' }))) return
    try {
      await itemsApi.rename(item.id, name)
      toast(`Renamed to ${name}`, 'success')
    } catch (e) {
      const existing = renameConflict(e)
      if (!existing) return toast((e as Error).message, 'error')
      const ok = await confirm({
        title: `“${existing.name}” already exists`,
        message: `Merge “${item.name}” into “${existing.name}”? Everywhere “${item.name}” is used will use “${existing.name}” instead.`,
        confirmLabel: 'Merge',
      })
      if (!ok) return
      try {
        await itemsApi.rename(item.id, name, true)
        toast(`Merged into ${existing.name}`, 'success')
      } catch (e2) {
        return toast((e2 as Error).message, 'error')
      }
    }
    setEditing(null)
    changed()
  }

  const remove = async (item: Item) => {
    const { usage } = await itemsApi.get(item.id)
    const inUse = Object.keys(usage).length > 0
    const ok = await confirm({
      title: `Delete “${item.name}”?`,
      message: inUse
        ? `It's ${describeUsage(usage)}. Deleting it removes it from the pantry and freezer, and recipes will no longer link to it.`
        : 'It will no longer be suggested.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await itemsApi.delete(item.id, inUse)
      toast(`Deleted ${item.name}`, 'success')
      changed()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const shown = (items ?? []).filter((i) => i.name.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <section className="card">
      <h2>Known items</h2>
      <input
        aria-label="Filter known items"
        placeholder="Filter…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {items === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">{items.length ? 'No matches.' : 'No items yet.'}</p>
      ) : (
        <ul className="rows">
          {shown.map((item) => (
            <li key={item.id} className="row">
              {editing?.id === item.id ? (
                <form
                  className="row-edit"
                  onSubmit={(e) => {
                    e.preventDefault()
                    rename(item, editing.name)
                  }}
                >
                  <input
                    aria-label={`New name for ${item.name}`}
                    autoFocus
                    value={editing.name}
                    onChange={(e) => setEditing({ id: item.id, name: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                  />
                  <button type="submit" className="btn-primary">Save</button>
                  <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <span className="row-name">{item.name}</span>
                  <button onClick={() => setEditing({ id: item.id, name: item.name })}>Rename</button>
                  <button onClick={() => remove(item)}>Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
