/**
 * Shared "Are you sure?" dialog. Every delete, rename and overwrite goes through it:
 *
 *   const confirm = useConfirm()
 *   if (await confirm({ title: 'Delete Basil?', message: '…', confirmLabel: 'Delete', danger: true })) …
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type Confirm = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)

  const confirm = useCallback<Confirm>(
    (opts) => new Promise((resolve) => setPending({ ...opts, resolve })),
    [],
  )

  const close = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmModal opts={pending} onClose={close} />}
    </ConfirmContext.Provider>
  )
}

function ConfirmModal({ opts, onClose }: { opts: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus() // safe default: Enter cancels
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={() => onClose(false)}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{opts.title}</h2>
        {opts.message && <div className="modal-body">{opts.message}</div>}
        <div className="modal-actions">
          <button ref={cancelRef} onClick={() => onClose(false)}>
            {opts.cancelLabel ?? 'Cancel'}
          </button>
          <button className={opts.danger ? 'btn-danger' : 'btn-primary'} onClick={() => onClose(true)}>
            {opts.confirmLabel ?? 'Yes'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function useConfirm(): Confirm {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx
}
