import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import { ConfirmProvider } from '../../shared/ConfirmDialog'
import { itemsApi } from '../../shared/items/itemsApi'
import { ToastProvider } from '../../shared/Toast'
import { drafts } from './draftStore'
import { RecipeEditor } from './RecipeEditor'
import { toolApi, type EditorRecipe } from './toolApi'

vi.mock('./toolApi', () => ({ toolApi: { load: vi.fn(), save: vi.fn() } }))
vi.mock('./draftStore', async (orig) => ({
  ...(await orig<typeof import('./draftStore')>()),
  drafts: { get: vi.fn(), put: vi.fn(), remove: vi.fn() },
}))
vi.mock('../../shared/items/itemsApi', () => ({ itemsApi: { search: vi.fn() } }))

const api = vi.mocked(toolApi)
const store = vi.mocked(drafts)

const saved = (slug: string, title: string) => ({
  recipe: { slug, title, subtitle: '', serves: 4, s3_state: 'pending' as const, s3_error: null, updated_at: '' },
  replaced: false, warnings: [], ignored: [],
})

const bowl: EditorRecipe = {
  slug: 'bowl', title: 'Prawn Bowl', subtitle: '', serves: 4, hero: 'keep',
  ingredients: [
    { qty: '320 g', name: 'Prawns', cupboard: false, allergens: 'Crustaceans' },
    { qty: '128 g*', name: 'Aioli', cupboard: false, allergens: '' },
    { qty: '2 tbsp', name: 'Oil', cupboard: true, allergens: '' },
  ],
  steps: [
    { title: 'Cook the rice', text: 'Rinse.\nBoil.', photo: 'keep', photo_from: 1 },
    { title: 'Serve', text: 'Eat.', photo: 'none', photo_from: null },
  ],
  updated_at: '2026-11-20T10:00:00',
}

function renderEditor(slug: string | null) {
  const router = createMemoryRouter(
    [
      { path: '/editor', element: <><RecipeEditor slug={slug} /><Link to="/elsewhere">Go elsewhere</Link></> },
      { path: '/recipes/:slug', element: <p>recipe page</p> },
      { path: '/elsewhere', element: <p>somewhere else</p> },
    ],
    { initialEntries: ['/editor'] },
  )
  render(
    <ToastProvider>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </ToastProvider>,
  )
  return router
}

const dialog = () => within(screen.getByRole('alertdialog'))
const sentRecipe = () => api.save.mock.calls.at(-1)![0]

beforeEach(() => {
  vi.resetAllMocks()
  store.get.mockResolvedValue(null)
  store.put.mockResolvedValue()
  store.remove.mockResolvedValue()
  vi.mocked(itemsApi.search).mockResolvedValue([])
  api.load.mockResolvedValue(structuredClone(bowl))
})

