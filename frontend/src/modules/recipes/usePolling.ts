import { useEffect } from 'react'

/** Call `fn` every `ms` while `active` is true (e.g. while an S3 upload is in progress). */
export function usePolling(fn: () => void, active: boolean, ms = 2000) {
  useEffect(() => {
    if (!active) return
    const t = setInterval(fn, ms)
    return () => clearInterval(t)
  }, [fn, active, ms])
}
