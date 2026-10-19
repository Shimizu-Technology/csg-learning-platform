import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { IconButton } from '../components/ui/Button'

type ToastType = 'success' | 'error'

interface Toast {
  id: number
  type: ToastType
  message: string
}

interface ToastContextValue {
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timeoutIds = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    const timeoutId = timeoutIds.current.get(id)
    if (timeoutId) window.clearTimeout(timeoutId)
    timeoutIds.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback((type: ToastType, message: string) => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, type, message }])
    timeoutIds.current.set(id, window.setTimeout(() => dismiss(id), 4500))
  }, [dismiss])

  useEffect(() => () => {
    timeoutIds.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    timeoutIds.current.clear()
  }, [])

  const value = useMemo<ToastContextValue>(() => ({
    success: (message: string) => show('success', message),
    error: (message: string) => show('error', message),
  }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3 sm:right-6 sm:top-6">
        {toasts.map((toast) => {
          const isSuccess = toast.type === 'success'
          const Icon = isSuccess ? CheckCircle2 : AlertCircle
          return (
            <div
              key={toast.id}
              className={`app-toast pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface-raised py-1.5 pl-4 pr-1.5 text-sm shadow-overlay ${
                isSuccess ? 'border-success-200 text-success-800' : 'border-danger-200 text-danger-800'
              }`}
              role={isSuccess ? 'status' : 'alert'}
            >
              <Icon className={`mt-3 h-4 w-4 shrink-0 ${isSuccess ? 'text-success-700' : 'text-danger-700'}`} aria-hidden="true" />
              <p className="min-w-0 flex-1 py-2.5 leading-5">{toast.message}</p>
              <IconButton label="Dismiss notification" size="sm" onClick={() => dismiss(toast.id)}>
                <X className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
