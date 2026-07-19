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
}

type ConfirmRequest = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmRequest | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null)

  const requestConfirm = useCallback<ConfirmRequest>((nextOptions) => {
    resolverRef.current?.(false)
    setOptions(nextOptions)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const finish = (confirmed: boolean) => {
    resolverRef.current?.(confirmed)
    resolverRef.current = null
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
            <Button variant={options?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => finish(true)}>{options?.confirmLabel || 'Continue'}</Button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-slate-600">This action only continues after you confirm it here.</p>
      </Modal>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error('useConfirm must be used within ConfirmProvider')
  return context
}
