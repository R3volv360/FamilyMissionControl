import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import { ConfirmProvider } from '../../shared/ConfirmDialog'
import { ToastProvider } from '../../shared/Toast'
import { RecipeDetail } from './RecipeDetail'
import { recipesApi } from './recipesApi'
import { RichText } from './RichText'
import { SyncPage } from './SyncPage'
import { UploadPage } from './UploadPage'

vi.mock('./recipesApi', async (orig) => {
  const real = await orig<typeof import('./recipesApi')>()
  return {
    ...real,
    recipesApi: { get: vi.fn(), syncStatus: vi.fn(), syncUp: vi.fn(), syncDown: vi.fn(), delete: vi.fn(), upload: vi.fn(), awsStatus: vi.fn(), usage: vi.fn() },
  }
})
const api = vi.mocked(recipesApi)

const wrap = (ui: React.ReactNode, path = '/recipes/x') =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/recipes/x" element={ui} />
            <Route path="/recipes/:slug" element={<p>detail page</p>} />
            <Route path="/recipes" element={<p>recipe list</p>} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>,
  )

const dialog = () => within(screen.getByRole('alertdialog'))

const connected = {
  ok: true, message: 'Connected to S3 (test-recipes) as recipes-role/server1.', profile: 'recipe-sync',
  identity: 'recipes-role/server1', cert: null, cert_warning: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  api.awsStatus.mockResolvedValue(connected)
  api.usage.mockResolvedValue({})
})

describe('RichText', () => {
  it('bolds <b> and drops other markup', () => {
    const { container } = render(<RichText text={'Add the <b>rice</b> &amp; <img src=x onerror="alert(1)">salt'} />)
    expect(container.innerHTML).toBe('Add the <strong>rice</strong> &amp; <span></span>salt')
  })
})

describe('SyncPage (R3/R4)', () => {
  beforeEach(() => {
    api.syncStatus.mockResolvedValue([
      { slug: 'both-one', title: 'Both One', state: 'both' },
      { slug: 'app-one', title: 'App One', state: 'app' },
      { slug: 's3-one', title: 'S3 One', state: 's3' },
    ])
  })

  const rowOf = (title: string) => within(screen.getByText(title).closest('li')!)

  it('lists nothing until Sync is pressed, then marks each recipe', async () => {
    wrap(<SyncPage />)
    expect(api.syncStatus).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(await screen.findByText('Both One')).toBeInTheDocument()
    expect(rowOf('Both One').getByText('In both')).toBeInTheDocument()
    expect(rowOf('App One').getByText('App only')).toBeInTheDocument()
    expect(rowOf('S3 One').getByText('S3 only')).toBeInTheDocument()
    expect(rowOf('App One').queryByText('Sync down')).not.toBeInTheDocument()
    expect(rowOf('S3 One').queryByText('Sync up')).not.toBeInTheDocument()
  })

  it('syncs an app-only recipe up without asking', async () => {
    api.syncUp.mockResolvedValue(undefined)
    wrap(<SyncPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))
    await userEvent.click(await rowOf('App One').findByText('Sync up'))
    await waitFor(() => expect(api.syncUp).toHaveBeenCalledWith('app-one', false))
  })

  it('warns before overwriting when re-syncing a recipe in both places', async () => {
    api.syncDown.mockResolvedValue({ recipe: {} as never, replaced: true, warnings: [], ignored: [] })
    wrap(<SyncPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))
    await userEvent.click(await rowOf('Both One').findByText('Sync down'))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Replace “Both One” in the app?')
    await userEvent.click(dialog().getByText('Replace in app'))
    await waitFor(() => expect(api.syncDown).toHaveBeenCalledWith('both-one', true))
  })

  it('asks "are you sure" before deleting, with the right places offered', async () => {
    api.delete.mockResolvedValue(undefined)
    wrap(<SyncPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))
    const select = await screen.findByLabelText('Delete Both One')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Delete…', 'From the app', 'From S3', 'From the app and S3',
    ])
    expect(within(screen.getByLabelText('Delete S3 One')).getAllByRole('option')).toHaveLength(2)

    await userEvent.selectOptions(select, 'both')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete “Both One” from the app and S3?')
    await userEvent.click(dialog().getByText('Cancel'))
    expect(api.delete).not.toHaveBeenCalled()

    await userEvent.selectOptions(select, 's3')
    await userEvent.click(dialog().getByText('Delete'))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('both-one', 's3'))
  })
})

