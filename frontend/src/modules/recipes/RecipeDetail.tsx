import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../shared/api'
import { useToast } from '../../shared/Toast'
import { errorMessage, fileUrl, isUploading, recipesApi, type DeleteWhere, type RecipeDetail as Detail } from './recipesApi'
import { RichText } from './RichText'
import { S3Status } from './S3Status'
import { useConfirmDelete, WHERE_LABEL } from './useConfirmDelete'
import { usePolling } from './usePolling'

/**
 * A recipe, with Edit (the Recipe Tool editor), Print (T10: a print layout made from the recipe's data) and
 * Delete (from the app, S3 or both; S3 is only offered once the recipe has been sent there).
 */
export function RecipeDetail() {
  const { slug = '' } = useParams()
  const [recipe, setRecipe] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const confirmDelete = useConfirmDelete()
  const toast = useToast()
  const navigate = useNavigate()

  const load = useCallback(() => {
    recipesApi
      .get(slug)
      .then(setRecipe)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'Recipe not found.' : errorMessage(e)))
  }, [slug])

  useEffect(load, [load])
  usePolling(load, !!recipe && isUploading(recipe))

  const remove = async (where: DeleteWhere) => {
    if (!recipe || !(await confirmDelete(recipe.slug, recipe.title, where))) return
    setDeleting(true)
    try {
      await recipesApi.delete(recipe.slug, where)
      toast(`${recipe.title} deleted from ${WHERE_LABEL[where]}`, 'success')
      if (where !== 's3') return navigate('/recipes')
      load()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
    setDeleting(false)
  }

  if (error)
    return (
      <section>
        <p>{error}</p>
        <Link to="/recipes">Back to recipes</Link>
      </section>
    )
  if (!recipe) return <p className="muted">Loading…</p>

  const d = recipe.data
  const ingredients = recipe.ingredients.filter((i) => i.section === 'ingredients')
  const pantry = recipe.ingredients.filter((i) => i.section === 'pantry')

  return (
    <article className="recipe">
      <div className="recipe-bar no-print">
        <Link to="/recipes" className="back">
          ← Recipes
        </Link>
        <div className="actions">
          <Link to={`/recipes/${recipe.slug}/edit`} className="button">
            Edit
          </Link>
          <button onClick={() => window.print()}>Print</button>
          <select
            aria-label={`Delete ${recipe.title}`}
            value=""
            disabled={deleting}
            onChange={(e) => e.target.value && remove(e.target.value as DeleteWhere)}
          >
            <option value="">Delete…</option>
            {(recipe.s3_state ? (['app', 's3', 'both'] as const) : (['app'] as const)).map((w) => (
              <option key={w} value={w}>
                From {WHERE_LABEL[w]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="recipe-hero">
        <img src={fileUrl(recipe, 'hero.jpg')} alt="" />
        <div>
          <h1>{recipe.title}</h1>
          {recipe.subtitle && <p className="muted">{recipe.subtitle}</p>}
          <div className="chips">
            {recipe.serves && <span className="chip">Serves {recipe.serves}</span>}
            {d.chips?.map(([a, b], i) => (
              <span key={i} className="chip">
                {a} {b}
              </span>
            ))}
          </div>
          <div className="no-print">
            <S3Status recipe={recipe} onRetry={load} />
          </div>
        </div>
      </div>

      <div className="recipe-columns">
        <section>
          <h2>Ingredients</h2>
          <ul className="ingredients">
            {ingredients.map((i, n) => (
              <li key={n}>
                <span className="qty">{i.qty}</span> {i.name}
                {i.allergens && <span className="muted"> · {i.allergens}</span>}
              </li>
            ))}
          </ul>
          {pantry.length > 0 && (
            <>
              <h3>From the cupboard</h3>
              <ul className="ingredients">
                {pantry.map((i, n) => (
                  <li key={n}>
                    <span className="qty">{i.qty}</span> {i.name}
                  </li>
                ))}
              </ul>
            </>
          )}
          {d.estimate_note && <p className="muted small">{d.estimate_note}</p>}
          {d.allergens && <p className="small">Allergens: {d.allergens}</p>}
          {d.utensils && d.utensils.length > 0 && (
            <>
              <h3>Utensils</h3>
              <p>{d.utensils.join(' · ')}</p>
            </>
          )}
        </section>

        <section>
          <h2>Method</h2>
          <ol className="steps">
            {d.steps.map(([title, lines], i) => (
              <li key={i} className="step">
                {recipe.files.includes(`s${i + 1}.jpg`) && <img src={fileUrl(recipe, `s${i + 1}.jpg`)} alt="" loading="lazy" />}
                <div>
                  <h3>
                    {i + 1}. <RichText text={title} />
                  </h3>
                  <ul>
                    {lines.map((line, j) => (
                      <li key={j}>
                        <RichText text={line} />
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
          {d.nutrition && <p className="muted small">{d.nutrition}</p>}
        </section>
      </div>
    </article>
  )
}
