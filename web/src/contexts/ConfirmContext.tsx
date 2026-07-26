import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal } from '../components/shared/Modal'
import { Button } from '../components/ui/Button'

interface ConfirmOptions {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  confirmationText?: string
  confirmationLabel?: string
}

type ConfirmRequest = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmRequest | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const [confirmationValue, setConfirmationValue] = useState('')
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null)

  const requestConfirm = useCallback<ConfirmRequest>((nextOptions) => {
    resolverRef.current?.(false)
    setConfirmationValue('')
    setOptions(nextOptions)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const finish = (confirmed: boolean) => {
    resolverRef.current?.(confirmed)
    resolverRef.current = null
    setConfirmationValue('')
    setOptions(null)
  }

  return (
    <ConfirmContext.Provider value={requestConfirm}>
      {children}
      <Modal
        open={Boolean(options)}
        onClose={() => finish(false)}
        title={options?.title || 'Confirm action'}
        subtitle={options?.description}
        icon={<span className={`flex h-10 w-10 items-center justify-center rounded-xl ${options?.tone === 'danger' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}><AlertTriangle className="h-5 w-5" /></span>}
        size="md"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => finish(false)}>{options?.cancelLabel || 'Cancel'}</Button>
            <Button
              variant={options?.tone === 'danger' ? 'danger' : 'primary'}
              disabled={Boolean(options?.confirmationText) && confirmationValue.trim().toLowerCase() !== options?.confirmationText?.trim().toLowerCase()}
              onClick={() => finish(true)}
            >
              {options?.confirmLabel || 'Continue'}
            </Button>
          </div>
        }
      >
        {options?.confirmationText && (
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              {options.confirmationLabel || 'Type the confirmation text to continue'}
            </span>
            <input
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={confirmationValue}
              onChange={(event) => setConfirmationValue(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
            />
          </label>
        )}
      </Modal>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error('useConfirm must be used within ConfirmProvider')
  return context
}
