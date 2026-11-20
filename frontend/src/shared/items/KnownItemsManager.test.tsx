import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import { ConfirmProvider } from '../ConfirmDialog'
import { ToastProvider } from '../Toast'
import { itemsApi } from './itemsApi'
import { KnownItemsManager } from './KnownItemsManager'

vi.mock('./itemsApi', async (orig) => {
  const real = await orig<typeof import('./itemsApi')>()
  return {
    ...real,
    itemsApi: { list: vi.fn(), get: vi.fn(), rename: vi.fn(), delete: vi.fn() },
  }
})
const m = vi.mocked(itemsApi)

const setup = () =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <KnownItemsManager />
      </ConfirmProvider>
    </ToastProvider>,
  )

beforeEach(() => {
  vi.resetAllMocks()
  m.list.mockResolvedValue([
    { id: 1, name: 'Basil' },
    { id: 2, name: 'Bazil' },
  ])
})

const renameRow = async (from: string, to: string) => {
  await screen.findByText(from)
  const row = screen.getByText(from).closest('li')!
  await userEvent.click(row.querySelector('button')!) // Rename
  const input = screen.getByLabelText(`New name for ${from}`)
  await userEvent.clear(input)
  await userEvent.type(input, `${to}{Enter}`)
}

describe('KnownItemsManager', () => {
  it('asks before renaming, then renames (P5)', async () => {
    m.rename.mockResolvedValue({ item: { id: 2, name: 'Thyme' }, merged_from: null })
    setup()
    await renameRow('Bazil', 'Thyme')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Rename “Bazil” to “Thyme”?')
    expect(m.rename).not.toHaveBeenCalled()
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(m.rename).toHaveBeenCalledWith(2, 'Thyme'))
  })

  it('offers to merge when the new name already exists', async () => {
    m.rename
      .mockRejectedValueOnce(new ApiError(409, { message: 'x', conflict: { id: 1, name: 'Basil' } }))
      .mockResolvedValueOnce({ item: { id: 1, name: 'Basil' }, merged_from: 2 })
    setup()
    await renameRow('Bazil', 'Basil')
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Rename' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('“Basil” already exists')
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(m.rename).toHaveBeenLastCalledWith(2, 'Basil', true))
  })

  it('asks before deleting, mentioning where the item is used', async () => {
    m.get.mockResolvedValue({ id: 1, name: 'Basil', usage: { pantry: 1, recipes: 2 } })
    m.delete.mockResolvedValue(undefined)
    setup()
    await screen.findByText('Basil')
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('in the pantry and used by 2 recipes')
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(m.delete).toHaveBeenCalledWith(1, true))
  })

  it('does nothing when delete is cancelled', async () => {
    m.get.mockResolvedValue({ id: 1, name: 'Basil', usage: {} })
    setup()
    await screen.findByText('Basil')
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(m.delete).not.toHaveBeenCalled()
  })
})
