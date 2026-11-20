import { api } from '../../shared/api'

export type Level = 'full' | 'one' | 'empty'

export interface PantryEntry {
  id: number
  item_id: number
  name: string
  level: Level
  updated_at: string
}

/** Stock levels from the spec. Only "Fully stocked" counts as already in the pantry; the rest go on "to buy". */
export const LEVELS: { value: Level; label: string; hint: string }[] = [
  { value: 'full', label: 'Fully stocked', hint: 'One in use, one sealed in storage' },
  { value: 'one', label: 'Only one', hint: 'One in use, none in storage' },
  { value: 'empty', label: 'Empty', hint: 'None in the house' },
]

export const pantryApi = {
  list: () => api.get<PantryEntry[]>('/pantry'),
  add: (name: string) => api.post<{ entry: PantryEntry; created: boolean }>('/pantry', { name }),
  setLevel: (id: number, level: Level) => api.patch<PantryEntry>(`/pantry/${id}`, { level }),
  remove: (id: number) => api.delete<void>(`/pantry/${id}`),
}
