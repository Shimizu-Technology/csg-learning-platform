import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { IconButton } from '../ui/Button'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'md' | 'lg' | 'xl'
  fixedHeight?: boolean
}

const sizeMap = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export function Modal({ open, onClose, title, subtitle, icon, children, footer, size = 'lg', fixedHeight = false }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const subtitleId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

    const previousOverflow = document.body.style.overflow
    const handleEsc = (e: KeyboardEvent) => {
      const openDialogs = Array.from(document.querySelectorAll<HTMLElement>('[data-app-modal]'))
      if (openDialogs.at(-1) !== dialogRef.current) return

      if (e.key === 'Escape') onCloseRef.current()
      if (e.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector))
      if (focusable.length === 0) {
        e.preventDefault()
        dialogRef.current.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleEsc)
    document.body.style.overflow = 'hidden'

    const focusFrame = requestAnimationFrame(() => {
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(focusableSelector)
      ;(firstFocusable || dialogRef.current)?.focus()
    })

    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-950/60 p-0 backdrop-blur-sm sm:items-start sm:p-4 sm:pt-[8vh]"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <div
        ref={dialogRef}
        data-app-modal
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        className={`w-full ${sizeMap[size]} max-h-[92dvh] overflow-hidden rounded-t-3xl bg-white shadow-2xl shadow-slate-950/20 outline-none sm:max-h-[84dvh] sm:rounded-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            {icon}
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-bold tracking-tight text-slate-950">{title}</h2>
              {subtitle && <p id={subtitleId} className="mt-0.5 text-sm leading-5 text-slate-500">{subtitle}</p>}
            </div>
          </div>
          <IconButton label={`Close ${title}`} onClick={onClose} className="-mr-2 -mt-1 text-slate-400">
            <X className="h-5 w-5" />
          </IconButton>
        </div>

        <div className={`overflow-y-auto px-5 py-4 sm:px-6 ${fixedHeight ? 'h-[70dvh] flex flex-col sm:h-[64vh]' : 'max-h-[68dvh] sm:max-h-[60vh]'}`}>
          {children}
        </div>

        {footer && (
          <div className="border-t border-slate-200 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