describe('Deleting a planned recipe', () => {
  it('warns that upcoming meals will lose their recipe', async () => {
    api.syncStatus.mockResolvedValue([{ slug: 'pasta', title: 'Pasta', state: 'both' }])
    api.usage.mockResolvedValue({ 'upcoming meals': 2, 'past meals': 4 })
    wrap(<SyncPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))
    await userEvent.selectOptions(await screen.findByLabelText('Delete Pasta'), 'app')
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('planned for 2 upcoming meals')
  })

  it("doesn't check meals when deleting only from S3", async () => {
    api.syncStatus.mockResolvedValue([{ slug: 'pasta', title: 'Pasta', state: 'both' }])
    wrap(<SyncPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))
    await userEvent.selectOptions(await screen.findByLabelText('Delete Pasta'), 's3')
    expect(await screen.findByRole('alertdialog')).not.toHaveTextContent('planned')
    expect(api.usage).not.toHaveBeenCalled()
  })
})

describe('Deleting from the recipe page', () => {
  const recipe = (s3_state: string | null) =>
    ({
      slug: 'x', title: 'Pasta', subtitle: '', serves: 4, s3_state, s3_error: null, updated_at: '2026-11-25T00:00:00',
      data: { title: 'Pasta', steps: [] }, ingredients: [], files: [],
    }) as never

  it('deletes from the app after asking, then goes back to the list', async () => {
    api.get.mockResolvedValue(recipe('done'))
    api.usage.mockResolvedValue({ 'upcoming meals': 1 })
    api.delete.mockResolvedValue(undefined)
    wrap(<RecipeDetail />)
    const select = await screen.findByLabelText('Delete Pasta')
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Delete…', 'From the app', 'From S3', 'From the app and S3',
    ])
    await userEvent.selectOptions(select, 'app')
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('planned for 1 upcoming meal')
    await userEvent.click(dialog().getByText('Delete'))
    await screen.findByText('recipe list')
    expect(api.delete).toHaveBeenCalledWith('x', 'app')
  })

  it("only offers the app when the recipe hasn't been sent to S3, and Cancel keeps it", async () => {
    api.get.mockResolvedValue(recipe(null))
    wrap(<RecipeDetail />)
    const select = await screen.findByLabelText('Delete Pasta')
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Delete…', 'From the app'])
    await userEvent.selectOptions(select, 'app')
    await userEvent.click(await within(await screen.findByRole('alertdialog')).findByText('Cancel'))
    expect(api.delete).not.toHaveBeenCalled()
  })
})

describe('AWS status on the Sync page (A6/A7)', () => {
  it('says when the app is connected', async () => {
    wrap(<SyncPage />)
    expect(await screen.findByText(/Connected to S3/)).toBeInTheDocument()
    expect(api.syncStatus).not.toHaveBeenCalled() // checking the connection doesn't sync
  })

  it('explains a problem in plain English, and checks again on request', async () => {
    api.awsStatus.mockResolvedValueOnce({
      ...connected, ok: false, message: 'No AWS credentials on this server.', identity: null,
    })
    wrap(<SyncPage />)
    expect(await screen.findByText('No AWS credentials on this server.')).toBeInTheDocument()
    expect(document.querySelector('.aws-bad')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText(/Connected to S3/)).toBeInTheDocument()
    expect(api.awsStatus).toHaveBeenCalledTimes(2)
  })

  it('warns when the certificate is close to expiring', async () => {
    api.awsStatus.mockResolvedValue({
      ...connected,
      cert: { subject: 'test-server1', expires: '2026-12-02T00:00:00Z', days_left: 12 },
      cert_warning: "The server's certificate (test-server1) expires in 12 days, on 2 Dec 2026.",
    })
    wrap(<SyncPage />)
    expect(await screen.findByText(/expires in 12 days/)).toBeInTheDocument()
  })
})

