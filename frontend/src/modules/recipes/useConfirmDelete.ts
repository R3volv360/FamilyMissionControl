/** The "Are you sure?" before deleting a recipe, shared by the recipe page and the Sync page. */
import { useCallback } from 'react'
import { useConfirm } from '../../shared/ConfirmDialog'
import { recipesApi, type DeleteWhere } from './recipesApi'

export const WHERE_LABEL: Record<DeleteWhere, string> = { app: 'the app', s3: 'S3', both: 'the app and S3' }

/** Resolves true when the user confirms deleting the recipe from `where`. */
export function useConfirmDelete() {
  const confirm = useConfirm()
  return useCallback(
    async (slug: string, title: string, where: DeleteWhere): Promise<boolean> => {
      // Deleting from the app affects planned meals: they keep the title but lose the recipe.
      let planned = ''
      if (where !== 's3') {
        const usage = await recipesApi.usage(slug).catch(() => ({}) as Record<string, number>)
        const upcoming = usage['upcoming meals'] ?? 0
        if (upcoming)
          planned = ` It's planned for ${upcoming} upcoming meal${upcoming === 1 ? '' : 's'}: they'll stay on the plan as “recipe removed” and drop off the shopping list.`
      }
      return confirm({
        title: `Delete “${title}” from ${WHERE_LABEL[where]}?`,
        message: `Are you sure? This can’t be undone.${planned}`,
        confirmLabel: 'Delete',
        danger: true,
      })
    },
    [confirm],
  )
}
