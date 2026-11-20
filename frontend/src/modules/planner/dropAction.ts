import type { Meal } from './plannerApi'

export type DropAction = { kind: 'add'; day: string; slug: string } | { kind: 'replace'; mealId: number; slug: string } | null

/**
 * What dropping a recipe on a target means:
 *  - "add:<day>" (an empty day, or "Add new" under a day's meals) -> add it to that day (M3, M5)
 *  - "meal:<id>" (a planned meal) -> replace that meal (M4); dropping the same recipe back on itself does nothing
 */
export function dropAction(slug: string | undefined, targetId: string | null, targetMeal?: Meal): DropAction {
  if (!slug || !targetId) return null
  if (targetId.startsWith('add:')) return { kind: 'add', day: targetId.slice(4), slug }
  if (targetId.startsWith('meal:') && targetMeal) {
    return targetMeal.recipe?.slug === slug ? null : { kind: 'replace', mealId: targetMeal.id, slug }
  }
  return null
}
