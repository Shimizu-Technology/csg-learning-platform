import { Eye, Settings2, Users } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { BulkEnrollment } from '../../components/admin/BulkEnrollment'
import { CohortEnrollment } from '../../components/admin/CohortEnrollment'
import { CohortHomePanel } from '../../components/admin/CohortHomePanel'
import { CohortScheduleManager } from '../../components/admin/CohortScheduleManager'
import { CohortSetupChecklist } from '../../components/admin/CohortSetupChecklist'
import { CohortTeachingTeam } from '../../components/admin/CohortTeachingTeam'
import { GithubSyncHealthPanel } from '../../components/admin/GithubSyncHealthPanel'
import { RecordingUploadManager } from '../../components/admin/RecordingUploadManager'
import { SetupWizard } from '../../components/admin/SetupWizard'
import { StaffActivityFeed } from '../../components/admin/StaffActivityFeed'
import { WorkspaceSectionMenu } from '../../components/admin/WorkspaceSectionMenu'
import { CohortStatusBadge } from '../../components/shared/CohortStatusBadge'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { NoAccess } from '../../components/shared/NoAccess'
import { RecordHeader } from '../../components/shared/RecordHeader'
import { RecordLink } from '../../components/shared/RecordLink'
import { RelatedPanel } from '../../components/shared/RelatedPanel'
import { Button, LinkButton } from '../../components/ui/Button'
import { PreviewLink as Link, ReturnOrigin } from '../../contexts/PreviewNavigationContext'
import { api } from '../../lib/api'
import { forwardReturnState } from '../../lib/navigationContext'
import { relatedRows } from '../../lib/recordRelated'
import { cohortPath, cohortSettingsPath, cohortStudentViewPath } from '../../lib/routes'
import { CohortSettings } from './CohortDetail'
import { Communication } from './cohortWorkspace/Communication'
import { Insights } from './cohortWorkspace/Insights'
import { Learning } from './cohortWorkspace/Learning'
import { Overview } from './cohortWorkspace/Overview'
import { Students } from './cohortWorkspace/Students'
import { DELIVERY_LABELS, useCohortWorkspace } from './cohortWorkspace/useCohortWorkspace'
import { StaffPrivateMeetings } from './PrivateMeetings'

export function CohortWorkspace() {
  const { id } = useParams<{ id: string }>()
  return <Workspace key={id} cohortId={Number(id)} />
}

