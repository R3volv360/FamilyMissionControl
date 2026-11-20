/**
 * The editor's working copy of a recipe, and the pure changes made to it. Kept free of React so the rules
 * (reordering, photos following their step, what gets saved) are unit-tested directly.
 */
import { formatAmount, parseAmount, type Amount } from './amount'
import type { EditorRecipe } from './toolApi'

/** A photo in the editor: none, the stored one (by its original step number, or the hero), or a new one. */
export type Photo = { kind: 'none' } | { kind: 'keep'; from: number | null } | { kind: 'new'; blob: Blob }

export interface IngredientRow extends Amount {
  id: string
  name: string
  cupboard: boolean
  allergens: string
}

export interface StepCard {
  id: string
  title: string
  text: string
  photo: Photo
}

export interface EditorState {
  slug: string | null
  title: string
  subtitle: string
  serves: string // as typed; validated on save
  hero: Photo
  ingredients: IngredientRow[]
  steps: StepCard[]
}

let counter = 0
export const newId = () => `r${Date.now().toString(36)}${(counter++).toString(36)}`

export const emptyIngredient = (cupboard = false): IngredientRow => ({
  id: newId(), amount: '', unit: '', name: '', cupboard, allergens: '',
})
export const emptyStep = (): StepCard => ({ id: newId(), title: '', text: '', photo: { kind: 'none' } })

export function blankRecipe(): EditorState {
  return { slug: null, title: '', subtitle: '', serves: '4', hero: { kind: 'none' }, ingredients: [emptyIngredient()], steps: [emptyStep()] }
}

export function fromServer(r: EditorRecipe): EditorState {
  return {
    slug: r.slug,
    title: r.title,
    subtitle: r.subtitle,
    serves: r.serves == null ? '' : String(r.serves),
    hero: r.hero === 'keep' ? { kind: 'keep', from: null } : { kind: 'none' },
    ingredients: r.ingredients.map((i) => ({ id: newId(), ...parseAmount(i.qty), name: i.name, cupboard: i.cupboard, allergens: i.allergens })),
    steps: r.steps.map((s) => ({
      id: newId(),
      title: s.title,
      text: s.text,
      photo: s.photo === 'keep' ? { kind: 'keep', from: s.photo_from } : { kind: 'none' },
    })),
  }
}

/** What to send on save: the recipe, plus the new photos named as the server expects. */
export function toServer(s: EditorState): { recipe: EditorRecipe; photos: Record<string, Blob> } {
  const photos: Record<string, Blob> = {}
  if (s.hero.kind === 'new') photos['hero.jpg'] = s.hero.blob
  s.steps.forEach((st, i) => {
    if (st.photo.kind === 'new') photos[`step-${i + 1}.jpg`] = st.photo.blob
  })
  const serves = parseInt(s.serves, 10)
  return {
    recipe: {
      slug: s.slug,
      title: s.title.trim(),
      subtitle: s.subtitle.trim(),
      serves: Number.isFinite(serves) && serves > 0 ? Math.min(serves, 99) : null,
      hero: s.hero.kind,
      ingredients: s.ingredients
        .filter((i) => i.name.trim())
        .map((i) => ({ qty: formatAmount(i), name: i.name.trim(), cupboard: i.cupboard, allergens: i.allergens })),
      steps: s.steps.map((st) => ({
        title: st.title.trim(),
        text: st.text,
        photo: st.photo.kind,
        photo_from: st.photo.kind === 'keep' ? st.photo.from : null,
      })),
    },
    photos,
  }
}

/** Reasons the recipe can't be saved yet, in words for the person editing. */
export function problems(s: EditorState): string[] {
  const found: string[] = []
  if (!s.title.trim()) found.push('Give the recipe a name.')
  else if (!/[a-z0-9]/i.test(s.title)) found.push('The name needs at least one letter or number.')
  return found
}

// ---- list changes --------------------------------------------------------------------------------------

/** Move an item one place up (-1) or down (+1). Ingredients only move among their own section. */
export function move<T extends { id: string }>(list: T[], id: string, by: -1 | 1, sameGroup: (a: T, b: T) => boolean = () => true): T[] {
  const from = list.findIndex((x) => x.id === id)
  if (from < 0) return list
  let to = from + by
  while (to >= 0 && to < list.length && !sameGroup(list[from], list[to])) to += by
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

export function update<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] {
  return list.map((x) => (x.id === id ? { ...x, ...patch } : x))
}

export function remove<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((x) => x.id !== id)
}

/** Insert after `afterId` (or at the end of its section when the id isn't found). */
export function insertAfter(list: IngredientRow[], afterId: string | null, row: IngredientRow): IngredientRow[] {
  const at = afterId ? list.findIndex((x) => x.id === afterId) : -1
  if (at >= 0) return [...list.slice(0, at + 1), row, ...list.slice(at + 1)]
  const lastOfSection = list.map((x) => x.cupboard).lastIndexOf(row.cupboard)
  return lastOfSection < 0 ? [...list, row] : [...list.slice(0, lastOfSection + 1), row, ...list.slice(lastOfSection + 1)]
}

export const sameSection = (a: IngredientRow, b: IngredientRow) => a.cupboard === b.cupboard
