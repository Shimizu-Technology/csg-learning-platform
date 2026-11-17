import { ClipboardCheck, Code2, Layers3, LibraryBig, ListChecks, Target } from 'lucide-react'
import { ReturnOrigin } from '../../../contexts/PreviewNavigationContext'
import { RecordHeader } from '../../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../../components/shared/RelatedPanel'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Badge } from '../../../components/ui/Badge'
import { LinkButton } from '../../../components/ui/Button'
import { useBackLink } from '../../../lib/recordOrigin'
import { useRecordDetail } from '../../../lib/recordDetail'
import { curriculumPath, lessonEditorPath } from '../../../lib/routes'
import { otherCohortsLine, plural } from '../../../lib/recordUsage'
import { TERMS } from '../../../lib/glossary'
import type { RelatedRow } from '../../../lib/recordRelated'
import type { RubricDetail } from '../../../types/api'
import { DetailGate, EmptyRow, RecordLayout, Section, useRouteId } from './RecordParts'

/** A rubric's staff page (L-5.2): criteria and the exercises graded with it. */
export function RubricRecord() {
  const state = useRecordDetail('rubric', useRouteId())
  return <DetailGate state={state} label="rubric" icon={ListChecks}>{(detail) => <RubricPage key={detail.id} detail={detail} />}</DetailGate>
}

function RubricPage({ detail }: { detail: RubricDetail }) {
  const { curriculum } = detail
  const back = useBackLink({ returnTo: curriculumPath(curriculum.id), returnLabel: curriculum.name })
  const graded = detail.uses.reduce((sum, use) => sum + use.graded, 0)
  const lessonIds = new Set(detail.uses.map((use) => use.lesson.id))
  const firstUse = detail.uses.find((use) => !use.lesson.archived) || detail.uses[0]
  const rows: RelatedRow[] = [
    { key: 'curriculum', icon: LibraryBig, label: 'Curriculum', value: curriculum.name, to: curriculumPath(curriculum.id) },
    { key: 'criteria', icon: Target, label: 'Criteria', count: detail.criteria.length, onSelect: () => scrollToSection('criteria') },
    { key: 'uses', icon: Code2, label: `${TERMS.exercise}s using it`, count: detail.uses.length, onSelect: () => scrollToSection('uses') },
    { key: 'graded', icon: ClipboardCheck, label: TERMS.graded, count: graded, onSelect: () => scrollToSection('uses') },
    { key: 'cohorts', icon: Layers3, label: 'Cohorts on this curriculum', count: detail.cohorts.length, onSelect: () => scrollToSection('uses') },
  ]

  return <ReturnOrigin label={`Rubric · ${detail.title}`}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[{ label: curriculum.name, to: curriculumPath(curriculum.id) }, { label: 'Rubrics' }, { label: detail.title }]}
      type={<span>Rubric · {plural(detail.criteria.length, 'criterion', 'criteria')}</span>}
      title={detail.title}
      titleText={detail.title}
      status={detail.active ? undefined : <Badge>Inactive</Badge>}
      context={<>
        <RecordLink record={{ type: 'curriculum', id: curriculum.id }} variant="plain" touchTarget>{curriculum.name}</RecordLink>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{plural(lessonIds.size, 'lesson')}</span>
      </>}
      actions={firstUse && <LinkButton to={lessonEditorPath(firstUse.lesson.id)} size="sm" variant={detail.can_edit ? 'primary' : 'secondary'}>{detail.can_edit ? 'Edit in a lesson' : 'Open in editor'}</LinkButton>}
    />

    <RecordLayout related={<RelatedPanel rows={rows} returnLabel={`Rubric · ${detail.title}`} />}>
      {detail.description && <Section id="overview" title="About this rubric"><p className="whitespace-pre-wrap px-4 py-4 text-sm text-ink-secondary sm:px-5">{detail.description}</p></Section>}

      <Section id="criteria" title="Criteria" count={plural(detail.criteria.length, 'criterion', 'criteria')}>
        {detail.criteria.length ? <ol className="divide-y divide-line">
          {detail.criteria.map((criterion, index) => (
            <li key={criterion.id} className="flex gap-3 px-4 py-3 sm:px-5">
              <span className="w-5 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums text-ink-muted">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{criterion.title}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-secondary">{criterion.description}</p>
                {criterion.objective && <p className="mt-1.5"><Badge tone="neutral"><span className="font-mono">{criterion.objective.code}</span> {criterion.objective.title}</Badge></p>}
              </div>
            </li>
          ))}
        </ol> : <EmptyRow>No criteria yet.</EmptyRow>}
      </Section>

      <Section id="uses" title={`${TERMS.exercise}s graded with it`} count={plural(detail.uses.length, TERMS.exercise.toLowerCase())}>
        {detail.uses.length ? <ul className="divide-y divide-line">
          {detail.uses.map((use) => (
            <li key={use.block.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-5">
              <div className="min-w-0 flex-1">
                <RecordLink record={{ type: 'lesson', id: use.lesson.id }} variant="plain" touchTarget className="font-semibold">{use.lesson.title}</RecordLink>
                <p className="text-xs text-ink-muted">
                  <RecordLink record={{ type: 'module', id: use.module.id }} variant="plain" className="font-normal text-ink-muted">{use.module.name}</RecordLink>
                  {' · '}{use.block.title || TERMS.exercise}
                </p>
              </div>
              {use.lesson.archived && <Badge>Archived</Badge>}
              <span className="text-xs font-semibold tabular-nums text-ink-muted">{use.graded} graded</span>
            </li>
          ))}
        </ul> : <EmptyRow>No {TERMS.exercise.toLowerCase()} uses this rubric yet. Pick it on an {TERMS.exercise.toLowerCase()} in the lesson editor.</EmptyRow>}
        <div className="border-t border-line px-4 py-3 text-xs text-ink-muted sm:px-5">
          {detail.cohorts.length ? <>Grades counted in {detail.cohorts.map((cohort, index) => <span key={cohort.id}>{index ? ', ' : ''}<RecordLink record={{ type: 'cohort', id: cohort.id }} variant="plain" className="font-normal text-ink-muted">{cohort.name}</RecordLink></span>)}.</> : 'No cohort you can see uses this curriculum.'}
          {otherCohortsLine(detail.other_cohorts_count) && <span className="block pt-1">{otherCohortsLine(detail.other_cohorts_count)}</span>}
        </div>
      </Section>
    </RecordLayout>
  </div></ReturnOrigin>
}
