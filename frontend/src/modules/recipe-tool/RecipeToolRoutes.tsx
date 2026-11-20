/** The Recipe Tool's pages live under Recipes: /recipes/new and /recipes/<slug>/edit. */
import { Navigate, useParams } from 'react-router-dom'
import { RecipeEditor } from './RecipeEditor'
import './recipe-tool.css'

export function NewRecipeRoute() {
  return <RecipeEditor key="new" slug={null} />
}

export function EditRecipeRoute() {
  const { slug = '' } = useParams()
  return <RecipeEditor key={slug} slug={slug} />
}

/** Old Recipe Tool links (e.g. saved on a phone) go to the same page under Recipes. */
export function OldRecipeToolLinks() {
  const { '*': rest = '' } = useParams()
  const [page, slug] = rest.split('/')
  if (page === 'new') return <Navigate to="/recipes/new" replace />
  if (page === 'edit' && slug) return <Navigate to={`/recipes/${slug}/edit`} replace />
  return <Navigate to="/recipes" replace />
}
