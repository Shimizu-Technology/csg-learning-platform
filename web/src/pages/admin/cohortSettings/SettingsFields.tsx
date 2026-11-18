import { Github } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CourseOfferingSettings } from '../../../components/admin/CourseOfferingSettings'
import { FeatureSettings } from '../../../components/admin/FeatureSettings'
import { SegmentButton, SegmentedControl } from '../../../components/ui/Choice'
import { cohortPath } from '../../../lib/routes'
import { schoolTimeDescription } from '../../../lib/schoolTime'
import { COHORT_STATUS_OPTIONS, DEFAULT_PACE_WEEKS } from './settingsForm'
import type { CohortSettingsController } from './useCohortSettings'

export function SettingsFields({ settings }: { settings: CohortSettingsController }) {
  const {
    user,
    setOfferingDraft,
    cohort,
    saving,
    setReviewResponseDraft,
    savedReviewResponse,
    setFeatureDraft,
    savedRevision,
    editCourseDelivery,
    setEditCourseDelivery,
    editAccessEnd,
    setEditAccessEnd,
    editSupportEnd,
    setEditSupportEnd,
    editPaceWeeks,
    setEditPaceWeeks,
    editPaceEnabled,
    setEditPaceEnabled,
    editStartDate,
    setEditStartDate,
    editGithubOrganization,
    setEditGithubOrganization,
    editStatus,
    chooseStatus,
  } = settings
  return (
    <>
      <div className="app-surface space-y-4 p-5">
        <Link to={cohortPath(cohort.id)} className="app-link inline-flex min-h-11 items-center">
          Back to {cohort.name}
        </Link>
        <h2 className="text-lg font-bold">Cohort settings</h2>
        <div id="cohort-status">
          <SegmentedControl label="Cohort status" className="max-sm:flex max-sm:flex-col">
            {COHORT_STATUS_OPTIONS.map((option) => (
              <SegmentButton
                key={option.value}
                disabled={
                  option.value === 'upcoming' &&
                  editStartDate <= new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Guam' }).format(new Date())
                }
                selected={editStatus === option.value}
                onClick={() => void chooseStatus(option.value)}
                className={option.value === 'archived' ? 'text-danger-ink' : undefined}
              >
                {option.value === 'upcoming' &&
                editStartDate <= new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Guam' }).format(new Date())
                  ? 'Upcoming (move start date)'
                  : option.label}
              </SegmentButton>
            ))}
          </SegmentedControl>
          <p className="mt-2 text-sm text-ink-secondary">
            {COHORT_STATUS_OPTIONS.find((option) => option.value === editStatus)?.description}
          </p>
        </div>
        <label className="block text-sm font-semibold">
          Cohort start date
          <input
            aria-label="Cohort start date"
            type="date"
            className="app-control mt-1 block"
            value={editStartDate}
            onChange={(e) => setEditStartDate(e.target.value)}
          />
        </label>
        {user?.role === 'admin' && (
          <FeatureSettings
            key={`features-${cohort.id}-${savedRevision}`}
            cohortId={cohort.id}
            onDraftChange={setFeatureDraft}
            onReviewResponseDraftChange={setReviewResponseDraft}
            savedReviewResponse={savedReviewResponse}
          />
        )}
        {user?.role === 'admin' && cohort.course_delivery === 'self_paced' && (
          <CourseOfferingSettings
            key={`${cohort.id}-${savedRevision}`}
            cohort={cohort}
            onSaved={async () => {}}
            onDraftChange={setOfferingDraft}
          />
        )}
        {cohort.course_delivery !== 'self_paced' && (
          <section className="mt-4 border-t border-line pt-4" aria-labelledby="course-access-heading">
            <h2 id="course-access-heading" className="text-base font-semibold text-ink">
              Course access for new enrollments
            </h2>
            <p className="mt-1 text-xs text-ink-secondary">
              Dates include the entire selected day in {schoolTimeDescription().replace(' time', '')}. Saving defaults
              does not change existing enrollments. Leave dates blank for ongoing access; the full program currently has
              indefinite lesson access.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold text-ink-secondary">
                Delivery
                <select
                  value={editCourseDelivery}
                  onChange={(e) => setEditCourseDelivery(e.target.value as 'program' | 'guided')}
                  disabled={saving}
                  className="app-control mt-1 w-full"
                >
                  <option value="program">Live program</option>
                  <option value="guided">Focused course with meetings</option>
                  <option value="self_paced">Self-paced</option>
                </select>
              </label>
              {editCourseDelivery === 'guided' && (
                <>
                  <label className="text-xs font-semibold text-ink-secondary">
                    Lessons available through
                    <input
                      type="date"
                      value={editAccessEnd}
                      onChange={(e) => setEditAccessEnd(e.target.value)}
                      disabled={saving}
                      className="app-control mt-1 w-full"
                    />
                  </label>
                  <label className="text-xs font-semibold text-ink-secondary">
                    Help period ends
                    <input
                      type="date"
                      value={editSupportEnd}
                      onChange={(e) => setEditSupportEnd(e.target.value)}
                      disabled={saving}
                      className="app-control mt-1 w-full"
                    />
                  </label>
                </>
              )}
            </div>
          </section>
        )}
        {editCourseDelivery !== 'program' && cohort.cohort_type !== 'alumni' && (
          <section className="mt-4 border-t border-line pt-4" aria-labelledby="learner-pace-heading">
            <h2 id="learner-pace-heading" className="text-base font-semibold text-ink">
              Learner-chosen pace
            </h2>
            <p className="mt-1 text-xs text-ink-secondary">
              Each learner gets their own start date (the cohort start, or the day they first open the course if
              later). {editCourseDelivery === 'guided' ? 'Every lesson opens on that date instead of the class calendar. ' : ''}
              Learners pick a pace, which sets a soft target each week and one firm final-project date. Uses learning
              plans, so the Learning plans feature must stay on.
            </p>
            <label className="mt-3 flex min-h-11 items-center gap-3 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={editPaceEnabled}
                onChange={(e) => {
                  setEditPaceEnabled(e.target.checked)
                  if (e.target.checked && !editPaceWeeks.trim()) setEditPaceWeeks(DEFAULT_PACE_WEEKS)
                }}
                disabled={saving}
                className="h-5 w-5"
              />
              Let learners choose their pace
            </label>
            {editPaceEnabled && (
              <label className="mt-2 block max-w-xs text-xs font-semibold text-ink-secondary">
                Pace choices, in weeks
                <input
                  type="text"
                  inputMode="numeric"
                  value={editPaceWeeks}
                  onChange={(e) => setEditPaceWeeks(e.target.value)}
                  disabled={saving}
                  aria-describedby="learner-pace-help"
                  className="app-control mt-1 w-full"
                />
                <span id="learner-pace-help" className="mt-1 block font-normal text-ink-muted">
                  Up to four choices from 1 to 26, separated by commas.
                </span>
              </label>
            )}
          </section>
        )}
        <div className="mt-4 border-t border-line pt-4">
          <label
            htmlFor="cohort-github-organization"
            className="flex items-center gap-1.5 text-base font-semibold text-ink"
          >
            <Github className="h-4 w-4" /> GitHub organization
          </label>
          <p className="mt-1 text-xs text-ink-secondary">
            Used to check student membership and invitations. Add the organization name from its GitHub URL; resource
            links are managed separately.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="cohort-github-organization"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={editGithubOrganization}
              onChange={(e) => setEditGithubOrganization(e.target.value)}
              disabled={saving}
              placeholder="e.g. Code-School-of-Guam-Alumni"
              className="app-control w-full max-w-md"
            />
          </div>
        </div>
      </div>
    </>
  )
}
