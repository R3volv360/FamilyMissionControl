import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'
import { OldRecipeToolLinks } from './modules/recipe-tool/RecipeToolRoutes'

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

describe('App shell', () => {
  it('shows a nav entry for every module', () => {
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: 'Modules' })
    for (const label of ['Meal Planner', 'Recipes', 'Pantry', 'Freezer']) {
      expect(nav).toHaveTextContent(label)
    }
    expect(nav).not.toHaveTextContent('Recipe Tool') // part of Recipes now
  })

  it.each([
    ['/recipe-tool', '/recipes'],
    ['/recipe-tool/new', '/recipes/new'],
    ['/recipe-tool/edit/pesto', '/recipes/pesto/edit'],
  ])('sends the old Recipe Tool link %s to %s', (from, to) => {
    const Where = () => <p>at {useLocation().pathname}</p>
    render(
      <MemoryRouter initialEntries={[from]}>
        <Routes>
          <Route path="/recipe-tool/*" element={<OldRecipeToolLinks />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText(`at ${to}`)).toBeInTheDocument()
  })

  it('routes to a module page', () => {
    renderAt('/pantry')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pantry')
  })

  it('shows not found for unknown paths', () => {
    renderAt('/nope')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found')
  })
})
