import { Route, Routes } from 'react-router-dom'
import { OldRecipeToolLinks } from './modules/recipe-tool/RecipeToolRoutes'
import { MODULES } from './modules/registry'
import { ConfirmProvider } from './shared/ConfirmDialog'
import { Home, Layout, NotFound } from './shared/Layout'
import { ToastProvider } from './shared/Toast'

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            {MODULES.map((m) => (
              <Route key={m.path} path={`${m.path}/*`} element={m.element} />
            ))}
            <Route path="recipe-tool/*" element={<OldRecipeToolLinks />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ConfirmProvider>
    </ToastProvider>
  )
}
