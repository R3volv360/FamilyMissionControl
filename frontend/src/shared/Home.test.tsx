import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { mondayOf, today } from '../modules/planner/dates'

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const monday = mondayOf(today())

function fakeServer(routes: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const key = Object.keys(routes).find((k) => url.startsWith(k))
    return key ? json(routes[key]) : new Response('not found', { status: 404 })
  })
}

afterEach(() => vi.restoreAllMocks())

const renderHome = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  )

describe('Home dashboard', () => {
  it('shows a card per module with a glance at each', async () => {
    fakeServer({
      '/api/planner/week': {
        start: monday,
        days: [{ day: monday, meals: [{ id: 1, day: monday, position: 0, title: 'Lasagne', recipe: null }] }],
      },
      '/api/planner/list': { start: monday, meals: [{ day: monday, weekday: 'Mon', title: 'Lasagne' }], buy: [{}, {}, {}], pantry: [], freezer: [], unit_mismatches: [] },
      '/api/recipes': [
        { slug: 'a', title: 'A', s3_state: 'done' },
        { slug: 'b', title: 'B', s3_state: 'failed' },
      ],
      '/api/pantry': [
        { id: 1, name: 'Basil', level: 'full' },
        { id: 2, name: 'Rice', level: 'one' },
        { id: 3, name: 'Salt', level: 'empty' },
      ],
      '/api/freezer': [{ id: 1, name: 'Mince', total_label: '1 kg' }],
    })
    renderHome()
    const card = (name: string) => within(screen.getByRole('region', { name }))

    expect(await card('Meal Planner').findByText('Lasagne', { exact: false })).toBeInTheDocument()
    expect(await card('Meal Planner').findByText('3 items to buy')).toBeInTheDocument()
    expect(await card('Recipes').findByText('2 recipes')).toBeInTheDocument()
    expect(card('Recipes').getByText(/1 not yet copied to S3/)).toBeInTheDocument()
    expect(await card('Pantry').findByText('Rice, Salt (empty)')).toBeInTheDocument()
    expect(card('Pantry').getByText('2 to buy')).toBeInTheDocument()
    expect(await card('Freezer').findByText('Mince 1 kg')).toBeInTheDocument()
  })

  it('a module that fails to load says so without breaking the others', async () => {
    fakeServer({ '/api/freezer': [] })
    renderHome()
    expect(await screen.findByText("Couldn't load the pantry.")).toBeInTheDocument()
    expect(await screen.findByText('The freezer is empty.')).toBeInTheDocument()
  })
})
