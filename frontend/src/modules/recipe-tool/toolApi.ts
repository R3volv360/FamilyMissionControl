import { api } from '../../shared/api'
import type { StoreResult } from '../recipes/recipesApi'

export type PhotoAction = 'keep' | 'new' | 'none'

/** What the server sends and takes (see backend recipe_tool/schemas.py). */
export interface EditorIngredient {
  qty: string
  name: string
  cupboard: boolean
  allergens: string
}

export interface EditorStep {
  title: string
  text: string
  photo: PhotoAction
  photo_from: number | null
}

export interface EditorRecipe {
  slug: string | null
  title: string
  subtitle: string
  serves: number | null
  hero: PhotoAction
  ingredients: EditorIngredient[]
  steps: EditorStep[]
  updated_at?: string | null // from the server only
}

export const toolApi = {
  load: (slug: string) => api.get<EditorRecipe>(`/recipe_tool/recipes/${slug}`),
  /** photos: "hero.jpg" and "step-<n>.jpg" (n = the step's 1-based position in `recipe.steps`). */
  save: (recipe: EditorRecipe, photos: Record<string, Blob>, overwrite = false) => {
    const fd = new FormData()
    fd.append('recipe', JSON.stringify(recipe))
    fd.append('overwrite', String(overwrite))
    for (const [name, blob] of Object.entries(photos)) fd.append('photos', blob, name)
    return api.post<StoreResult>('/recipe_tool/save', fd)
  },
}
