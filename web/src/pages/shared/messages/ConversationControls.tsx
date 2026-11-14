import {
BellOff
} from 'lucide-react'
import { type ReactNode } from 'react'
import { Button } from '../../../components/ui/Button'
import { CountBadge,RowButton } from '../../../components/ui/RowButton'
import { personContext } from '../../../lib/person-context'
import type {
UserSummary
} from '../../../types/api'
import { formatInboxTime } from './helpers'

export function ConversationButton({
  active,
  icon,
  title,
  subtitle,
  latestAt,
  unread,
  muted,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  title: string
  subtitle: string
  latestAt?: string
  unread: number
  muted: boolean
  onClick: () => void
}) {
  return (
    <RowButton
      onClick={onClick}
      selected={active}
      aria-current={active ? 'true' : undefined}
      className="mb-1 block w-full overflow-hidden rounded-xl px-2.5 py-1.5 sm:rounded-2xl sm:px-3 sm:py-2"
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className={`flex min-w-0 flex-1 items-center gap-2 ${unread > 0 || active ? 'text-ink' : 'text-ink-secondary'}`}>
          {icon}
          <span className="truncate text-sm font-semibold">{title}</span>
          {muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-label="Muted" />}
        </span>
        {latestAt && <time dateTime={latestAt} className={`shrink-0 text-xs tabular-nums ${unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink-muted'}`}>{formatInboxTime(latestAt)}</time>}
        <CountBadge count={unread} label="unread" />
      </span>
      <span className={`mt-1 block truncate text-xs ${unread > 0 ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{subtitle}</span>
    </RowButton>
  )
}

export function ConversationHeaderAction({
  onClick,
  icon,
  shortLabel,
  fullLabel,
  ariaLabel,
  title,
}: {
  onClick: () => void
  icon: ReactNode
  shortLabel: string
  fullLabel: string
  ariaLabel: string
  /** Tooltip; distinguishes look-alike icon buttons on narrow screens. */
  title?: string
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      className="h-11 w-11 sm:h-auto sm:w-auto"
      aria-label={ariaLabel}
      title={title ?? fullLabel}
    >
      {icon}
      <span className="sr-only">{shortLabel}</span>
      <span className="hidden sm:inline">{fullLabel}</span>
    </Button>
  )
}

export function recipientLabel(person: UserSummary, people: UserSummary[], workspace = '') {
  return `${person.full_name} (${personContext(person, people, workspace)})`
}

export function WorkspaceMemberIdentity({ member, isStaff }: { member: { full_name: string; email?: string }; isStaff: boolean }) {
  return <><p className="truncate text-sm font-medium text-slate-900">{member.full_name}</p>{isStaff && member.email && <p className="truncate text-xs text-slate-500">{member.email}</p>}</>
}
