import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../shared/Toast'
import { errorMessage, fileUrl, isUploading, recipesApi, type RecipeSummary } from './recipesApi'
import { S3Status } from './S3Status'
import { usePolling } from './usePolling'

export function RecipeList() {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null)
  const toast = useToast()

  const load = useCallback(() => {
    recipesApi
      .list()
      .then(setRecipes)
      .catch((e) => toast(errorMessage(e), 'error'))
  }, [toast])

  useEffect(load, [load])
  usePolling(load, !!recipes?.some(isUploading))

  return (
    <section>
      <div className="page-head">
        <h1>Recipes</h1>
        <div className="actions">
          <Link to="new" className="button btn-primary">
            New recipe
          </Link>
          <Link to="upload" className="button">
            Upload recipe
          </Link>
          <Link to="sync" className="button">
            Sync with S3
          </Link>
        </div>
      </div>
      {recipes === null ? (
        <p className="muted">Loading…</p>
      ) : recipes.length === 0 ? (
        <div className="placeholder">
          No recipes yet. <Link to="new">Write one</Link>, <Link to="upload">upload a recipe folder</Link>, or{' '}
          <Link to="sync">sync down</Link> the recipes already in S3.
        </div>
      ) : (
        <div className="recipe-grid">
          {recipes.map((r) => (
            <Link key={r.slug} to={r.slug} className="recipe-card">
              <img src={fileUrl(r, 'hero.jpg')} alt="" loading="lazy" />
              <div className="recipe-card-body">
                <strong>{r.title}</strong>
                {r.subtitle && <span className="muted">{r.subtitle}</span>}
                <S3Status recipe={r} onRetry={load} compact />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
