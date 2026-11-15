import { BellOff } from 'lucide-react';
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { isPlainLeftClick } from '../../../lib/links';
import { CountBadge } from '../../../components/ui/RowButton';
import { personContext } from '../../../lib/person-context';
import type { UserSummary } from '../../../types/api';
import { conversationPath, formatInboxTime } from './helpers';
import { type Target } from './types';

/**
 * One conversation in the inbox. It's a real link to the conversation, so
 * ⌘-click and middle-click open it in a new tab (L-2.8); a plain click opens it
 * in place through the page's own navigation, which keeps drafts and scroll.
 */
export function ConversationLink({
  target,
  active,
  icon,
  title,
  subtitle,
  latestAt,
  unread,
  muted,
  onSelect,
}: {
  target: Target
  active: boolean
  icon: ReactNode
  title: string
  subtitle: string
  latestAt?: string
  unread: number
  muted: boolean
  onSelect: () => void
}) {
  return (
    <Link
      to={conversationPath(target)}
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return
        event.preventDefault()
        onSelect()
      }}
      aria-current={active ? 'page' : undefined}
      aria-label={unread > 0 ? `${title}, ${unread} unread` : undefined}
      data-selected={active ? 'true' : undefined}
      className={`pressable mb-0.5 block min-h-14 w-full overflow-hidden rounded-xl px-2.5 py-2 ${active ? 'nav-selected' : 'hover:bg-surface-sunken'}`}
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className={`flex min-w-0 flex-1 items-center gap-2 ${unread > 0 || active ? 'text-ink' : 'text-ink-secondary'}`}>
          {icon}
          <span className="truncate text-sm font-semibold">{title}</span>
          {muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-label="Muted" />}
        </span>
        {latestAt && <time dateTime={latestAt} className={`shrink-0 text-xs tabular-nums ${unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink-muted'}`}>{formatInboxTime(latestAt)}</time>}
        <CountBadge count={unread} />
      </span>
      <span className={`mt-0.5 block truncate text-xs ${unread > 0 ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{subtitle}</span>
    </Link>
  )
}

export function recipientLabel(person: UserSummary, people: UserSummary[], workspace = '') {
  return `${person.full_name} (${personContext(person, people, workspace)})`
}

export function WorkspaceMemberIdentity({ member, isStaff }: { member: { full_name: string; email?: string }; isStaff: boolean }) {
  return <><p className="truncate text-sm font-medium text-ink">{member.full_name}</p>{isStaff && member.email && <p className="truncate text-xs text-ink-muted">{member.email}</p>}</>
}
