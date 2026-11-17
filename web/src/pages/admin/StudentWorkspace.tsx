import { RefreshCw, UserRound } from 'lucide-react'
import { NavLink, useParams } from 'react-router-dom'
import { StudentAccess } from '../../components/admin/StudentAccess'
import { StudentCommunication } from '../../components/admin/StudentCommunication'
import { StudentLearningPlan } from '../../components/admin/StudentLearningPlan'
import { WorkspaceSectionSelect } from '../../components/admin/WorkspaceSectionSelect'
import { ActivityTimeline } from '../../components/shared/ActivityTimeline'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { NoAccess } from '../../components/shared/NoAccess'
import { RelatedPanel } from '../../components/shared/RelatedPanel'
import { Button } from '../../components/ui/Button'
import { ReturnOrigin } from '../../contexts/PreviewNavigationContext'
import { relatedRows } from '../../lib/recordRelated'
import { cohortStudentPath } from '../../lib/routes'
import { SectionBoundary } from '../../lib/useSection'
import { LearningTab } from './studentWorkspace/LearningTab'
import { OverviewTab } from './studentWorkspace/OverviewTab'
import { CountBadge } from './studentWorkspace/presentation'
import { StudentWorkspaceHeader } from './studentWorkspace/StudentWorkspaceHeader'
import { SupportTab } from './studentWorkspace/SupportTab'
import { tabs, useStudentWorkspace } from './studentWorkspace/useStudentWorkspace'
import { WorkTab } from './studentWorkspace/WorkTab'

export function StudentWorkspace() {
  const { cohortId, id } = useParams()
  return <Workspace key={`${cohortId}:${id}`} />
}

