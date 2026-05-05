import { Circle } from 'lucide-react'
import type { PresenceStatus } from '../../lib/presence'

const PRESENCE_STYLES: Record<PresenceStatus, { label: string; badge: string; dot: string }> = {
  online: {
    label: 'Online',
    badge: 'bg-green-50 border-green-200 text-green-700',
    dot: 'fill-green-500 text-green-500',
  },
  'recently-active': {
    label: 'Recently active',
    badge: 'bg-blue-50 border-blue-200 text-blue-700',
    dot: 'fill-blue-400 text-blue-400',
  },
  offline: {
    label: 'Offline',
    badge: 'bg-slate-50 border-slate-200 text-slate-500',
    dot: 'fill-slate-300 text-slate-300',
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
      <PresenceDot status={status} />
      {style.label}
    </span>
  )
}
