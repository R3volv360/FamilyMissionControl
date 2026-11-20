import { useToast } from '../../shared/Toast'
import { errorMessage, recipesApi, type RecipeSummary } from './recipesApi'

const LABELS: Record<string, string> = {
  pending: 'Waiting to upload to S3',
  uploading: 'Uploading to S3…',
  done: 'Saved to S3',
  failed: 'S3 upload failed',
}

/** Shows the background S3 upload state (R2), with a retry button when it failed. */
export function S3Status({ recipe, onRetry, compact }: { recipe: RecipeSummary; onRetry?: () => void; compact?: boolean }) {
  const toast = useToast()
  const state = recipe.s3_state
  if (!state || (compact && state === 'done')) return null

  const retry = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await recipesApi.retryS3(recipe.slug)
      onRetry?.()
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  return (
    <span className={`badge badge-${state}`} title={recipe.s3_error ?? undefined}>
      {LABELS[state]}
      {state === 'failed' && (
        <button className="link-button" onClick={retry}>
          Retry
        </button>
      )}
    </span>
  )
}

