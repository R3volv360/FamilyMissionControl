import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '../../shared/ConfirmDialog'
import { ToastProvider } from '../../shared/Toast'
import { recipesApi } from '../recipes/recipesApi'
import { addDays, mondayOf, today } from './dates'
import { dropAction } from './dropAction'
import { plannerApi, type Meal, type ShoppingList, type Week } from './plannerApi'
import { PlannerPage } from './PlannerPage'

vi.mock('./plannerApi', () => ({
  plannerApi: { week: vi.fn(), add: vi.fn(), replace: vi.fn(), remove: vi.fn(), copy: vi.fn(), list: vi.fn() },
}))
vi.mock('../recipes/recipesApi', async (orig) => {
  const real = await orig<typeof import('../recipes/recipesApi')>()
  return { ...real, recipesApi: { list: vi.fn() } }
})
const api = vi.mocked(plannerApi)

const MON = '2026-11-16'
const meal = (id: number, day: string, title: string, slug: string | null = title.toLowerCase()): Meal => ({
  id, day, position: 0, title,
  recipe: slug ? { slug, title, updated_at: '2026-11-20T00:00:00' } : null,
})
const weekOf = (start: string, meals: Meal[] = []): Week => ({
  start,
  days: Array.from({ length: 7 }, (_, i) => {
    const day = addDays(start, i)
    return { day, meals: meals.filter((m) => m.day === day) }
  }),
})
const emptyList = (start: string): ShoppingList => ({ start, meals: [], buy: [], pantry: [], freezer: [], pantry_one: [], pantry_empty: [], unit_mismatches: [] })

const setup = (path = `/planner?week=${MON}`) =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter initialEntries={[path]}>
          <PlannerPage />
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>,
  )

beforeEach(() => {
  vi.resetAllMocks()
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
  vi.mocked(recipesApi.list).mockResolvedValue([
    { slug: 'pasta', title: 'Pasta', subtitle: '', serves: 4, s3_state: 'done', s3_error: null, updated_at: '2026-11-20T00:00:00' },
  ])
  api.week.mockImplementation(async (day) => weekOf(mondayOf(day)))
  api.list.mockImplementation(async (day) => emptyList(mondayOf(day)))
})

describe('dates', () => {
  it('finds the Monday of any day', () => {
    expect(mondayOf('2026-11-16')).toBe('2026-11-16')
    expect(mondayOf('2026-11-22')).toBe('2026-11-16') // Sunday
    expect(mondayOf('2026-11-18')).toBe('2026-11-16')
    expect(mondayOf('2027-01-01')).toBe('2026-12-28') // across a year end
  })
})

describe('dropAction', () => {
  const planned = meal(5, MON, 'Pasta', 'pasta')
  it('adds when dropped on a day or "Add new" (M3, M5)', () => {
    expect(dropAction('curry', `add:${MON}`)).toEqual({ kind: 'add', day: MON, slug: 'curry' })
  })
  it('replaces when dropped on a meal (M4)', () => {
    expect(dropAction('curry', 'meal:5', planned)).toEqual({ kind: 'replace', mealId: 5, slug: 'curry' })
  })
  it('does nothing when dropped on the same recipe, or nowhere', () => {
    expect(dropAction('pasta', 'meal:5', planned)).toBeNull()
    expect(dropAction('pasta', null)).toBeNull()
    expect(dropAction(undefined, `add:${MON}`)).toBeNull()
  })
})