function Workspace() {
  const workspace = useStudentWorkspace()
  const {
    params,
    cohortId,
    studentId,
    activeTab,
    location,
    viewer,
    related,
    returnState,
    data,
    loading,
    noAccess,
    error,
    openingMessage,
    refreshError,
    refreshing,
    load,
    submissionsSection,
    helpSection,
    recordingsSection,
    videosSection,
    interventionsSection,
    recoverySection,
    refresh,
    openDirectMessage,
  } = workspace
  if (noAccess) return <NoAccess />
  if (loading) return <LoadingSpinner message="Loading student…" />
  if (!data || error) {
    return (
      <div className="app-page">
        <EmptyState
          icon={UserRound}
          title="Could not open this student page"
          description={error || 'The enrollment could not be found.'}
          action={
            <Button onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          }
        />
      </div>
    )
  }

  const { progress, cohort } = data
  // The API scopes history to this enrollment, including work retained after a curriculum change.
  const submissions = submissionsSection.data || []
  const helpRequests = helpSection.data || []
  const recordings = recordingsSection.data || []
  const lessonVideos = videosSection.data || []
  const interventions = interventionsSection.data || []
  const recoveryPlans = recoverySection.data || []
  const ungraded = progress.status?.ungraded_count
  const openHelp = progress.status?.help_request_count

  return (
    <ReturnOrigin label={progress.user.full_name}>
      <div className="app-page-wide space-y-6">
        {refreshError && (
          <div
            role="alert"
            className="app-surface flex flex-wrap items-center justify-between gap-3 border-warning-line p-4 text-sm text-warning-ink"
          >
            <p>{refreshError}</p>
            <Button
              variant="secondary"
              aria-label="Retry refreshing this page"
              disabled={refreshing}
              onClick={() => void load(false)}
            >
              {refreshing ? 'Refreshing…' : 'Retry'}
            </Button>
          </div>
        )}
        <StudentWorkspaceHeader workspace={{ ...workspace, progress, cohort }} />
        <nav aria-label="Student page sections" className="overflow-x-auto border-b border-line">
          <WorkspaceSectionSelect
            label="Student page sections"
            value={cohortStudentPath(cohortId, studentId, activeTab)}
            state={returnState}
            sections={tabs.map((tab) => {
              const counts =
                tab.id === 'work'
                  ? [ungraded]
                  : tab.id === 'support'
                    ? [openHelp, progress.status?.active_intervention_count]
                    : []
              const detail = counts.filter((count): count is number => count !== undefined && count > 0)
              return {
                to: cohortStudentPath(cohortId, studentId, tab.id),
                label: `${tab.label}${detail.length ? ` (${detail.join(', ')})` : ''}`,
              }
            })}
          />
          <div className="hidden min-w-max gap-1 lg:flex">
            {tabs.map(({ id, label, icon: Icon }) => (
              <NavLink
                key={id}
                to={cohortStudentPath(cohortId, studentId, id)}
                state={returnState}
                className={({ isActive }) =>
                  'inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold transition-colors ' +
                  'duration-150 ' +
                  (isActive || (activeTab === id && !params.tab)
                    ? 'tab-selected'
                    : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink')
                }
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
                {id === 'work' && ungraded !== undefined && ungraded > 0 && <CountBadge count={ungraded!} />}
                {id === 'support' && openHelp !== undefined && openHelp > 0 && (
                  <CountBadge count={openHelp!} tone="warning" />
                )}
                {id === 'support' && Boolean(progress.status?.active_intervention_count) && (
                  <CountBadge count={progress.status!.active_intervention_count} />
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        {activeTab === 'overview' && (
          <OverviewTab
            aside={
              <RelatedPanel
                rows={
                  related.related
                    ? relatedRows(related.related, {
                        viewer,
                        returnTo: `${location.pathname}${location.search}`,
                        actions: { message: () => void openDirectMessage() },
                      })
                    : []
                }
                loading={related.loading}
                error={related.error}
                onRetry={related.retry}
                returnLabel={progress.user.full_name}
              />
            }
            sections={{
              submissions: submissionsSection,
              help: helpSection,
              recordings: recordingsSection,
              videos: videosSection,
            }}
            progress={progress}
            submissions={submissions}
            helpRequests={helpRequests}
            cohortId={cohortId}
            studentId={studentId}
          />
        )}
        {activeTab === 'activity' && <ActivityTimeline userId={studentId} cohortId={cohortId} />}
        {activeTab === 'work' && (
          <SectionBoundary section={submissionsSection} label="Submissions">
            <WorkTab submissions={submissions} cohortId={cohortId} studentId={studentId} returnTo={location.pathname} />
          </SectionBoundary>
        )}
        {activeTab === 'learning' && (
          <>
            <StudentLearningPlan
              cohortId={cohortId}
              key={progress.enrollment.id}
              enrollmentId={progress.enrollment.id}
              onSaved={refresh}
            />
            <LearningTab
              recordingsSection={recordingsSection}
              videosSection={videosSection}
              recordings={recordings}
              lessonVideos={lessonVideos}
              progress={progress}
              cohortId={cohortId}
              studentId={studentId}
              returnTo={location.pathname}
            />
          </>
        )}
        {activeTab === 'support' && (
          <SupportTab
            sections={{ help: helpSection, interventions: interventionsSection, recovery: recoverySection }}
            requests={helpRequests}
            interventions={interventions}
            recoveryPlans={recoveryPlans}
            cohortId={cohortId}
            studentId={studentId}
            onSaved={(plan) =>
              recoverySection.update((plans) => plans.map((item) => (item.id === plan.id ? plan : item)))
            }
          />
        )}
        {activeTab === 'communication' && (
          <StudentCommunication
            cohortId={cohortId}
            studentId={studentId}
            studentName={progress.user.full_name}
            opening={openingMessage}
            onOpen={() => void openDirectMessage()}
          />
        )}
        {activeTab === 'access' && <StudentAccess progress={progress} cohort={cohort} onSaved={refresh} />}
      </div>
    </ReturnOrigin>
  )
}