describe('new recipe (T1, T3, T4, T6, T8)', () => {
  it('types a recipe in one go and saves it', async () => {
    const user = userEvent.setup()
    api.save.mockResolvedValue(saved('soup', 'Soup'))
    renderEditor(null)

    await user.type(await screen.findByLabelText('Name'), 'Soup')
    await user.type(screen.getByLabelText('Amount for ingredient 1'), '500')
    await user.selectOptions(screen.getByLabelText('Unit for ingredient 1'), 'g')
    await user.type(screen.getByLabelText('Ingredient 1 name'), 'Carrots{Enter}')
    // Enter moved to a new row, cursor in its amount box
    expect(screen.getByLabelText('Amount for ingredient 2')).toHaveFocus()
    await user.keyboard('2{Enter}')
    await user.keyboard('Onions')
    await user.click(screen.getByRole('button', { name: '+ Add cupboard staple' }))
    expect(screen.getByLabelText('Amount for cupboard staple 1')).toHaveFocus()
    await user.keyboard('1')
    await user.type(screen.getByLabelText('Cupboard staple 1 name'), 'Salt')
    await user.type(screen.getByLabelText('Title'), 'Simmer')
    await user.type(screen.getByLabelText('Instructions'), 'Chop.{Enter}Simmer 20 mins.')
    await user.click(screen.getByRole('button', { name: 'More servings' }))
    await user.click(screen.getByRole('button', { name: 'Save recipe' }))

    await screen.findByText('recipe page')
    expect(sentRecipe()).toMatchObject({
      slug: null, title: 'Soup', serves: 5, hero: 'none',
      ingredients: [
        { qty: '500 g', name: 'Carrots', cupboard: false },
        { qty: '2', name: 'Onions', cupboard: false },
        { qty: '1', name: 'Salt', cupboard: true },
      ],
      steps: [{ title: 'Simmer', text: 'Chop.\nSimmer 20 mins.', photo: 'none', photo_from: null }],
    })
    expect(store.remove).toHaveBeenCalledWith('new')
  })

  it('needs a name', async () => {
    const user = userEvent.setup()
    renderEditor(null)
    await user.click(await screen.findByRole('button', { name: 'Save recipe' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Give the recipe a name.')
    expect(api.save).not.toHaveBeenCalled()
  })

  it('warns before replacing a recipe with the same name', async () => {
    const user = userEvent.setup()
    api.save
      .mockRejectedValueOnce(new ApiError(409, { message: 'exists', exists_in: 'the app' }))
      .mockResolvedValueOnce(saved('soup', 'Soup'))
    renderEditor(null)
    await user.type(await screen.findByLabelText('Name'), 'Soup')
    await user.click(screen.getByRole('button', { name: 'Save recipe' }))
    await user.click(dialog().getByRole('button', { name: 'Replace' }))
    await screen.findByText('recipe page')
    expect(api.save).toHaveBeenLastCalledWith(expect.anything(), {}, true)
  })
})

describe('editing (T2, T5, T6, T9)', () => {
  it('loads the recipe, keeps odd amounts as written, and saves changes', async () => {
    const user = userEvent.setup()
    api.save.mockResolvedValue(saved('bowl', 'Prawn Bowl'))
    renderEditor('bowl')

    expect(await screen.findByLabelText('Name')).toHaveValue('Prawn Bowl')
    expect(screen.getByLabelText('Unit for Aioli')).toHaveValue('written')
    expect(screen.getByLabelText('Amount for Aioli')).toHaveValue('128 g*')
    expect(screen.getByAltText('Recipe photo')).toHaveAttribute('src', expect.stringContaining('/api/recipes/bowl/files/hero.jpg'))

    // Move Aioli up, via its "⋯" actions
    await user.click(screen.getByRole('button', { name: 'More for Aioli' }))
    await user.click(screen.getByRole('button', { name: 'Move Aioli up' }))
    // Move step 2 above step 1
    await user.click(screen.getByRole('button', { name: 'Move step 2 up' }))
    await user.click(screen.getByRole('button', { name: 'Save recipe' }))

    await screen.findByText('recipe page')
    const sent = sentRecipe()
    expect(sent.slug).toBe('bowl')
    expect(sent.ingredients.map((i) => [i.qty, i.name, i.allergens])).toEqual([
      ['128 g*', 'Aioli', ''],
      ['320 g', 'Prawns', 'Crustaceans'],
      ['2 tbsp', 'Oil', ''],
    ])
    expect(sent.steps.map((s) => [s.title, s.photo, s.photo_from])).toEqual([
      ['Serve', 'none', null],
      ['Cook the rice', 'keep', 1],
    ])
    expect(store.remove).toHaveBeenCalledWith('edit:bowl')
  })

  it('asks before removing a step', async () => {
    const user = userEvent.setup()
    renderEditor('bowl')
    await user.click(await screen.findByRole('button', { name: 'Remove step 1' }))
    expect(dialog().getByText('Remove step 1?')).toBeInTheDocument()
    await user.click(dialog().getByRole('button', { name: 'Cancel' }))
    expect(screen.getAllByRole('button', { name: /^Remove step/ })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Remove step 1' }))
    await user.click(dialog().getByRole('button', { name: 'Remove' }))
    expect(screen.getAllByRole('button', { name: /^Remove step/ })).toHaveLength(1)
  })

  it('keeps a draft while editing and puts it back next time', async () => {
    const user = userEvent.setup()
    renderEditor('bowl')
    await user.type(await screen.findByLabelText('Name'), '!')
    await waitFor(() => expect(store.put).toHaveBeenCalled())
    const [key, draft] = store.put.mock.calls.at(-1)!
    expect(key).toBe('edit:bowl')
    expect(draft.state.title).toBe('Prawn Bowl!')
    expect(draft.base).toBe(bowl.updated_at)
  })

  it('restores a saved draft, and can discard it', async () => {
    const user = userEvent.setup()
    store.get.mockResolvedValue({
      state: { slug: 'bowl', title: 'Draft title', subtitle: '', serves: '4', hero: { kind: 'none' }, ingredients: [], steps: [] },
      savedAt: Date.now(), base: 'older',
    })
    renderEditor('bowl')
    expect(await screen.findByLabelText('Name')).toHaveValue('Draft title')
    expect(screen.getByText(/changed since/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    await user.click(dialog().getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Prawn Bowl'))
    expect(store.remove).toHaveBeenCalledWith('edit:bowl')
  })

  it('asks before leaving with unsaved changes', async () => {
    const user = userEvent.setup()
    renderEditor('bowl')
    await user.type(await screen.findByLabelText('Name'), '!')
    await user.click(screen.getByRole('link', { name: 'Go elsewhere' }))
    await user.click(dialog().getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Prawn Bowl!')
    await user.click(screen.getByRole('link', { name: 'Go elsewhere' }))
    await user.click(dialog().getByRole('button', { name: 'Discard' }))
    expect(await screen.findByText('somewhere else')).toBeInTheDocument()
  })

  it('leaves without asking when nothing changed', async () => {
    const user = userEvent.setup()
    renderEditor('bowl')
    await screen.findByLabelText('Name')
    await user.click(screen.getByRole('link', { name: 'Go elsewhere' }))
    expect(await screen.findByText('somewhere else')).toBeInTheDocument()
  })

  it('shows an error for a missing recipe', async () => {
    api.load.mockRejectedValue(new ApiError(404, 'No recipe "bowl"'))
    renderEditor('bowl')
    expect(await screen.findByText('No recipe "bowl"')).toBeInTheDocument()
  })
})
