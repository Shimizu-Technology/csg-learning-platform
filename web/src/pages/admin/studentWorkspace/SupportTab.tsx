import { ArrowRight, ChevronRight, ClipboardCheck, LifeBuoy } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { RecoveryPlanActions } from '../../../components/admin/RecoveryPlanActions'
import { EmptyState } from '../../../components/shared/EmptyState'
import { Badge } from '../../../components/ui/Badge'
import { LinkButton } from '../../../components/ui/Button'
import { PreviewLink as Link } from '../../../contexts/PreviewNavigationContext'
import { followUpLabel } from '../../../lib/followUpLabels'
import { formatShortDateTime } from '../../../lib/format'
import { humanize, TERMS } from '../../../lib/glossary'
import { markdownExcerpt } from '../../../lib/plainText'
import { cohortStudentPath, helpRequestPath, interventionPath } from '../../../lib/routes'
import { SectionBoundary, type Section } from '../../../lib/useSection'
import type { HelpRequest, Intervention, RecoveryPlan } from '../../../types/api'

export function SupportTab({
  sections,
  requests,
  interventions,
  recoveryPlans,
  cohortId,
  studentId,
  onSaved,
}: {
  sections: { help: Section<HelpRequest[]>; interventions: Section<Intervention[]>; recovery: Section<RecoveryPlan[]> }
  requests: HelpRequest[]
  interventions: Intervention[]
  recoveryPlans: RecoveryPlan[]
  cohortId: number
  studentId: number
  onSaved: (plan: RecoveryPlan) => void
}) {
  const returnTo = cohortStudentPath(cohortId, studentId, 'support')
  const [params] = useSearchParams()
  const selectedPlan = Number(params.get('plan_id'))
  const plans = selectedPlan ? recoveryPlans.filter((plan) => plan.id === selectedPlan) : recoveryPlans
  if (
    Object.values(sections).every((section) => section.status === 'success') &&
    !selectedPlan &&
    !requests.length &&
    !interventions.length &&
    !recoveryPlans.length
  )
    return (
      <EmptyState
        icon={LifeBuoy}
        title="No support history"
        description="Help requests, follow-up plans and return plans for this student in this cohort will appear here."
        action={
          <LinkButton to={`/admin/support?cohort_id=${cohortId}`} variant="secondary">
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
            Open Support
          </LinkButton>
        }
      />
    )
  return (
    <div className="space-y-6">
      <SectionBoundary section={sections.interventions} label="Follow-up plans">
        <section className="app-surface overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-ink">{TERMS.followUpPlans}</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Owners, next steps, follow-ups, notes and outcomes. Only staff see these.
              </p>
            </div>
            <Link
              className="app-link inline-flex min-h-11 shrink-0 items-center text-sm"
              to={`/admin/support?cohort_id=${cohortId}`}
            >
              Open Support
            </Link>
          </div>
          {interventions.length ? (
            <div className="divide-y divide-line">
              {interventions.map((item) => (
                <Link
                  to={interventionPath(item.id, returnTo)}
                  key={item.id}
                  className={
                    'group pressable grid min-h-11 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_160px_auto] ' +
                    'sm:items-center sm:px-6 ' +
                    (item.follow_up_due ? 'bg-warning-soft hover:bg-warning-soft' : 'hover:bg-surface-sunken')
                  }
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink group-hover:underline">{followUpLabel(item.trigger_type)}</p>
                      <Badge>{followUpLabel(item.status)}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-secondary">
                      {item.action_summary || 'No next step yet.'}
                    </p>
                  </div>
                  <div>
                    {item.follow_up_due ? (
                      <Badge tone="warning">Follow-up due</Badge>
                    ) : (
                      <p className="text-xs font-semibold text-ink-muted">Next follow-up</p>
                    )}
                    <p className="mt-1 text-xs font-semibold tabular-nums text-ink-secondary">
                      {formatShortDateTime(item.next_follow_up_at)}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-muted group-hover:text-ink" aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-6 py-5 text-sm text-ink-muted">No follow-up plans for this student in this cohort.</p>
          )}
        </section>
      </SectionBoundary>
      <SectionBoundary section={sections.recovery} label="Return plans">
        {selectedPlan > 0 && !plans.length && (
          <p role="alert" className="app-surface p-5 text-sm text-danger-ink">
            This return plan isn't available for this student.
          </p>
        )}
        {plans.map((plan) => (
          <section
            key={plan.id}
            className={
              'rounded-2xl border p-5 shadow-raised sm:p-6 ' +
              (plan.check_in_due ? 'border-warning-line bg-warning-soft' : 'border-line bg-surface-raised')
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink-muted">{TERMS.returnPlan}</p>
                <h2 className="mt-1 text-lg font-bold text-ink">{plan.target_pace}</h2>
              </div>
              <Badge>{followUpLabel(plan.status)}</Badge>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-ink-muted">Required work</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{plan.required_scope}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-ink-muted">Next follow-up</p>
                <p
                  className={`mt-1 text-sm font-semibold tabular-nums ${plan.check_in_due ? 'text-warning-ink' : 'text-ink-secondary'}`}
                >
                  {plan.check_in_due ? 'Due now · ' : ''}
                  {formatShortDateTime(plan.next_check_in_at)}
                </p>
                <p className="mt-1 text-xs text-ink-muted">Owner: {plan.owner.full_name}</p>
              </div>
            </div>
            {plan.intervention_id && (
              <Link
                to={interventionPath(plan.intervention_id, returnTo)}
                className="app-link mt-4 inline-flex min-h-11 items-center gap-1 text-sm"
              >
                Open follow-up plan <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
            <RecoveryPlanActions plan={plan} onSaved={onSaved} />
          </section>
        ))}
      </SectionBoundary>
      <SectionBoundary section={sections.help} label="Help requests">
        <section className="app-surface overflow-hidden">
          <div className="border-b border-line px-5 py-4 sm:px-6">
            <h2 className="text-lg font-bold text-ink">Help requests</h2>
          </div>
          {requests.length ? (
            <div className="divide-y divide-line">
              {requests.map((request) => (
                <Link
                  to={helpRequestPath(request.id, returnTo)}
                  key={request.id}
                  className="group pressable grid min-h-11 gap-4 px-5 py-4 hover:bg-surface-sunken sm:grid-cols-[minmax(0,1fr)_auto] sm:px-6"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink [overflow-wrap:anywhere] group-hover:underline">
                        {request.context_label}
                      </p>
                      <Badge tone={request.urgency === 'urgent' ? 'danger' : 'neutral'}>
                        {humanize(request.urgency)}
                      </Badge>
                      <Badge
                        tone={
                          request.status === 'resolved' ? 'success' : request.status === 'open' ? 'pending' : 'neutral'
                        }
                      >
                        {humanize(request.status)}
                      </Badge>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">
                      {request.message}
                    </p>
                    {request.staff_response && (
                      <div className="mt-3 rounded-xl border border-success-line bg-success-soft p-3 text-sm text-success-ink">
                        <span className="font-semibold">Staff response:</span>{' '}
                        {markdownExcerpt(request.staff_response, 280)}
                      </div>
                    )}
                  </div>
                  <div className="text-xs font-semibold tabular-nums text-ink-muted">
                    {formatShortDateTime(request.created_at)}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-6 py-5 text-sm text-ink-muted">No help requests.</p>
          )}
        </section>
      </SectionBoundary>
    </div>
  )
}
