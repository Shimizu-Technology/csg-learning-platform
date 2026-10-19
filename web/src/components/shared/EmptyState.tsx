import { Inbox } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-4 rounded-2xl bg-surface-sunken p-4">
        <Icon className="h-8 w-8 text-ink-muted" aria-hidden="true" />
      </div>
      <h3 className="max-w-md text-lg font-semibold text-ink [overflow-wrap:anywhere]">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-secondary">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  )
}
