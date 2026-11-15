import { Circle } from 'lucide-react'
import type { PresenceStatus } from '../../lib/presence'

const PRESENCE_STYLES: Record<PresenceStatus, { label: string; badge: string; dot: string }> = {
  online: {
    label: 'Online',
    badge: 'bg-success-soft border-success-line text-success-ink',
    dot: 'fill-success-solid text-success-ink',
  },
  'recently-active': {
    label: 'Recently active',
    badge: 'bg-info-soft border-info-line text-info-ink',
    dot: 'fill-info-solid text-info-solid',
  },
  offline: {
    label: 'Offline',
    badge: 'bg-surface-sunken border-line text-ink-secondary',
    dot: 'fill-ink-disabled text-ink-muted',
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
