import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => vi.restoreAllMocks())

describe('api', () => {
  it('prefixes /api and sends JSON bodies', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { id: 1 }))
    expect(await api.post('/items', { name: 'Basil' })).toEqual({ id: 1 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/items')
    expect(init?.body).toBe('{"name":"Basil"}')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('passes FormData through untouched', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, {}))
    const fd = new FormData()
    await api.post('/recipes/upload', fd)
    expect(fetchMock.mock.calls[0][1]?.body).toBe(fd)
  })

  it('treats an empty 204 response as success, even when labelled JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204, headers: { 'content-type': 'application/json' } }),
    )
    await expect(api.delete('/pantry/1')).resolves.toBeUndefined()
  })

  it('throws ApiError with FastAPI detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(409, { detail: 'Already exists' }))
    const err = (await api.get('/items').catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(409)
    expect(err.message).toBe('Already exists')
  })
})
