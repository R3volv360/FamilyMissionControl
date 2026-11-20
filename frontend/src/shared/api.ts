/** Thin typed wrapper around fetch for the FastAPI backend (all routes live under /api). */

export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `Request failed (${status})`)
    this.status = status
    this.detail = detail
  }
}

type Body = BodyInit | object | undefined

async function request<T>(method: string, path: string, body?: Body): Promise<T> {
  const init: RequestInit = { method, headers: {} }
  if (body instanceof FormData || typeof body === 'string' || body instanceof Blob) {
    init.body = body
  } else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  const res = await fetch(`/api${path}`, init)
  // Deletes answer 204 with an empty body (FastAPI still labels it JSON), so read text and parse only if there is any.
  const text = await res.text()
  const isJson = !!text && !!res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? JSON.parse(text) : text || undefined
  if (!res.ok) throw new ApiError(res.status, isJson && data && 'detail' in data ? data.detail : data)
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: Body) => request<T>('POST', path, body),
  put: <T>(path: string, body?: Body) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: Body) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
