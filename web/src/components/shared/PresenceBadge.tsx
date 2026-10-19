import { Circle } from 'lucide-react'
import type { PresenceStatus } from '../../lib/presence'

const PRESENCE_STYLES: Record<PresenceStatus, { label: string; badge: string; dot: string }> = {
  online: {
    label: 'Online',
    badge: 'bg-success-50 border-success-200 text-success-700',
    dot: 'fill-success-600 text-success-600',
  },
  'recently-active': {
    label: 'Recently active',
    badge: 'bg-info-50 border-info-200 text-info-800',
    dot: 'fill-blue-400 text-blue-400',
  },
  offline: {
    label: 'Offline',
    badge: 'bg-slate-50 border-slate-200 text-ink-secondary',
    dot: 'fill-slate-400 text-slate-400',
  },
}

export function presenceLabel(status: PresenceStatus): string {
  return PRESENCE_STYLES[status].label
}

export function presenceDotClassName(status: PresenceStatus): string {
  return PRESENCE_STYLES[status].dot
}

export function PresenceDot({ status, className = 'h-2.5 w-2.5' }: { status: PresenceStatus; className?: string }) {
  return <Circle className={`${className} ${presenceDotClassName(status)}`} />
}

export function PresenceBadge({ status, className = '' }: { status: PresenceStatus; className?: string }) {
  const style = PRESENCE_STYLES[status]

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${style.badge} ${className}`}>
      <PresenceDot status={status} className="h-2.5 w-2.5 shrink-0" />
      {style.label}
    </span>
  )
}