describe('PlannerPage', () => {
  it('shows the week Monday to Sunday with planned meals and the recipe carousel (M1, M2)', async () => {
    api.week.mockResolvedValue(weekOf(MON, [meal(1, MON, 'Pasta'), meal(2, '2026-11-18', 'Curry')]))
    setup()
    expect(await screen.findByText('Week of 16 Nov 2026')).toBeInTheDocument()
    const days = screen.getAllByRole('region').filter((r) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /.test(r.getAttribute('aria-label') ?? ''))
    expect(days.map((d) => d.getAttribute('aria-label'))).toEqual([
      'Mon 16 Nov', 'Tue 17 Nov', 'Wed 18 Nov', 'Thu 19 Nov', 'Fri 20 Nov', 'Sat 21 Nov', 'Sun 22 Nov',
    ])
    expect(within(days[0]).getByText('Pasta')).toBeInTheDocument()
    expect(within(days[1]).getByText('Drop a recipe here, or tap to choose')).toBeInTheDocument()
    expect(within(days[0]).getByText('+ Add new')).toBeInTheDocument()
    expect(await screen.findByLabelText('Pasta. Drag onto a day to plan it.')).toBeInTheDocument()
  })

  it('moves between weeks (M7)', async () => {
    setup()
    await screen.findByText('Week of 16 Nov 2026')
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(await screen.findByText('Week of 23 Nov 2026')).toBeInTheDocument()
    expect(api.week).toHaveBeenLastCalledWith('2026-11-23')
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(await screen.findByText('Week of 9 Nov 2026')).toBeInTheDocument()
  })

  it('defaults to this week', async () => {
    setup('/planner')
    await waitFor(() => expect(api.week).toHaveBeenCalledWith(mondayOf(today())))
  })

  it('adds a meal by tapping a day and choosing a recipe (no dragging needed)', async () => {
    api.add.mockResolvedValue(meal(9, '2026-11-18', 'Pasta'))
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Add a meal to Wed 18 Nov' }))
    const picker = await screen.findByRole('dialog', { name: 'Add a meal to Wed 18 Nov' })
    await userEvent.click(within(picker).getByRole('button', { name: 'Pasta' }))
    expect(api.add).toHaveBeenCalledWith('2026-11-18', 'pasta')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the recipe picker filters and closes with Escape', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Add a meal to Mon 16 Nov' }))
    const picker = await screen.findByRole('dialog')
    await userEvent.type(within(picker).getByRole('textbox', { name: 'Find a recipe' }), 'zzz')
    expect(screen.getByText('No recipes match “zzz”.')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.add).not.toHaveBeenCalled()
  })

  it('removes a meal with its X (M6)', async () => {
    api.week.mockResolvedValue(weekOf(MON, [meal(1, MON, 'Pasta')]))
    api.remove.mockResolvedValue(undefined)
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Pasta from Mon 16 Nov' }))
    expect(api.remove).toHaveBeenCalledWith(1)
  })

  it('shows a deleted recipe as removed', async () => {
    api.week.mockResolvedValue(weekOf(MON, [meal(1, MON, 'Old Stew', null)]))
    setup()
    expect(await screen.findByText('(recipe removed)')).toBeInTheDocument()
  })

  it('copies a week and pastes it into another, asking before replacing (M9)', async () => {
    api.week.mockImplementation(async (day) =>
      weekOf(mondayOf(day), mondayOf(day) === MON ? [meal(1, MON, 'Pasta')] : [meal(2, '2026-11-23', 'Curry')]),
    )
    api.copy.mockResolvedValue({ copied: 1 })
    setup()
    await screen.findByRole('button', { name: 'Remove Pasta from Mon 16 Nov' })
    await userEvent.click(screen.getByRole('button', { name: 'Copy week' }))
    expect(screen.queryByRole('button', { name: /Paste week/ })).not.toBeInTheDocument() // not into itself

    await userEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await screen.findByRole('button', { name: 'Remove Curry from Mon 23 Nov' })
    await userEvent.click(screen.getByRole('button', { name: 'Paste week of 16 Nov' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent("Replace this week's 1 meal?")
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace' }))
    await waitFor(() => expect(api.copy).toHaveBeenCalledWith(MON, '2026-11-23', true))
  })

  it('shows one total per ingredient, split three ways, with the meals listed separately (M8, M11, M10)', async () => {
    const line = (name: string, total: string, extra: Partial<ShoppingList['buy'][0]> = {}) => ({
      name, item_id: 1, total, pantry_level: null, freezer_g: null, freezer_label: null, unit_mismatch: false,
      short_label: null, ...extra,
    })
    api.list.mockResolvedValue({
      start: MON,
      meals: [
        { day: MON, weekday: 'Mon', title: 'Pesto' },
        { day: '2026-11-18', weekday: 'Wed', title: 'Curry' },
      ],
      buy: [line('Basil', '2 bunches', { pantry_level: 'one' }), line('Ingredient X', '700 g')],
      pantry: [line('Olive oil', '4 tbsp', { pantry_level: 'full' })],
      freezer: [line('Chicken breasts', '2', { freezer_g: 600, freezer_label: '600 g', unit_mismatch: true })],
      pantry_one: [line('Tea', '', { pantry_level: 'one' })],
      pantry_empty: [line('Sugar', '', { pantry_level: 'empty' })],
      unit_mismatches: ['Chicken breasts'],
    })
    setup()
    const panel = await screen.findByRole('region', { name: 'Shopping list' })
    const buyItem = within(panel).getByText('Ingredient X').closest('li')!
    expect(buyItem).toHaveTextContent('Ingredient X700 g')
    expect(within(panel).queryByText(/Pesto \(Mon\)/)).not.toBeInTheDocument() // no per-recipe breakdown
    expect(within(panel).getByText('To buy for meals (2)')).toBeInTheDocument()
    expect(within(panel).getByText('Pantry: only one left (1)')).toBeInTheDocument()
    expect(within(panel).getByText('Pantry: empty (1)')).toBeInTheDocument()
    expect(within(panel).getByText('Pantry: only one left')).toBeInTheDocument()
    expect(within(panel).getByText('Already in the pantry (1)')).toBeInTheDocument()
    expect(within(panel).getByText('In the freezer (1)')).toBeInTheDocument()
    expect(within(panel).getByText('Units differ: check')).toBeInTheDocument()
    expect(within(panel).getByText(/Check the freezer:/).closest('p')).toHaveTextContent('Chicken breasts')
    expect(within(panel).getByText('Meals this week (2)')).toBeInTheDocument()
    const meals = panel.querySelector('.meal-summary')!
    expect(meals).toHaveTextContent('Mon Pesto')
    expect(meals).toHaveTextContent('Wed Curry')

    const print = document.querySelector('.print-list')!
    expect(print.querySelectorAll('li')).toHaveLength(4)
    expect(print.querySelectorAll('.tick')).toHaveLength(4)
    expect([...print.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'To buy for meals', 'Pantry: only one left', 'Pantry: empty',
    ])
    expect(print).toHaveTextContent(/Ingredient X.*Tea.*Sugar/)
    expect(print).toHaveTextContent('Ingredient X700 g')
    expect(print).not.toHaveTextContent('Olive oil')
    expect(print).toHaveTextContent('check before shopping: Chicken breasts')
    expect(print).toHaveTextContent('Meals: Mon Pesto · Wed Curry')

    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    await userEvent.click(within(panel).getByRole('button', { name: 'Print “to buy” list' }))
    expect(printSpy).toHaveBeenCalled()
  })
})
