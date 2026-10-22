import { AlertTriangle } from 'lucide-react'
import { Button } from '../ui/Button'

export function LoadError({ error, stale = false, retry }: { error: string; stale?: boolean; retry: () => void }) {
  return <div role="alert" className="flex flex-wrap items-start gap-3 rounded-2xl border border-warning-200 bg-warning-50 p-4 text-warning-800">
    <AlertTriangle className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1"><p className="font-semibold">{stale ? 'Saved data may be out of date.' : 'Could not load this view.'}</p><p className="mt-1 break-words text-sm">{error}</p></div>
    <Button variant="secondary" onClick={retry}>Retry</Button>
  </div>
}
