import { api } from '../../shared/api'

export interface Pack {
  weight_g: number
  count: number
  label: string
}

export interface FreezerEntry {
  id: number
  item_id: number
  name: string
  total_g: number
  total_label: string
  breakdown: string
  packs: Pack[]
  updated_at: string
}

export interface PackIn {
  weight_g: number
  count: number
}

export const freezerApi = {
  list: () => api.get<FreezerEntry[]>('/freezer'),
  add: (name: string, packs: PackIn[], total_g: number | null) =>
    api.post<{ entry: FreezerEntry; created: boolean }>('/freezer', { name, packs, total_g }),
  addPack: (id: number, weight_g: number, count = 1) => api.post<FreezerEntry>(`/freezer/${id}/packs`, { weight_g, count }),
  removePack: (id: number, weight_g: number) =>
    api.delete<{ entry: FreezerEntry | null }>(`/freezer/${id}/packs/${weight_g}`),
  remove: (id: number) => api.delete<void>(`/freezer/${id}`),
}
