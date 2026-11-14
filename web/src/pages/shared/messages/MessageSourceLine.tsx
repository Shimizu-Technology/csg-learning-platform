import { Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { staffMessageSourcePath } from '../../../lib/routes';
import type { MessageSourceSummary } from '../../../types/api';

/**
 * "About Make Decisions with JavaScript · your submission" above a message a
 * staff member sent from a record (L-1.8). Learners get their own view of the
 * lesson or submission; staff get the staff record. The title is plain text
 * when the viewer has nowhere to go, never a dead link.
 */
export function MessageSourceLine({ source, staff }: { source: MessageSourceSummary; staff: boolean }) {
  const path = staff ? staffMessageSourcePath(source) : source.learner_path
  const kind = source.type === 'submission'
    ? staff ? `Submission #${source.id}` : 'your submission'
    : source.type === 'help_request'
      ? staff ? `Help request #${source.id}` : 'your help request'
      : null
  const title = source.title || (source.type === 'lesson' ? 'a lesson' : 'this record')

  return (
    <div data-message-source="" className="ml-12 mt-2 flex max-w-[calc(100%-3rem)] sm:ml-14 sm:max-w-[calc(100%-3.5rem)]">
      <p className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-line bg-surface-raised px-3 py-1.5 text-xs text-ink-secondary">
        <Link2 className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          About{' '}
          {path
            ? <Link to={path} className="font-semibold text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:decoration-current">{title}</Link>
            : <span className="font-semibold text-ink">{title}</span>}
          {kind && <> · {kind}</>}
        </span>
      </p>
    </div>
  )
}
