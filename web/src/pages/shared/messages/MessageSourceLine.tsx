import { Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { staffMessageSourcePath } from '../../../lib/routes';
import type { MessageSourceSummary } from '../../../types/api';

const chipClass = 'inline-flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-line bg-surface-raised px-3 py-1.5 text-xs text-ink-secondary'

/**
 * "About Make Decisions with JavaScript · your submission" above a message a
 * staff member sent from a record (L-1.8). Learners get their own view of the
 * lesson or submission; staff get the staff record. When the viewer has
 * somewhere to go the whole chip is the link (44px tall on touch screens,
 * compact on desktop); otherwise it's plain text, never a dead link. A lesson
 * the learner can't open yet arrives untitled and unlinked ("About a lesson").
 */
export function MessageSourceLine({ source, staff }: { source: MessageSourceSummary; staff: boolean }) {
  const path = staff
    ? source.id === null ? null : staffMessageSourcePath({ ...source, id: source.id })
    : source.learner_path
  const kind = source.type === 'submission'
    ? staff ? `Submission #${source.id}` : 'your submission'
    : source.type === 'help_request'
      ? staff ? `Help request #${source.id}` : 'your help request'
      : null
  const title = source.title || (source.type === 'lesson' ? 'a lesson' : 'this record')
  const content = (
    <>
      <Link2 className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        About{' '}
        <span className={path ? 'font-semibold text-ink underline decoration-line-strong underline-offset-2 transition-colors group-hover:decoration-current' : 'font-semibold text-ink'}>{title}</span>
        {kind && <> · {kind}</>}
      </span>
    </>
  )

  return (
    <div data-message-source="" className="ml-12 mt-2 flex max-w-[calc(100%-3rem)] sm:ml-14 sm:max-w-[calc(100%-3.5rem)]">
      {path
        ? (
          <Link
            to={path}
            className={`group ${chipClass} min-h-11 transition-colors hover:border-line-strong hover:text-ink sm:min-h-0`}
          >
            {content}
          </Link>
        )
        : <p className={chipClass}>{content}</p>}
    </div>
  )
}
