import { CalendarDays, Flag, History, Layers3, ListChecks, PencilLine, Route, UserRound } from 'lucide-react'
import { ReturnOrigin } from '../../../contexts/PreviewNavigationContext'
import { RecordHeader } from '../../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../../components/shared/RelatedPanel'
import { RecordLink } from '../../../components/shared/RecordLink'
import { MarkdownText } from '../../../components/shared/MarkdownRenderer'
import { Badge } from '../../../components/ui/Badge'
import { LinkButton } from '../../../components/ui/Button'
import { useBackLink } from '../../../lib/recordOrigin'
import { useRecordDetail } from '../../../lib/recordDetail'
import { cohortPath, cohortStudentPath, learningPlanEditorPath } from '../../../lib/routes'
import { plural } from '../../../lib/recordUsage'
import { formatShortDate, formatShortDateTime } from '../../../lib/format'
import { LEARNER_STATUS, type LearnerStatus } from '../../../lib/learningStatus'
import type { RelatedRow } from '../../../lib/recordRelated'
import type { LearningPlanDetail } from '../../../types/api'
import { DetailGate, EmptyRow, Facts, RecordLayout, Section, useRouteId } from './RecordParts'

const TONES = { success: 'success', pending: 'pending', warning: 'warning', neutral: 'neutral', quiet: 'neutral' } as const

/** A learner's plan for one enrollment (L-5.2). Editing stays in the plan editor on the student page (#285). */
export function LearningPlanRecord() {
  const state = useRecordDetail('learning_plan', useRouteId())
  return <DetailGate state={state} label="learning plan" icon={Route}>{(detail) => <PlanPage key={detail.id} detail={detail} />}</DetailGate>
}

