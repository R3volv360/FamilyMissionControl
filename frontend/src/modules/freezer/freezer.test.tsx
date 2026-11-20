import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '../../shared/ConfirmDialog'
import { itemsApi } from '../../shared/items/itemsApi'
import { ToastProvider } from '../../shared/Toast'
import { freezerApi, type FreezerEntry } from './freezerApi'
import { FreezerPage } from './FreezerPage'
import { formatGrams, parseGrams } from './grams'

vi.mock('./freezerApi', () => ({
  freezerApi: { list: vi.fn(), add: vi.fn(), addPack: vi.fn(), removePack: vi.fn(), remove: vi.fn() },
}))
vi.mock('../../shared/items/itemsApi', async (orig) => {
  const real = await orig<typeof import('../../shared/items/itemsApi')>()
  return { ...real, itemsApi: { search: vi.fn(), list: vi.fn() } }
})
const api = vi.mocked(freezerApi)

const mince = (packs: [number, number][]): FreezerEntry => {
  const total = packs.reduce((s, [w, c]) => s + w * c, 0)
  return {
    id: 1, item_id: 1, name: 'Mince', total_g: total, total_label: formatGrams(total),
    breakdown: packs.map(([w, c]) => `${c} × ${formatGrams(w)}`).join(', '),
    packs: packs.map(([w, c]) => ({ weight_g: w, count: c, label: formatGrams(w) })),
    updated_at: '2026-11-20T00:00:00',
  }
}

const setup = () =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <FreezerPage />
      </ConfirmProvider>
    </ToastProvider>,
  )

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(itemsApi.search).mockResolvedValue([])
  vi.mocked(itemsApi.list).mockResolvedValue([])
  api.list.mockResolvedValue([mince([[400, 2], [200, 1]])])
})

describe('grams', () => {
  it.each([
    ['400', 400], ['400g', 400], ['400 g', 400], ['1kg', 1000], ['1.5 kg', 1500], ['1,25kg', 1250], [' 750 G ', 750],
  ])('parses %s', (text, g) => expect(parseGrams(text)).toBe(g))

  it.each(['', 'abc', '0', '-5', '1 lb', '1kgg'])('rejects %s', (text) => expect(parseGrams(text)).toBeNull())

  it.each([[400, '400 g'], [1000, '1 kg'], [1250, '1.25 kg'], [2005, '2.005 kg']])('formats %i', (g, label) =>
    expect(formatGrams(g)).toBe(label),
  )
})

describe('FreezerPage', () => {
  it('shows each item with its total and pack breakdown (F2)', async () => {
    setup()
    expect(await screen.findByText('Mince')).toBeInTheDocument()
    expect(screen.getByText('1 kg')).toBeInTheDocument()
    expect(screen.getByText('2 × 400 g')).toBeInTheDocument()
    expect(screen.getByText('1 × 200 g')).toBeInTheDocument()
  })

  it('adds an item with packs, checking they add up to the total (F1)', async () => {
    api.add.mockResolvedValue({ entry: mince([[400, 2], [200, 1]]), created: true })
    setup()
    await screen.findByText('Mince')
    await userEvent.type(screen.getByRole('combobox', { name: 'Item name' }), 'Mince')
    await userEvent.type(screen.getByLabelText('Total weight'), '1kg')
    const count1 = screen.getByLabelText('Number of packs, row 1')
    await userEvent.clear(count1)
    await userEvent.type(count1, '2')
    await userEvent.type(screen.getByLabelText('Pack weight, row 1'), '400 g')
    expect(screen.getByText('The packs add up to 800 g, not 1 kg.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to freezer' })).toBeDisabled()

    await userEvent.click(screen.getByText('+ Another pack size'))
    await userEvent.type(screen.getByLabelText('Pack weight, row 2'), '200')
    expect(screen.getByText('2 × 400 g + 1 × 200 g = 1 kg ✓')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add to freezer' }))
    await waitFor(() =>
      expect(api.add).toHaveBeenCalledWith('Mince', [{ count: 2, weight_g: 400 }, { count: 1, weight_g: 200 }], 1000),
    )
  })

  it('total is optional', async () => {
    api.add.mockResolvedValue({ entry: mince([[500, 1]]), created: true })
    setup()
    await screen.findByText('Mince')
    await userEvent.type(screen.getByRole('combobox', { name: 'Item name' }), 'Peas')
    await userEvent.type(screen.getByLabelText('Pack weight, row 1'), '900g')
    await userEvent.click(screen.getByRole('button', { name: 'Add to freezer' }))
    await waitFor(() => expect(api.add).toHaveBeenCalledWith('Peas', [{ count: 1, weight_g: 900 }], null))
  })

  it('adds and removes single packs (F3)', async () => {
    api.addPack.mockResolvedValue(mince([[400, 3], [200, 1]]))
    api.removePack.mockResolvedValue({ entry: mince([[400, 3]]) })
    setup()
    await screen.findByText('Mince')
    await userEvent.click(screen.getByRole('button', { name: 'Add a 400 g pack of Mince' }))
    expect(api.addPack).toHaveBeenCalledWith(1, 400)
    expect(await screen.findByText('3 × 400 g')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Use one 200 g pack of Mince' }))
    expect(api.removePack).toHaveBeenCalledWith(1, 200)
    await waitFor(() => expect(screen.queryByText('1 × 200 g')).not.toBeInTheDocument())
  })

  it('asks before using the last pack, which takes the item off the list', async () => {
    api.list.mockResolvedValueOnce([mince([[400, 1]])]).mockResolvedValue([])
    api.removePack.mockResolvedValue({ entry: null })
    setup()
    await screen.findByText('Mince')
    await userEvent.click(screen.getByRole('button', { name: 'Use one 400 g pack of Mince' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Use the last pack of Mince?')
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Use last pack' }))
    expect(await screen.findByText('The freezer is empty.')).toBeInTheDocument()
  })

  it('adds a pack of a new size', async () => {
    api.addPack.mockResolvedValue(mince([[500, 1], [400, 2], [200, 1]]))
    setup()
    await screen.findByText('Mince')
    await userEvent.click(screen.getByText('+ Other size'))
    await userEvent.type(screen.getByLabelText('New pack weight for Mince'), '0.5kg{Enter}')
    expect(api.addPack).toHaveBeenCalledWith(1, 500)
    expect(await screen.findByText('1 × 500 g')).toBeInTheDocument()
  })
})
