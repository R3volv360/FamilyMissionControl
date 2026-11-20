/** Client for the central list of known items (/api/items). */
import { api, ApiError } from '../api'

export interface Item {
  id: number
  name: string
}

export interface ItemDetail extends Item {
  usage: Record<string, number> // e.g. { pantry: 1, recipes: 3 }
}

export const itemsApi = {
  list: () => api.get<Item[]>('/items'),
  search: (q: string, limit = 8) => api.get<Item[]>(`/items?q=${encodeURIComponent(q)}&limit=${limit}`),
  get: (id: number) => api.get<ItemDetail>(`/items/${id}`),
  create: (name: string) => api.post<{ item: Item; created: boolean }>('/items', { name }),
  rename: (id: number, name: string, merge = false) =>
    api.patch<{ item: Item; merged_from: number | null }>(`/items/${id}`, { name, merge }),
  delete: (id: number, force = false) => api.delete<void>(`/items/${id}${force ? '?force=true' : ''}`),
}

/** The existing item when a rename hits a name already taken (409 with `conflict`). */
export function renameConflict(e: unknown): Item | null {
  if (e instanceof ApiError && e.status === 409 && typeof e.detail === 'object' && e.detail && 'conflict' in e.detail) {
    return (e.detail as { conflict: Item }).conflict
  }
  return null
}

/** "in the pantry and used by 3 recipes" */
export function describeUsage(usage: Record<string, number>): string {
  const parts = Object.entries(usage).map(([label, n]) => {
    if (label === 'pantry' || label === 'freezer') return `in the ${label}`
    if (label === 'recipes') return `used by ${n} recipe${n === 1 ? '' : 's'}`
    return `used in ${label} (${n})`
  })
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}
