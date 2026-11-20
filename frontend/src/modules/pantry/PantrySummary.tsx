/** Home-page card: what's running low in the pantry. */
import { useLoad } from '../../shared/useLoad'
import { pantryApi } from './pantryApi'

export function PantrySummary() {
  const { data, error } = useLoad(pantryApi.list)
  if (error) return <p className="muted">Couldn't load the pantry.</p>
  if (!data) return <p className="muted">Loading…</p>
  if (data.length === 0) return <p className="muted">The pantry is empty.</p>

  const low = data.filter((e) => e.level !== 'full')
  return (
    <>
      <p>
        {data.length} item{data.length === 1 ? '' : 's'} · <strong>{low.length} to buy</strong>
      </p>
      {low.length > 0 && (
        <p className="muted small">
          {low.slice(0, 8).map((e) => `${e.name}${e.level === 'empty' ? ' (empty)' : ''}`).join(', ')}
          {low.length > 8 && ` and ${low.length - 8} more`}
        </p>
      )}
    </>
  )
}