function Workspace({ cohortId }: { cohortId: number }) {
  const workspace = useCohortWorkspace({ cohortId })
  const {
    searchParams,
    user,
    enabled,
    visibleTabs,
    activeTab,
    cohort,
    setCohort,
    home,
    homeLoading,
    homeError,
    retryHome,
    location,
    back,
    related,
    setLoadAttempt,
    loading,
    noAccess,
    error,
    insights,
    insightsLoading,
    insightsError,
    loadInsights,
    activeStudents,
  } = workspace
  if (noAccess) return <NoAccess />
  if (loading) return <LoadingSpinner message="Loading cohort…" />
  if (!cohort || error)
    return (
      <section role="alert">
        <EmptyState icon={Users} title="Could not open cohort" description={error || 'This cohort is unavailable.'} />
        {Number.isInteger(cohortId) && cohortId > 0 && (
          <Button onClick={() => setLoadAttempt((value) => value + 1)}>Retry cohort</Button>
        )}
      </section>
    )

  return (
    <ReturnOrigin label={cohort.name}>
      <div
        className={
          'app-page-wide space-y-6 max-lg:[&_input]:text-base ' +
          'max-lg:[&_select]:text-base max-lg:[&_textarea]:text-base'
        }
      >
        {!user?.is_admin && searchParams.get('settings_notice') === '1' && (
          <p role="status" className="rounded-xl border border-line p-4 text-sm text-ink-secondary">
            Cohort settings are managed by admins.
          </p>
        )}
        <RecordHeader
          back={back}
          breadcrumb={[{ label: 'Cohorts', to: '/admin/cohorts' }, { label: cohort.name }]}
          type={
            <>
              Cohort
              {cohort.course_delivery ? ` · ${DELIVERY_LABELS[cohort.course_delivery] || cohort.course_delivery}` : ''}
            </>
          }
          title={cohort.name}
          status={<CohortStatusBadge status={cohort.status} />}
          context={
            <>
              <RecordLink record={{ type: 'curriculum', id: cohort.curriculum_id }} variant="plain" touchTarget>
                {cohort.curriculum_name}
              </RecordLink>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {cohort.students.length} enrolled student{cohort.students.length === 1 ? '' : 's'}
              </span>
            </>
          }
          actions={
            <>
              <LinkButton
                size="sm"
                variant="secondary"
                to={cohortStudentViewPath(cohort.id, activeStudents[0]?.user_id)}
              >
                <Eye className="h-4 w-4" />
                View as student
              </LinkButton>
              {user?.is_admin && (
                <LinkButton size="sm" to={cohortSettingsPath(cohort.id)}>
                  <Settings2 className="h-4 w-4" />
                  Settings
                </LinkButton>
              )}
            </>
          }
        />

        <nav aria-label="Cohort sections" className="workspace-sections border-b border-line lg:overflow-x-auto">
          <WorkspaceSectionMenu
            label="Cohort sections"
            value={cohortPath(cohort.id, activeTab === 'insights' ? 'learning' : activeTab)}
            state={forwardReturnState(location.state)}
            sections={visibleTabs.map((tab) => ({ to: cohortPath(cohort.id, tab.id), label: tab.label }))}
          />
          <div className="hidden gap-1 lg:flex lg:min-w-max">
            {visibleTabs.map(({ id: tabId, label, icon: Icon }) => (
              <Link
                key={tabId}
                to={tabId === 'overview' ? cohortPath(cohort.id) : cohortPath(cohort.id, tabId)}
                state={forwardReturnState(location.state)}
                aria-current={
                  activeTab === tabId || (activeTab === 'insights' && tabId === 'learning') ? 'page' : undefined
                }
                className={
                  'inline-flex min-h-11 items-center justify-center gap-2 px-2 text-center text-sm ' +
                  'font-semibold transition-colors duration-150 sm:px-4 ' +
                  (activeTab === tabId || (activeTab === 'insights' && tabId === 'learning')
                    ? 'tab-selected'
                    : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink')
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            ))}
          </div>
        </nav>

        {activeTab === 'settings' && user?.is_admin && (
          <CohortSettings
            onSaved={async () => {
              const result = await api.getCohort(cohortId)
              if (result.data) setCohort(result.data.cohort)
            }}
          />
        )}
        {activeTab === 'overview' && user?.is_admin && (
          <div className="space-y-6">
            <CohortSetupChecklist cohort={cohort} />
            {cohort.course_delivery === 'self_paced' && (
              <SetupWizard
                cohort={cohort}
                onSaved={() => {
                  void api.getCohort(cohort.id).then((r) => {
                    if (r.data) setCohort(r.data.cohort)
                  })
                }}
              />
            )}
          </div>
        )}
        {activeTab === 'overview' && (cohort.features?.github_app === true || cohort.modules.some((mod) => mod.requires_github)) && (
          <GithubSyncHealthPanel cohortId={cohort.id} compact />
        )}
        {activeTab === 'overview' && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
            <div className="min-w-0">{home ? <CohortHomePanel home={home} /> : <Overview cohort={cohort} />}</div>
            <RelatedPanel
              rows={
                related.related
                  ? relatedRows(related.related, { viewer: user, returnTo: `${location.pathname}${location.search}` })
                  : []
              }
              loading={related.loading}
              error={related.error}
              onRetry={related.retry}
              returnLabel={cohort.name}
            />
          </div>
        )}
        {activeTab === 'students' && (
          <>
            {user?.is_admin && (
              <BulkEnrollment
                cohortId={cohort.id}
                seatLimit={cohort.seat_limit}
                seatsTaken={cohort.seats_taken}
                onSaved={() => {
                  void api.getCohort(cohort.id).then((r) => {
                    if (r.data) setCohort(r.data.cohort)
                  })
                }}
              />
            )}
            {user?.is_admin && (
              <CohortEnrollment
                cohortId={cohort.id}
                seatLimit={cohort.seat_limit}
                seatsTaken={cohort.seats_taken}
                onSaved={() =>
                  api.getCohort(cohort.id).then((result) => {
                    if (result.data) setCohort(result.data.cohort)
                  })
                }
              />
            )}
            <Students key={cohort.id} cohort={cohort} />
          </>
        )}
        {(activeTab === 'learning' || activeTab === 'insights') && (
          <nav aria-label="Learning sections" className="flex flex-wrap gap-2">
            <LinkButton
              variant={activeTab === 'learning' ? 'secondary' : 'quiet'}
              to={cohortPath(cohort.id, 'learning')}
            >
              Assigned learning
            </LinkButton>
            <LinkButton
              variant={activeTab === 'insights' ? 'secondary' : 'quiet'}
              to={cohortPath(cohort.id, 'insights')}
            >
              Learning insights
            </LinkButton>
          </nav>
        )}
        {activeTab === 'learning' && <Learning cohort={cohort} canConfigure={Boolean(user?.is_admin)} />}
        {activeTab === 'activity' && <StaffActivityFeed cohort={cohort} />}
        {activeTab === 'recordings' && (
          <section className="app-surface p-5 sm:p-6">
            <h2 className="mb-4 text-lg font-bold text-ink">Class recordings</h2>
            <RecordingUploadManager key={cohort.id} cohortId={cohort.id} editRecordingId={Number(searchParams.get('edit_recording')) || null} />
          </section>
        )}
        {activeTab === 'insights' && (
          <Insights
            cohort={cohort}
            insights={insights}
            loading={insightsLoading}
            error={insightsError}
            onRetry={() => void loadInsights()}
          />
        )}
        {activeTab === 'schedule' && (
          <div className="space-y-8">
            {enabled('office_hours') && (
              <CohortScheduleManager
                key={`schedule-${cohort.id}`}
                cohortId={cohort.id}
                canManage={Boolean(home?.permissions?.can_manage_schedule)}
                canManageLearningSchedule={Boolean(user?.is_admin && home?.permissions?.can_manage_learning_schedule)}
              />
            )}
            {enabled('private_meetings') && <StaffPrivateMeetings key={`meetings-${cohort.id}`} cohortId={cohort.id} />}
          </div>
        )}
        {activeTab === 'communication' && (
          <Communication
            cohort={cohort}
            home={home}
            loading={homeLoading}
            error={homeError}
            onRetry={retryHome}
            messages={enabled('class_channels')}
            announcements={enabled('announcements')}
          />
        )}
        {activeTab === 'team' && user?.is_admin && <CohortTeachingTeam cohortId={cohort.id} />}
      </div>
    </ReturnOrigin>
  )
}
