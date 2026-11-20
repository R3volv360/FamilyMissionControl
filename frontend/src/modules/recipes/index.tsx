import type { AppModule } from '../types'
import { RecipesSummary } from './RecipesSummary'
import { RecipesRoutes } from './RecipesRoutes'

export const recipesModule: AppModule = { path: '/recipes', label: 'Recipes', element: <RecipesRoutes />, summary: <RecipesSummary /> }
