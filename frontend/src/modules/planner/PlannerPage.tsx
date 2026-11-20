/** Meal Planner (M1–M11). The week shown is in the URL (?week=YYYY-MM-DD), so any week can be bookmarked. */
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor, pointerWithin, TouchSensor, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../../shared/api'
import { useConfirm } from '../../shared/ConfirmDialog'
import { useToast } from '../../shared/Toast'
import { recipesApi, type RecipeSummary } from '../recipes/recipesApi'
import { addDays, dayLabel, isValidIso, longDate, mondayOf, today } from './dates'
import { dropAction } from './dropAction'
import './planner.css'
import { plannerApi, type Meal, type ShoppingList, type Week } from './plannerApi'
import { RecipeCarousel, RecipeDragPreview, type DragRecipe } from './RecipeCarousel'
import { RecipePicker } from './RecipePicker'
import { ShoppingListPanel } from './ShoppingListPanel'
import { WeekCalendar } from './WeekCalendar'

const COPY_KEY = 'missionControl.planner.copiedWeek'

/** Drop on whatever is under the pointer (a meal vs the "Add new" strip below it). The keyboard has no
 * pointer, so it falls back to the nearest target. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : args.pointerCoordinates ? [] : closestCenter(args)
}

/** Screen-reader messages, in words rather than internal ids. */
const describe = (id: string | number | undefined, data?: { meal?: Meal; day?: string }) => {
  if (data?.meal) return `replace ${data.meal.title} on ${dayLabel(data.meal.day)}`
  if (data?.day) return `add to ${dayLabel(data.day)}`
  return String(id ?? '')
}
const announcements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${(active.data.current as DragRecipe)?.title}.`,
  onDragOver: ({ active, over }) =>
    over ? `${(active.data.current as DragRecipe)?.title}: ${describe(over.id, over.data.current)}.` : 'Not over a day.',
  onDragEnd: ({ active, over }) =>
    over ? `${(active.data.current as DragRecipe)?.title}: ${describe(over.id, over.data.current)}.` : 'Dropped. Nothing changed.',
  onDragCancel: () => 'Cancelled. Nothing changed.',
}

function readCopied(): string | null {
  try {
    const v = localStorage.getItem(COPY_KEY)
    return isValidIso(v) ? v : null
  } catch {
    return null
  }
}

export function PlannerPage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('week')
  const start = mondayOf(isValidIso(requested) ? requested : today())

  const [week, setWeek] = useState<Week | null>(null)
  const [list, setList] = useState<ShoppingList | null>(null)
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null)
  const [dragged, setDragged] = useState<DragRecipe | null>(null)
  const [copied, setCopied] = useState<string | null>(readCopied)
  const [picking, setPicking] = useState<string | null>(null) // day the recipe picker is open for
  const confirm = useConfirm()
  const toast = useToast()

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Press and hold briefly to drag on a phone, so the strip still scrolls with a normal swipe.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const load = useCallback(() => {
    plannerApi.week(start).then(setWeek).catch((e) => toast(e.message, 'error'))
    plannerApi.list(start).then(setList).catch((e) => toast(e.message, 'error'))
  }, [start, toast])

  useEffect(load, [load])
  useEffect(() => {
    recipesApi.list().then(setRecipes).catch((e) => toast(e.message, 'error'))
  }, [toast])

  const goTo = (day: string) => setParams(day === mondayOf(today()) ? {} : { week: mondayOf(day) })

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
    load()
  }

  const onDragStart = (e: DragStartEvent) => setDragged((e.active.data.current as DragRecipe) ?? null)

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragged(null)
    const recipe = active.data.current as DragRecipe | undefined
    const meal = (over?.data.current as { meal?: Meal } | undefined)?.meal
    const action = dropAction(recipe?.slug, over ? String(over.id) : null, meal)
    if (action?.kind === 'add') act(() => plannerApi.add(action.day, action.slug))
    else if (action?.kind === 'replace') act(() => plannerApi.replace(action.mealId, action.slug))
  }

  const remove = (meal: Meal) => act(() => plannerApi.remove(meal.id)) // M6

  const mealCount = week?.days.reduce((n, d) => n + d.meals.length, 0) ?? 0

  const copyWeek = () => {
    setCopied(start)
    try {
      localStorage.setItem(COPY_KEY, start)
    } catch {
      /* private window: copy still works until the page reloads */
    }
    toast(`Copied the week of ${longDate(start)}. Go to another week and paste it.`, 'success')
  }

  const pasteWeek = async () => {
    if (!copied) return
    let replace = false
    if (mealCount > 0) {
      replace = await confirm({
        title: `Replace this week's ${mealCount} meal${mealCount === 1 ? '' : 's'}?`,
        message: `The week of ${longDate(start)} will be replaced with the plan from the week of ${longDate(copied)}.`,
        confirmLabel: 'Replace',
        danger: true,
      })
      if (!replace) return
    }
    act(async () => {
      try {
        const { copied: n } = await plannerApi.copy(copied, start, replace)
        toast(`Pasted ${n} meal${n === 1 ? '' : 's'}`, 'success')
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) toast('This week has meals now; try again', 'error')
        else throw e
      }
    })
  }

  return (
    <section className="planner">
      <div className="page-head no-print">
        <h1>Meal Planner</h1>
        <div className="actions">
          <button onClick={copyWeek} disabled={mealCount === 0}>
            Copy week
          </button>
          {copied && copied !== start && (
            <button onClick={pasteWeek}>Paste week of {longDate(copied).replace(/ \d{4}$/, '')}</button>
          )}
        </div>
      </div>

      <div className="week-nav no-print">
        <button aria-label="Previous week" onClick={() => goTo(addDays(start, -7))}>
          ‹
        </button>
        <strong className="week-label">Week of {longDate(start)}</strong>
        <button aria-label="Next week" onClick={() => goTo(addDays(start, 7))}>
          ›
        </button>
        {start !== mondayOf(today()) && <button onClick={() => goTo(today())}>This week</button>}
        <input type="date" aria-label="Go to week" value={start} onChange={(e) => isValidIso(e.target.value) && goTo(e.target.value)} />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        accessibility={{ announcements }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragged(null)}
      >
        <div className="no-print">
          {week ? <WeekCalendar week={week} onRemove={remove} onAdd={setPicking} dragging={!!dragged} /> : <p className="muted">Loading…</p>}
          <RecipeCarousel recipes={recipes} />
        </div>
        <DragOverlay dropAnimation={null}>{dragged && <RecipeDragPreview recipe={dragged} />}</DragOverlay>
      </DndContext>

      <ShoppingListPanel list={list} />

      {picking && recipes && (
        <RecipePicker
          day={picking}
          recipes={recipes}
          onClose={() => setPicking(null)}
          onPick={(slug) => {
            const day = picking
            setPicking(null)
            act(() => plannerApi.add(day, slug))
          }}
        />
      )}
    </section>
  )
}
