import { CalendarClock, ClipboardCheck, History, Layers3, MessageSquareText, PencilLine, RotateCcw, UserRound, UserRoundCheck } from 'lucide-react'
import { ReturnOrigin } from '../../../contexts/PreviewNavigationContext'
import { RecordHeader } from '../../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../../components/shared/RelatedPanel'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { LinkButton } from '../../../components/ui/Button'
import { useBackLink } from '../../../lib/recordOrigin'
import { useRecordDetail } from '../../../lib/recordDetail'
import { cohortPath, cohortStudentPath, interventionPath } from '../../../lib/routes'
import { formatShortDate, formatShortDateTime } from '../../../lib/format'
import { FOLLOW_UP_STATUS_LABELS } from '../../../lib/followUpLabels'
import { humanize, TERMS } from '../../../lib/glossary'
import type { RelatedRow } from '../../../lib/recordRelated'
import type { RecoveryPlanDetail } from '../../../types/api'
import { DetailGate, EmptyRow, Facts, RecordLayout, Section, useRouteId } from './RecordParts'

const STATUS: Record<RecoveryPlanDetail['status'], { label: string; tone: BadgeTone }> = {
  active: { label: 'Active', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  canceled: { label: 'Canceled', tone: 'neutral' },
}
const SOURCES: Record<RecoveryPlanDetail['source'], string> = { restart: 'After a restart', extended_absence: 'After time away', manual: 'Started by staff' }

/**
 * A return plan's staff page (L-5.2; stored as a recovery plan): who owns it,
 * the pace and scope agreed, check-ins, and where it came from. Editing and new
 * check-ins stay on the student page's Support tab, where the plan's actions are.
 */
export function RecoveryPlanRecord() {
  const state = useRecordDetail('recovery_plan', useRouteId())
  return <DetailGate state={state} label={TERMS.returnPlan.toLowerCase()} icon={ClipboardCheck} fallback={{ returnTo: '/admin/support', returnLabel: 'Support' }}>{(detail) => <PlanPage key={detail.id} detail={detail} />}</DetailGate>
}

function PlanPage({ detail }: { detail: RecoveryPlanDetail }) {
  const { cohort, student } = detail
  const support = `${cohortStudentPath(cohort.id, student.id, 'support')}?plan_id=${detail.id}`
  const back = useBackLink({ returnTo: support, returnLabel: `${student.name} · Support` })
  const status = STATUS[detail.status] ?? { label: humanize(detail.status), tone: 'neutral' as BadgeTone }
  const label = `${TERMS.returnPlan} · ${student.name}`
  const rows: RelatedRow[] = [
    { key: 'student', icon: UserRound, label: 'Student page', value: student.name, to: cohortStudentPath(cohort.id, student.id) },
    { key: 'cohort', icon: Layers3, label: 'Cohort', value: cohort.name, to: cohortPath(cohort.id) },
    ...(detail.follow_up ? [{ key: 'follow_up', icon: UserRoundCheck, label: TERMS.followUpPlan, value: FOLLOW_UP_STATUS_LABELS[detail.follow_up.status as keyof typeof FOLLOW_UP_STATUS_LABELS] ?? humanize(detail.follow_up.status), to: interventionPath(detail.follow_up.id) }] : []),
    { key: 'check_ins', icon: MessageSquareText, label: 'Follow-up notes', count: detail.check_ins_count, onSelect: () => scrollToSection('check-ins') },
    ...(detail.can_edit ? [{ key: 'edit', icon: PencilLine, label: 'Edit or add a follow-up note', to: support }] : []),
  ]

  return <ReturnOrigin label={label}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[{ label: cohort.name, to: cohortPath(cohort.id) }, { label: student.name, to: cohortStudentPath(cohort.id, student.id) }, { label: TERMS.returnPlan }]}
      type={<span>{TERMS.returnPlan}</span>}
      title={`${student.name}'s ${TERMS.returnPlan.toLowerCase()}`}
      titleText={`${student.name}'s ${TERMS.returnPlan.toLowerCase()}`}
      status={<>
        <Badge tone={status.tone}>{status.label}</Badge>
        {detail.check_in_due && <Badge tone="warning" icon={<CalendarClock className="h-3 w-3" aria-hidden="true" />}>Follow-up due</Badge>}
      </>}
      context={<>
        <RecordLink record={{ type: 'student', id: student.id, cohortId: cohort.id }} variant="plain" touchTarget>{student.name}</RecordLink>
        <span aria-hidden="true">·</span>
        <RecordLink record={{ type: 'cohort', id: cohort.id }} variant="plain" touchTarget className="font-normal text-ink-muted">{cohort.name}</RecordLink>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">Started {formatShortDate(detail.created_at)}</span>
      </>}
      actions={detail.can_edit && detail.status === 'active' ? <LinkButton to={support} size="sm"><PencilLine className="h-4 w-4" aria-hidden="true" />Edit or add a note</LinkButton> : null}
    />

    <RecordLayout related={<RelatedPanel rows={rows} returnLabel={label} />}>
      <Section id="overview" title="The plan">
        <Facts items={[
          { label: 'Owner', value: <span className="inline-flex flex-wrap items-center gap-2"><RecordLink record={{ type: 'staff', id: detail.owner.id }} variant="plain">{detail.owner.name}</RecordLink>{!detail.owner.valid && <Badge tone="warning">Needs a new owner</Badge>}</span> },
          { label: 'How it started', value: SOURCES[detail.source] ?? humanize(detail.source) },
          { label: 'Target pace', value: detail.target_pace },
          { label: 'How often to follow up', value: detail.check_in_cadence },
          { label: detail.status === 'active' ? 'Next follow-up' : 'Closed', value: detail.status === 'active' ? formatShortDateTime(detail.next_check_in_at) : formatShortDateTime(detail.completed_at) },
          { label: 'Last follow-up note', value: detail.last_check_in_at ? formatShortDateTime(detail.last_check_in_at) : 'None yet' },
          { label: 'Started by', value: <RecordLink record={{ type: 'staff', id: detail.created_by.id }} variant="plain">{detail.created_by.name}</RecordLink> },
          { label: 'Enrollment', value: humanize(detail.enrollment_status) },
        ]} />
        <div className="space-y-3 border-t border-line px-4 py-4 sm:px-5">
          <div>
            <h3 className="text-xs font-semibold text-ink-muted">Must finish</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink [overflow-wrap:anywhere]">{detail.required_scope}</p>
          </div>
          {detail.optional_scope && <div>
            <h3 className="text-xs font-semibold text-ink-muted">Optional</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink [overflow-wrap:anywhere]">{detail.optional_scope}</p>
          </div>}
          {detail.outcome && <div>
            <h3 className="text-xs font-semibold text-ink-muted">Outcome</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink [overflow-wrap:anywhere]">{detail.outcome}</p>
          </div>}
        </div>
      </Section>

      {(detail.follow_up || detail.restart) && <Section id="source" title="Where it came from">
        <ul className="divide-y divide-line">
          {detail.follow_up && <li className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-5">
            <UserRoundCheck className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <RecordLink record={{ type: 'intervention', id: detail.follow_up.id }} variant="plain" touchTarget className="font-semibold">{`${student.name}'s ${TERMS.followUpPlan.toLowerCase()}`}</RecordLink>
            <span className="ml-auto text-xs tabular-nums text-ink-muted">Opened {formatShortDate(detail.follow_up.created_at)}</span>
          </li>}
          {detail.restart && <li className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-5">
            <RotateCcw className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span className="text-sm text-ink">Restarted the course</span>
            <span className="ml-auto text-xs tabular-nums text-ink-muted">{formatShortDate(detail.restart.created_at)}</span>
          </li>}
        </ul>
      </Section>}

      <Section id="check-ins" title="Follow-up notes" count={detail.check_ins_count > detail.check_ins.length ? `Newest ${detail.check_ins.length} of ${detail.check_ins_count}` : String(detail.check_ins_count)}>
        {detail.check_ins.length ? <ol className="divide-y divide-line">
          {detail.check_ins.map((checkIn) => (
            <li key={checkIn.id} className="space-y-1 px-4 py-3 sm:px-5">
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-semibold text-ink">{checkIn.author.name}</span>
                <time dateTime={checkIn.created_at} className="tabular-nums">{formatShortDateTime(checkIn.created_at)}</time>
                {checkIn.next_check_in_at && <span className="tabular-nums">· next {formatShortDate(checkIn.next_check_in_at)}</span>}
              </p>
              <p className="whitespace-pre-wrap text-sm text-ink-secondary [overflow-wrap:anywhere]">{checkIn.body}</p>
            </li>
          ))}
        </ol> : <EmptyRow>No follow-up notes yet.{detail.can_edit ? ' Add one from the Support tab.' : ''}</EmptyRow>}
        {detail.check_ins_count > detail.check_ins.length && <p className="border-t border-line px-4 py-3 text-xs text-ink-muted sm:px-5">Older notes are on <RecordLink record={{ type: 'student', id: student.id, cohortId: cohort.id, tab: 'support' }} variant="inline">{student.name}'s Support tab</RecordLink>.</p>}
      </Section>
    </RecordLayout>
  </div></ReturnOrigin>
}
