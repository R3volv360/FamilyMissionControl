import { api, ApiError } from '../../shared/api'

export type S3State = 'pending' | 'uploading' | 'done' | 'failed' | null

export interface RecipeSummary {
  slug: string
  title: string
  subtitle: string
  serves: number | null
  s3_state: S3State
  s3_error: string | null
  updated_at: string
}

export interface Ingredient {
  section: 'ingredients' | 'pantry'
  qty: string
  name: string
  allergens: string
  item_id: number | null
}

/** recipe.json as written by the recipe-card skill (only the parts the app shows). */
export interface RecipeJson {
  title: string
  subtitle?: string
  serves?: number
  chips?: [string, string][]
  allergens?: string
  estimate_note?: string
  utensils?: string[]
  steps: [string, string[]][]
  nutrition?: string
}

export interface RecipeDetail extends RecipeSummary {
  data: RecipeJson
  ingredients: Ingredient[]
  files: string[]
}

export interface StoreResult {
  recipe: RecipeSummary
  replaced: boolean
  warnings: string[]
  ignored: string[]
}

export type SyncState = 'both' | 'app' | 's3'
export interface SyncRow {
  slug: string
  title: string
  state: SyncState
}

export type DeleteWhere = 'app' | 's3' | 'both'

/** AWS Access Spec A6/A7: can the app reach S3, and is the server's certificate close to expiring? */
export interface AwsStatus {
  ok: boolean
  message: string
  profile: string | null
  identity: string | null
  cert: { subject: string; expires: string; days_left: number } | null
  cert_warning: string | null
}

const q = (overwrite: boolean) => (overwrite ? '?overwrite=true' : '')

export const recipesApi = {
  list: () => api.get<RecipeSummary[]>('/recipes'),
  get: (slug: string) => api.get<RecipeDetail>(`/recipes/${slug}`),
  upload: (folder: string, files: File[], overwrite: boolean, sameTitleOk = false) => {
    const fd = new FormData()
    fd.append('folder', folder)
    fd.append('overwrite', String(overwrite))
    fd.append('same_title_ok', String(sameTitleOk))
    for (const f of files) fd.append('files', f, f.name)
    return api.post<StoreResult>('/recipes/upload', fd)
  },
  retryS3: (slug: string) => api.post<void>(`/recipes/${slug}/s3-upload`),
  syncStatus: () => api.get<SyncRow[]>('/recipes/sync'),
  awsStatus: () => api.get<AwsStatus>('/recipes/aws-status'),
  usage: (slug: string) => api.get<Record<string, number>>(`/recipes/${slug}/usage`),
  syncUp: (slug: string, overwrite = false) => api.post<void>(`/recipes/sync/${slug}/up${q(overwrite)}`),
  syncDown: (slug: string, overwrite = false) => api.post<StoreResult>(`/recipes/sync/${slug}/down${q(overwrite)}`),
  delete: (slug: string, where: DeleteWhere) => api.delete<void>(`/recipes/${slug}?where=${where}`),
}

/** A background S3 upload is waiting or running (poll until it settles). */
export const isUploading = (r: RecipeSummary) => r.s3_state === 'pending' || r.s3_state === 'uploading'

export const fileUrl = (r: Pick<RecipeSummary, 'slug' | 'updated_at'>, name: string) =>
  `/api/recipes/${r.slug}/files/${name}?v=${encodeURIComponent(r.updated_at)}`

/** True when the API refused because the recipe already exists at the target (409 with exists_in). */
export function alreadyExists(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 && typeof e.detail === 'object' && !!e.detail && 'exists_in' in e.detail
}

/** The upload's title is already used by a recipe in another folder: that recipe's folder name, else null. */
export function sameTitleAs(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.status !== 409 || typeof e.detail !== 'object' || !e.detail) return null
  const slug = (e.detail as { same_title?: unknown }).same_title
  return typeof slug === 'string' ? slug : null
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && typeof e.detail === 'object' && e.detail && 'message' in e.detail) {
    return String((e.detail as { message: unknown }).message)
  }
  return e instanceof Error ? e.message : String(e)
}

/** Same rule as the backend (and ChopTilYouDrop's upload script). */
export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
