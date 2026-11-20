import { Route, Routes } from 'react-router-dom'
import { EditRecipeRoute, NewRecipeRoute } from '../recipe-tool/RecipeToolRoutes'
import { RecipeDetail } from './RecipeDetail'
import { RecipeList } from './RecipeList'
import './recipes.css'
import { SyncPage } from './SyncPage'
import { UploadPage } from './UploadPage'

export function RecipesRoutes() {
  return (
    <Routes>
      <Route index element={<RecipeList />} />
      <Route path="new" element={<NewRecipeRoute />} />
      <Route path="upload" element={<UploadPage />} />
      <Route path="sync" element={<SyncPage />} />
      <Route path=":slug" element={<RecipeDetail />} />
      <Route path=":slug/edit" element={<EditRecipeRoute />} />
    </Routes>
  )
}
