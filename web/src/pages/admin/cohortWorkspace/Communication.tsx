import { ArrowRight, MessageSquareText } from 'lucide-react'
import { CohortChannels } from '../../../components/admin/CohortChannels'
import { ReleaseCommunicationsPanel } from '../../../components/admin/ReleaseCommunicationsPanel'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Button, LinkButton } from '../../../components/ui/Button'
import { PreviewLink as Link } from '../../../contexts/PreviewNavigationContext'
import type { CohortDetail, CohortHome } from '../../../types/api'

export function Communication({
  cohort,
  home,
  loading,
  error,
  onRetry,
  messages,
  announcements,
}: {
  cohort: CohortDetail
  home: CohortHome | null
  loading: boolean
  error: string | null
  onRetry: () => void
  messages: boolean
  announcements: boolean
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {messages && (
        <section className="app-surface p-5 sm:p-6">
          <p className="text-xs font-semibold text-ink-muted">Conversation</p>
          <h2 className="mt-2 text-lg font-bold text-ink">Class messages</h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">Open this cohort’s class chat and conversations.</p>
          <CohortChannels cohortId={cohort.id} cohortName={cohort.name} />
          <LinkButton
            to={`/messages?workspace_id=${home?.cohort.workspace_id || ''}&cohort_id=${cohort.id}`}
            className="mt-5"
          >
            <MessageSquareText className="h-4 w-4" />
            Open messages
          </LinkButton>
        </section>
      )}
      {announcements && (
        <section className="app-surface p-5 sm:p-6">
          <p className="text-xs font-semibold text-ink-muted">Updates</p>
          <h2 className="mt-2 text-lg font-bold text-ink">Updates for this cohort</h2>
          <div className="mt-4 space-y-2">
            {loading ? (
              <p role="status" className="text-sm text-ink-muted">
                Loading cohort updates…
              </p>
            ) : error || !home ? (
              <div role="alert" className="space-y-2 text-sm text-ink-secondary">
                <p>{error || 'Could not load cohort updates.'}</p>
                <Button variant="secondary" onClick={onRetry}>
                  Retry updates
                </Button>
              </div>
            ) : home.recent_announcements.length ? (
              home.recent_announcements.map((announcement) => (
                <RecordLink
                  key={announcement.id}
                  record={{ type: 'announcement', id: announcement.id, cohortId: cohort.id }}
                  returnLabel={cohort.name}
                  variant="unstyled"
                  className={
                    'pressable block min-h-11 truncate rounded-xl border border-line p-3 text-sm ' +
                    'font-semibold text-ink hover:border-line-strong hover:bg-surface-sunken'
                  }
                  title={announcement.title}
                >
                  {announcement.title}
                </RecordLink>
              ))
            ) : (
              <p className="text-sm text-ink-muted">No updates for this cohort yet.</p>
            )}
          </div>
          <Link
            to={`/announcements?scope=manage&audience=cohort&cohort_id=${cohort.id}`}
            className="app-link mt-4 inline-flex min-h-11 items-center gap-2 text-sm"
          >
            Manage updates <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      )}
      <div className="min-w-0 lg:col-span-2">
        <ReleaseCommunicationsPanel cohortId={cohort.id} />
      </div>
    </div>
  )
}
