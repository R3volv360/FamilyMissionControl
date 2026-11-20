/** Small transient notifications: const toast = useToast(); toast('Saved'); toast('Upload failed', 'error') */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type Kind = 'info' | 'success' | 'error'
type ToastFn = (message: string, kind?: Kind) => void

const ToastContext = createContext<ToastFn | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: Kind }[]>([])

  const toast = useCallback<ToastFn>((message, kind = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000)
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