function PlanPage({ detail }: { detail: LearningPlanDetail }) {
  const { cohort, student } = detail
  const back = useBackLink({ returnTo: cohortStudentPath(cohort.id, student.id, 'learning'), returnLabel: student.name })
  const editor = learningPlanEditorPath(cohort.id, student.id)
  const lessons = detail.milestones.reduce((sum, milestone) => sum + milestone.lessons.length, 0)
  const done = detail.milestones.reduce((sum, milestone) => sum + milestone.completed_count, 0)
  const rows: RelatedRow[] = [
    { key: 'student', icon: UserRound, label: 'Student page', value: student.name, to: cohortStudentPath(cohort.id, student.id) },
    { key: 'cohort', icon: Layers3, label: 'Cohort', value: cohort.name, to: cohortPath(cohort.id) },
    { key: 'milestones', icon: Flag, label: 'Milestones', count: detail.milestones.length, onSelect: () => scrollToSection('milestones') },
    { key: 'lessons', icon: ListChecks, label: 'Milestone lessons done', value: `${done} of ${lessons}`, onSelect: () => scrollToSection('milestones') },
    { key: 'revisions', icon: History, label: 'Revisions', count: detail.revisions_count, onSelect: () => scrollToSection('revisions') },
    { key: 'editor', icon: PencilLine, label: 'Plan editor', to: editor },
  ]

  return <ReturnOrigin label={`Learning plan · ${student.name}`}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[{ label: cohort.name, to: cohortPath(cohort.id) }, { label: student.name, to: cohortStudentPath(cohort.id, student.id) }, { label: 'Learning plan' }]}
      type={<span>Learning plan</span>}
      title={detail.title}
      titleText={detail.title}
      status={detail.active ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
      context={<>
        <RecordLink record={{ type: 'student', id: student.id, cohortId: cohort.id }} variant="plain" touchTarget>{student.name}</RecordLink>
        <span aria-hidden="true">·</span>
        <RecordLink record={{ type: 'cohort', id: cohort.id }} variant="plain" touchTarget className="font-normal text-ink-muted">{cohort.name}</RecordLink>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">Updated {formatShortDate(detail.updated_at)}</span>
      </>}
      actions={<LinkButton to={editor} size="sm"><PencilLine className="h-4 w-4" aria-hidden="true" />Edit plan</LinkButton>}
    />

    <RecordLayout related={<RelatedPanel rows={rows} returnLabel={`Learning plan · ${student.name}`} />}>
      <Section id="overview" title="The plan">
        {!detail.active && <p className="border-b border-line bg-surface-sunken px-4 py-2 text-sm text-ink-secondary sm:px-5">This plan is off. {student.name} follows the cohort's standard lessons.</p>}
        <Facts items={[
          { label: 'Target date', value: detail.target_date ? formatShortDate(detail.target_date, '', { weekday: true }) : 'None' },
          { label: 'Next follow-up', value: detail.next_check_in_on ? formatShortDate(detail.next_check_in_on, '', { weekday: true }) : 'None' },
          { label: 'Lesson exceptions', value: detail.lesson_exceptions_count ? plural(detail.lesson_exceptions_count, 'lesson') : 'None' },
          { label: 'Enrollment', value: detail.enrollment_status.charAt(0).toUpperCase() + detail.enrollment_status.slice(1) },
        ]} />
        {detail.description && <div className="border-t border-line px-4 py-3 sm:px-5">
          <h3 className="text-xs font-semibold text-ink-muted">Note for the student</h3>
          <div className="mt-1 text-sm text-ink [overflow-wrap:anywhere]"><MarkdownText content={detail.description} /></div>
        </div>}
      </Section>

      <Section id="milestones" title="Milestones" count={plural(detail.milestones.length, 'milestone')}>
        {detail.milestones.length ? <ol className="divide-y divide-line">
          {detail.milestones.map((milestone, index) => (
            <li key={`${index}-${milestone.title}`} className="space-y-2 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-ink">{milestone.title}</span>
                {milestone.due_on && <span className="inline-flex items-center gap-1 text-xs tabular-nums text-ink-muted"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{formatShortDate(milestone.due_on, '', { weekday: true })}</span>}
                <span className="ml-auto text-xs font-semibold tabular-nums text-ink-muted">{milestone.completed_count} of {milestone.lessons.length} done</span>
              </div>
              <ul className="space-y-1">
                {milestone.lessons.map((lesson) => {
                  const status = lesson.status && lesson.status in LEARNER_STATUS ? LEARNER_STATUS[lesson.status as LearnerStatus] : null
                  return <li key={lesson.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface-sunken px-3 py-1.5 sm:min-h-0">
                    <RecordLink record={{ type: 'lesson', id: lesson.id, cohortId: cohort.id }} variant="plain" touchTarget className="min-w-0 flex-1 text-sm">{lesson.title}</RecordLink>
                    {lesson.module_name && lesson.module_id && <RecordLink record={{ type: 'module', id: lesson.module_id, cohortId: cohort.id }} variant="plain" className="text-xs font-normal text-ink-muted">{lesson.module_name}</RecordLink>}
                    {status ? <Badge tone={TONES[status.tone]}>{status.shortLabel}</Badge> : <Badge>No longer assigned</Badge>}
                  </li>
                })}
              </ul>
            </li>
          ))}
        </ol> : <EmptyRow>No milestones yet. Add them in the plan editor.</EmptyRow>}
      </Section>

      <Section id="revisions" title="Revisions" count={detail.revisions_count > detail.revisions.length ? `Newest ${detail.revisions.length} of ${detail.revisions_count}` : String(detail.revisions_count)}>
        {detail.revisions.length ? <ol className="divide-y divide-line">
          {detail.revisions.map((revision) => (
            <li key={revision.id} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-5">
              <span className="font-semibold text-ink">{revision.author.name}</span>
              <span className="text-sm text-ink-secondary">{revision.changes[0] === 'created' ? 'Started the plan' : revision.changes.length ? `Changed the ${revision.changes.join(', ')}` : 'Saved without changes'}</span>
              <time dateTime={revision.created_at} className="ml-auto text-xs tabular-nums text-ink-muted">{formatShortDateTime(revision.created_at)}</time>
            </li>
          ))}
        </ol> : <EmptyRow>No revisions recorded.</EmptyRow>}
      </Section>
    </RecordLayout>
  </div></ReturnOrigin>
}
