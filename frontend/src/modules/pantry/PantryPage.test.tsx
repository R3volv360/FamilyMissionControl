import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '../../shared/ConfirmDialog'
import { itemsApi } from '../../shared/items/itemsApi'
import { ToastProvider } from '../../shared/Toast'
import { pantryApi, type PantryEntry } from './pantryApi'
import { PantryPage } from './PantryPage'

vi.mock('./pantryApi', async (orig) => {
  const real = await orig<typeof import('./pantryApi')>()
  return { ...real, pantryApi: { list: vi.fn(), add: vi.fn(), setLevel: vi.fn(), remove: vi.fn() } }
})
vi.mock('../../shared/items/itemsApi', async (orig) => {
  const real = await orig<typeof import('../../shared/items/itemsApi')>()
  return { ...real, itemsApi: { search: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue([]) } }
})
const api = vi.mocked(pantryApi)

const entry = (id: number, name: string, level: PantryEntry['level']): PantryEntry => ({
  id, item_id: id, name, level, updated_at: '2026-11-20T00:00:00',
})

const setup = () =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <PantryPage />
      </ConfirmProvider>
    </ToastProvider>,
  )

beforeEach(() => {
  vi.mocked(itemsApi.search).mockResolvedValue([])
  vi.mocked(itemsApi.list).mockResolvedValue([])
  api.list.mockReset().mockResolvedValue([entry(1, 'Basil', 'full'), entry(2, 'Rice', 'one'), entry(3, 'Salt', 'empty')])
  api.add.mockReset()
  api.setLevel.mockReset()
  api.remove.mockReset()
})

const row = (name: string) => within(screen.getByText(name).closest('li')!)

describe('PantryPage', () => {
  it('lists items with their stock level (P2) and counts what to buy', async () => {
    setup()
    await screen.findByText('Basil')
    expect(row('Basil').getByRole('radio', { name: 'Fully stocked' })).toHaveAttribute('aria-checked', 'true')
    expect(row('Rice').getByRole('radio', { name: 'Only one' })).toHaveAttribute('aria-checked', 'true')
    expect(row('Salt').getByRole('radio', { name: 'Empty' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/3 items · 2 to buy/)).toBeInTheDocument()
  })

  it('"To buy" shows only items not fully stocked', async () => {
    setup()
    await screen.findByText('Basil')
    await userEvent.click(screen.getByRole('button', { name: 'To buy (2)' }))
    expect(screen.queryByText('Basil')).not.toBeInTheDocument()
    expect(screen.getByText('Rice')).toBeInTheDocument()
    expect(screen.getByText('Salt')).toBeInTheDocument()
  })

  it('sets a stock level (P3)', async () => {
    api.setLevel.mockResolvedValue(entry(1, 'Basil', 'empty'))
    setup()
    await screen.findByText('Basil')
    await userEvent.click(row('Basil').getByRole('radio', { name: 'Empty' }))
    expect(api.setLevel).toHaveBeenCalledWith(1, 'empty')
    expect(row('Basil').getByRole('radio', { name: 'Empty' })).toHaveAttribute('aria-checked', 'true')
  })

  it('adds an item by typing its name and pressing Enter (P1)', async () => {
    api.add.mockResolvedValue({ entry: entry(4, 'Thyme', 'full'), created: true })
    setup()
    await screen.findByText('Basil')
    await userEvent.type(screen.getByRole('combobox', { name: 'Add to pantry' }), 'thyme{Enter}')
    await waitFor(() => expect(api.add).toHaveBeenCalledWith('thyme'))
    expect(screen.getByRole('combobox', { name: 'Add to pantry' })).toHaveValue('')
    expect(await screen.findByText('Added Thyme')).toBeInTheDocument()
  })

  it('says so when the item is already in the pantry', async () => {
    api.add.mockResolvedValue({ entry: entry(1, 'Basil', 'full'), created: false })
    setup()
    await screen.findByText('Basil')
    await userEvent.type(screen.getByRole('combobox', { name: 'Add to pantry' }), 'basil')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('Basil is already in the pantry')).toBeInTheDocument()
  })

  it('asks before taking an item off the list', async () => {
    api.remove.mockResolvedValue(undefined)
    setup()
    await screen.findByText('Basil')
    await userEvent.click(screen.getByRole('button', { name: 'Remove Basil' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Take Basil off the pantry list?')
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(1))
  })
})
