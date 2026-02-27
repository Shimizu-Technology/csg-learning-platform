import { Loader2 } from 'lucide-react'

interface LoadingSpinnerProps {
  message?: string
  fullScreen?: boolean
}

export function LoadingSpinner({ message, fullScreen = true }: LoadingSpinnerProps) {
  const content = (
    <div className="flex flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      {message && <p className="text-sm text-slate-500">{message}</p>}
    </div>
  )

  if (fullScreen) {
    return <div className="flex min-h-screen items-center justify-center">{content}</div>
  }

  return <div className="flex items-center justify-center py-12">{content}</div>
}
