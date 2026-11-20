import { useEffect, useState } from 'react'

/** Load something once for a read-only view (e.g. a home-page summary). Errors become a message, not a throw. */
export function useLoad<T>(load: () => Promise<T>): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null })
  useEffect(() => {
    let live = true
    load()
      .then((data) => live && setState({ data, error: null }))
      .catch((e) => live && setState({ data: null, error: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, [])
  return state
}
