/** Home-page card: this week's meals and how much is on the "to buy" list. */
import { Link } from 'react-router-dom'
import { useLoad } from '../../shared/useLoad'
import { dayLabel, mondayOf, today } from './dates'
import { plannerApi } from './plannerApi'

export function PlannerSummary() {
  const start = mondayOf(today())
  const week = useLoad(() => plannerApi.week(start))
  const list = useLoad(() => plannerApi.list(start))
  if (week.error) return <p className="muted">Couldn't load this week.</p>
  if (!week.data) return <p className="muted">Loading…</p>

  const planned = week.data.days.filter((d) => d.meals.length > 0)
  const now = today()
  return (
    <>
      {planned.length === 0 ? (
        <p className="muted">
          Nothing planned this week. <Link to="/planner">Plan some meals</Link>
        </p>
      ) : (
        <ul className="summary-list">
          {planned.map((d) => (
            <li key={d.day} className={d.day === now ? 'summary-today' : undefined}>
              <span className="muted">{dayLabel(d.day).split(' ')[0]}</span> {d.meals.map((m) => m.title).join(', ')}
            </li>
          ))}
        </ul>
      )}
      {list.data && list.data.meals.length > 0 && (
        <p className="summary-foot">
          <Link to="/planner">
            {list.data.buy.length} item{list.data.buy.length === 1 ? '' : 's'} to buy
          </Link>
        </p>
      )}
    </>
  )
}
