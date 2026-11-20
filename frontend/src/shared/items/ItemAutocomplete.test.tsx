import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ItemAutocomplete } from './ItemAutocomplete'
import { itemsApi } from './itemsApi'

vi.mock('./itemsApi', () => ({ itemsApi: { search: vi.fn() } }))
const search = vi.mocked(itemsApi.search)

function Harness({ onSelect }: { onSelect: (n: string) => void }) {
  const [v, setV] = useState('')
  return <ItemAutocomplete value={v} onChange={setV} onSelect={onSelect} />
}

beforeEach(() => {
  search.mockReset()
  search.mockResolvedValue([
    { id: 1, name: 'Balsamic Vinegar' },
    { id: 2, name: 'Basil' },
  ])
})

describe('ItemAutocomplete', () => {
  it('suggests remembered items while typing (P4)', async () => {
    render(<Harness onSelect={vi.fn()} />)
    await userEvent.type(screen.getByRole('combobox'), 'Ba')
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Balsamic Vinegar', 'Basil'])
    expect(search).toHaveBeenLastCalledWith('Ba')
    expect(screen.getByText(/adds “Ba” as new/)).toBeInTheDocument()
  })

  it('picks a suggestion by click', async () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    await userEvent.type(screen.getByRole('combobox'), 'Ba')
    await userEvent.click(await screen.findByRole('option', { name: 'Basil' }))
    expect(onSelect).toHaveBeenCalledWith('Basil')
    expect(screen.getByRole('combobox')).toHaveValue('Basil')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('picks a suggestion with arrow keys and Enter', async () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const box = screen.getByRole('combobox')
    await userEvent.type(box, 'Ba')
    await screen.findAllByRole('option')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('Basil')
  })

  it('Enter with nothing highlighted submits the typed name as new', async () => {
    const onSelect = vi.fn()
    search.mockResolvedValue([])
    render(<Harness onSelect={onSelect} />)
    await userEvent.type(screen.getByRole('combobox'), '  Sumac {Enter}')
    expect(onSelect).toHaveBeenCalledWith('Sumac')
  })

  it('hides the "add as new" hint on an exact match', async () => {
    render(<Harness onSelect={vi.fn()} />)
    await userEvent.type(screen.getByRole('combobox'), 'basil')
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('basil'))
    await screen.findAllByRole('option')
    expect(screen.queryByText(/as new/)).not.toBeInTheDocument()
  })
})
