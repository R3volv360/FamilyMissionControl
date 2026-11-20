/** Home-page card: what's in the freezer. */
import { useLoad } from '../../shared/useLoad'
import { freezerApi } from './freezerApi'

export function FreezerSummary() {
  const { data, error } = useLoad(freezerApi.list)
  if (error) return <p className="muted">Couldn't load the freezer.</p>
  if (!data) return <p className="muted">Loading…</p>
  if (data.length === 0) return <p className="muted">The freezer is empty.</p>

  return (
    <>
      <p>
        {data.length} item{data.length === 1 ? '' : 's'}
      </p>
      <p className="muted small">
        {data.slice(0, 8).map((e) => `${e.name} ${e.total_label}`).join(', ')}
        {data.length > 8 && ` and ${data.length - 8} more`}
      </p>
    </>
  )
}