describe('UploadPage (R2)', () => {
  const recipeJson = JSON.stringify({ title: 'Prawn Bowl', steps: [['a', []], ['b', []]], ingredients: [] })
  const file = (name: string, content = 'x', folder = 'prawn-bowl') => {
    const f = new File([content], name)
    Object.defineProperty(f, 'webkitRelativePath', { value: `${folder}/${name}` })
    return f
  }

  const pickFolder = async (files: File[]) => {
    const input = document.querySelector('input[webkitdirectory]') as HTMLInputElement
    await userEvent.upload(input, files)
  }

  it('previews the folder, then uploads and opens the recipe', async () => {
    api.upload.mockResolvedValue({
      recipe: { slug: 'prawn-bowl', title: 'Prawn Bowl' } as never, replaced: false, warnings: [], ignored: [],
    })
    wrap(<UploadPage />)
    await pickFolder([file('recipe.json', recipeJson), file('hero.jpg'), file('s1.jpg'), file('notes.txt')])
    expect(await screen.findByRole('heading', { name: 'Prawn Bowl' })).toBeInTheDocument()
    expect(screen.getByLabelText('Folder name')).toHaveValue('prawn-bowl')
    expect(screen.getByText('1 of 2 step photos')).toBeInTheDocument()
    expect(screen.getByText(/Missing: s2.jpg/)).toBeInTheDocument()
    expect(screen.getByText(/Ignored: notes.txt/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
    await screen.findByText('detail page')
    const [folder, files, overwrite] = api.upload.mock.calls[0]
    expect(folder).toBe('prawn-bowl')
    expect(files.map((f) => f.name)).toEqual(['recipe.json', 'hero.jpg', 's1.jpg'])
    expect(overwrite).toBe(false)
  })

  it('warns that an existing recipe will be replaced, then overwrites', async () => {
    api.upload
      .mockRejectedValueOnce(new ApiError(409, { message: 'exists', exists_in: 'the app' }))
      .mockResolvedValueOnce({ recipe: { slug: 'prawn-bowl', title: 'Prawn Bowl' } as never, replaced: true, warnings: [], ignored: [] })
    wrap(<UploadPage />)
    await pickFolder([file('recipe.json', recipeJson)])
    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Replace “Prawn Bowl”?')
    await userEvent.click(dialog().getByText('Replace'))
    await screen.findByText('detail page')
    expect(api.upload.mock.calls[1][2]).toBe(true)
  })

  it('warns when another folder has a recipe with the same title, then adds it anyway', async () => {
    api.upload
      .mockRejectedValueOnce(new ApiError(409, { message: 'same', same_title: 'prawn-bowl-old' }))
      .mockResolvedValueOnce({ recipe: { slug: 'prawn-bowl', title: 'Prawn Bowl' } as never, replaced: false, warnings: [], ignored: [] })
    wrap(<UploadPage />)
    await pickFolder([file('recipe.json', recipeJson)])
    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }))
    const alert = await screen.findByRole('alertdialog')
    expect(alert).toHaveTextContent('There\'s already a recipe called “Prawn Bowl”')
    expect(alert).toHaveTextContent('set the folder name to “prawn-bowl-old”')
    await userEvent.click(dialog().getByText('Add a second one'))
    await screen.findByText('detail page')
    expect(api.upload.mock.calls[1].slice(2)).toEqual([false, true])
  })

  it('uploads the recipe-card zip as it is; the server unpacks it', async () => {
    api.upload.mockResolvedValue({
      recipe: { slug: 'prawn-bowl', title: 'Prawn Bowl' } as never, replaced: false, warnings: [], ignored: [],
    })
    wrap(<UploadPage />)
    const zip = new File(['PK'], 'prawn-bowl.zip', { type: 'application/zip' })
    await userEvent.upload(document.querySelector('input[accept^=".zip"]') as HTMLInputElement, zip)
    expect(await screen.findByRole('heading', { name: 'prawn-bowl.zip' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
    await screen.findByText('detail page')
    expect(api.upload).toHaveBeenCalledWith('', [zip], false, false)
  })

  it('explains when there is no recipe.json', async () => {
    wrap(<UploadPage />)
    await pickFolder([file('hero.jpg')])
    expect(await screen.findByText(/no recipe.json/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument()
  })
})
