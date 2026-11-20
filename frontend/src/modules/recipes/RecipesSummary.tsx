/** Home-page card: how many recipes, and any S3 uploads that need attention. */
import { Link } from 'react-router-dom'
import { useLoad } from '../../shared/useLoad'
import { recipesApi } from './recipesApi'

export function RecipesSummary() {
  const { data, error } = useLoad(recipesApi.list)
  if (error) return <p className="muted">Couldn't load recipes.</p>
  if (!data) return <p className="muted">Loading…</p>
  if (data.length === 0)
    return (
      <p className="muted">
        No recipes yet. <Link to="/recipes/new">Write one</Link> or <Link to="/recipes/upload">upload one</Link>
      </p>
    )

  const failed = data.filter((r) => r.s3_state === 'failed')
  return (
    <>
      <p>
        {data.length} recipe{data.length === 1 ? '' : 's'}
      </p>
      <p className="small">
        <Link to="/recipes/new">Write a new recipe</Link>
      </p>
      {failed.length > 0 && (
        <p className="error small">
          {failed.length} not yet copied to S3: open {failed.length === 1 ? 'it' : 'them'} to retry
        </p>
      )}
    </>
  )
}
