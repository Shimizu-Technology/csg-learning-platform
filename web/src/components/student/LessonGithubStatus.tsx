import { ExternalLink } from 'lucide-react'
import type { LessonDetail } from '../../types/api'
import { formatShortDateTime } from '../../lib/format'
import { LinkButton } from '../ui/Button'

export function LessonGithubStatus({ lesson, unavailable }: { lesson: LessonDetail; unavailable: boolean }) {
  const status = lesson.github_repository_status
  if (!status) return null

  const scope = status.scope === 'module' ? 'for this module' : 'for this course'
  const name = status.full_name
  // Build the URL from a verified owner/name. Exclude dot segments as well.
  const href = status.state === 'verified' && name &&
    /^[a-z\d][a-z\d-]{0,38}\/(?!\.{1,2}$)[a-z\d_.-]{1,100}$/i.test(name)
    ? `https://github.com/${name}` : null

  return <section aria-label="GitHub submission status" className="app-surface space-y-2 p-4 sm:p-5">
    <h2 className="font-semibold text-ink">GitHub submission status</h2>
    {unavailable ? <p className="text-sm text-ink-secondary">Current GitHub status is unavailable. Reconnect and reload the lesson to check your repository and saved work.</p>
      : href ? <>
        <p className="text-sm text-ink-secondary">Repository verified {scope}.</p>
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center gap-2 font-semibold text-ink underline">
          <span className="[overflow-wrap:anywhere]">{name}</span><ExternalLink className="size-4 shrink-0" aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        {status.revisions?.length ? <ul className="space-y-2 text-sm text-ink-secondary">
          {status.revisions.map(revision => {
            const block = lesson.content_blocks.find(item => item.id === revision.block_id)
            return <li key={revision.block_id} className="[overflow-wrap:anywhere]">
              <strong className="text-ink">{block?.filename || block?.title || 'Exercise'}</strong>
              {' · Last synced '}<time dateTime={revision.captured_at}>{formatShortDateTime(revision.captured_at)}</time>
              {' · '}<code>{revision.short_sha}</code>
            </li>
          })}
        </ul> : <p className="text-sm text-ink-secondary">No saved version from this repository yet. Push your work to GitHub. It will appear here after Learn syncs it.</p>}
      </> : <>
        <p className="text-sm text-ink-secondary">{status.state === 'needs_repository'
          ? 'Choose a repository for this lesson before Learn can sync your work.'
          : `Verify your repository ${scope} before Learn can sync your work.`}</p>
        <LinkButton variant="quiet" to={`/profile#github-repository-${lesson.cohort_id}`}>Set up GitHub in Profile</LinkButton>
      </>}
  </section>
}
