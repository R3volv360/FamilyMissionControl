import { api } from '../../shared/api'

export interface Meal {
  id: number
  day: string
  position: number
  title: string
  recipe: { slug: string; title: string; updated_at: string } | null // null: recipe deleted from the app
}

export interface Week {
  start: string
  days: { day: string; meals: Meal[] }[]
}

export interface ListLine {
  name: string
  item_id: number | null
  total: string // the week's total, e.g. "700 g", "300 g + 2", "≈ 142 g"; "" when no amounts are given
  pantry_level: 'full' | 'one' | 'empty' | null
  freezer_g: number | null
  freezer_label: string | null
  unit_mismatch: boolean
  short_label: string | null
}

export interface PlannedRecipe {
  day: string
  weekday: string // "Mon"
  title: string
}

export interface ShoppingList {
  start: string
  meals: PlannedRecipe[] // what we're shopping for
  buy: ListLine[]
  pantry: ListLine[]
  freezer: ListLine[]
  pantry_one: ListLine[] // other pantry items down to their last one (no meal needs them)
  pantry_empty: ListLine[] // other pantry items that have run out
  unit_mismatches: string[]
}

export const plannerApi = {
  week: (day: string) => api.get<Week>(`/planner/week?day=${day}`),
  add: (day: string, recipe_slug: string) => api.post<Meal>('/planner/meals', { day, recipe_slug }),
  replace: (id: number, recipe_slug: string) => api.put<Meal>(`/planner/meals/${id}`, { recipe_slug }),
  remove: (id: number) => api.delete<void>(`/planner/meals/${id}`),
  copy: (from_day: string, to_day: string, replace: boolean) =>
    api.post<{ copied: number }>('/planner/copy', { from_day, to_day, replace }),
  list: (day: string) => api.get<ShoppingList>(`/planner/list?day=${day}`),
}
