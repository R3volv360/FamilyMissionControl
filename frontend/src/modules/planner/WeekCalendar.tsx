/**
 * M1: the week, Monday to Sunday, a block per day. Drop targets:
 *  - an empty day, or the "Add new" area under a day's meals -> add (M3, M5)
 *  - a planned meal -> replace it (M4)
 * Hovering a meal shows a red X to remove it (M6); on touch screens the X is always shown.
 */
import { useDroppable } from '@dnd-kit/core'
import { Link } from 'react-router-dom'
import { fileUrl } from '../recipes/recipesApi'
import { dayLabel, today } from './dates'
import type { Meal, Week } from './plannerApi'

interface Props {
  week: Week
  onRemove: (meal: Meal) => void
  onAdd: (day: string) => void // tap/click instead of dragging: opens the recipe picker
  dragging: boolean
}

export function WeekCalendar({ week, onRemove, onAdd, dragging }: Props) {
  const now = today()
  return (
    <div className={`week${dragging ? ' is-dragging' : ''}`}>
      {week.days.map(({ day, meals }) => (
        <section key={day} className={`day${day === now ? ' today' : ''}`} aria-label={dayLabel(day)}>
          <h3 className="day-head">{dayLabel(day)}</h3>
          <div className="day-meals">
            {meals.map((m) => (
              <MealCard key={m.id} meal={m} onRemove={onRemove} />
            ))}
          </div>
          <AddZone day={day} empty={meals.length === 0} onAdd={onAdd} />
        </section>
      ))}
    </div>
  )
}

function MealCard({ meal, onRemove }: { meal: Meal; onRemove: (m: Meal) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `meal:${meal.id}`, data: { meal } })
  return (
    <div ref={setNodeRef} className={`meal${isOver ? ' over' : ''}${meal.recipe ? '' : ' removed'}`}>
      {meal.recipe ? (
        <Link to={`/recipes/${meal.recipe.slug}`} className="meal-link">
          <img src={fileUrl(meal.recipe, 'hero.jpg')} alt="" draggable={false} />
          <span className="meal-title">{meal.title}</span>
        </Link>
      ) : (
        <span className="meal-title" title="This recipe has been deleted from the app">
          {meal.title} <em>(recipe removed)</em>
        </span>
      )}
      {isOver && <span className="drop-hint">Replace</span>}
      <button className="meal-remove" aria-label={`Remove ${meal.title} from ${dayLabel(meal.day)}`} onClick={() => onRemove(meal)}>
        ×
      </button>
    </div>
  )
}

function AddZone({ day, empty, onAdd }: { day: string; empty: boolean; onAdd: (day: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `add:${day}`, data: { day } })
  return (
    <button
      ref={setNodeRef}
      className={`add-zone${empty ? ' empty' : ''}${isOver ? ' over' : ''}`}
      aria-label={`Add a meal to ${dayLabel(day)}`}
      onClick={() => onAdd(day)}
    >
      {empty ? 'Drop a recipe here, or tap to choose' : '+ Add new'}
    </button>
  )
}
