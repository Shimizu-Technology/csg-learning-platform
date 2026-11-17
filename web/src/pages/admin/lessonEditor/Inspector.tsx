import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, Layers, Plus, Target, X } from 'lucide-react'
import { api } from '../../../lib/api'
import { useToast } from '../../../contexts/ToastContext'
import { RecordLink } from '../../../components/shared/RecordLink'
import { CodeRunnerSettings } from '../../../components/admin/CodeRunnerSettings'
import { detectLanguage } from '../../../components/shared/CodeEditor'
import { Button, IconButton } from '../../../components/ui/Button'
import { buildSubmissionConfigWithRunner, codeRunnerLanguageFromEditor, normalizeCodeRunnerConfig } from '../../../lib/codeRunner'
import { formatShortDate } from '../../../lib/format'
import { gradingPath, plural, supportPath, useRecordUsage } from '../../../lib/recordUsage'
import { lessonRecordPath } from '../../../lib/routes'
import { UsedInCohorts } from '../../../components/admin/UsedInCohorts'
import type { BlockLearnerActivity, LearningObjective, LessonEditorContext, Rubric } from '../../../types/api'
import { hasLearnerWork, learnerWorkSummary } from './BlockCard'
import { BLOCK_LABELS, blockTitle, type BlockDraft, type LessonDraft } from './blockDraft'
import { SUBMISSION_TYPE_OPTIONS, submissionTypeHint } from './submissionTypes'

export type RubricDraft = { title: string; criteria: string[] }
const emptyRubric = (): RubricDraft => ({ title: '', criteria: ['', ''] })

export type InspectorTab = 'lesson' | 'block'

interface InspectorProps {
  tab: InspectorTab
  onTab: (tab: InspectorTab) => void
  draft: LessonDraft
  onLesson: (patch: Partial<Pick<LessonDraft, 'title' | 'required' | 'release_day' | 'alignments'>>) => void
  block: BlockDraft | null
  onBlock: (patch: Partial<BlockDraft>) => void
  activity: Map<number, BlockLearnerActivity>
  context: LessonEditorContext
  curriculumId: number
  lessonId: number
  objectives: LearningObjective[]
  onObjectiveCreated: (objective: LearningObjective) => void
  rubrics: Rubric[]
  onRubricCreated: (rubric: Rubric) => void
  rubricDrafts: Record<string, RubricDraft>
  setRubricDrafts: React.Dispatch<React.SetStateAction<Record<string, RubricDraft>>>
  readOnly?: boolean
}

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-b border-line p-4 last:border-b-0">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-muted">{icon}{title}</h3>
      {children}
    </section>
  )
}

export function Inspector(props: InspectorProps) {
  const { tab, onTab, block } = props
  const tabId = useId()
  // Keep unfinished rubrics when the inspector changes tabs or blocks.
  const { rubricDrafts, setRubricDrafts } = props
  const rubricKey = block?.key ?? ''
  const rubricDraft = rubricDrafts[rubricKey] ?? emptyRubric()
  const setRubricDraft = (update: RubricDraft | ((value: RubricDraft) => RubricDraft)) => setRubricDrafts((drafts) => ({ ...drafts, [rubricKey]: typeof update === 'function' ? update(drafts[rubricKey] ?? emptyRubric()) : update }))
  const blockTab = block ? `${BLOCK_LABELS[block.block_type]} block` : 'Block'
  return (
    <div className="flex min-h-0 flex-col">
      <div role="tablist" aria-label="Settings" className="flex gap-1 border-b border-line px-2">
        {(['lesson', 'block'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`${tabId}-${value}`}
            aria-selected={tab === value}
            aria-controls={`${tabId}-${value}-panel`}
            disabled={value === 'block' && !block}
            onClick={() => onTab(value)}
            onKeyDown={(event) => {
              if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && block) {
                event.preventDefault()
                const next = value === 'lesson' ? 'block' : 'lesson'
                onTab(next)
                document.getElementById(`${tabId}-${next}`)?.focus()
              }
            }}
            tabIndex={tab === value ? 0 : -1}
            className={`min-h-11 border-b-2 px-3 text-sm font-semibold transition-colors disabled:text-ink-disabled ${tab === value ? 'border-primary-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
          >
            {value === 'lesson' ? 'Lesson' : blockTab}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${tabId}-${tab}-panel`} aria-labelledby={`${tabId}-${tab}`} className="min-h-0 flex-1">
        {tab === 'lesson' || !block ? <LessonSettings {...props} /> : <BlockSettings {...props} block={block} rubricDraft={rubricDraft} setRubricDraft={setRubricDraft} />}
      </div>
    </div>
  )
}

function LessonSettings({ draft, onLesson, context, objectives, onObjectiveCreated, curriculumId, lessonId, readOnly }: InspectorProps) {
  const id = useId()
  const toast = useToast()
  const days = context.module.release_days
  const current = days.find((day) => day.release_day === draft.release_day)
  const weeks = [...new Set(days.map((day) => day.week))]
  const week = current?.week ?? Math.floor(draft.release_day / 7) + 1
  const dayNames = days.filter((day) => day.week === week)
  const [creating, setCreating] = useState(false)
  const [objectiveDraft, setObjectiveDraft] = useState({ code: '', title: '', success_criteria: '' })
  const aligned = new Set(draft.alignments.map((alignment) => alignment.learning_objective_id))
  const available = objectives.filter((objective) => objective.active && !aligned.has(objective.id))

  const createObjective = async () => {
    if (!objectiveDraft.code.trim() || !objectiveDraft.title.trim() || !objectiveDraft.success_criteria.trim()) {
      toast.error('Add a code, a title and success criteria for the objective.')
      return
    }
    setCreating(true)
    const response = await api.createLearningObjective({ curriculum_id: curriculumId, code: objectiveDraft.code.trim(), title: objectiveDraft.title.trim(), success_criteria: objectiveDraft.success_criteria.trim(), position: objectives.length, lesson_id: lessonId })
    setCreating(false)
    if (!response.data) {
      toast.error(response.error || 'The objective couldn\'t be created.')
      return
    }
    onObjectiveCreated(response.data.learning_objective)
    onLesson({ alignments: [...draft.alignments, { learning_objective_id: response.data.learning_objective.id, block_key: null }] })
    setObjectiveDraft({ code: '', title: '', success_criteria: '' })
  }

  return (
    <div>
      <Section title="Lesson">
        <label className="block text-sm font-semibold text-ink-secondary" htmlFor={`${id}-title`}>Title</label>
        <input id={`${id}-title`} value={draft.title} readOnly={readOnly} onChange={(event) => onLesson({ title: event.target.value })} className="app-control -mt-1.5 w-full" />
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-sunken px-3 py-2.5">
          <input type="checkbox" role="switch" checked={draft.required} disabled={readOnly} onChange={(event) => onLesson({ required: event.target.checked })} className="mt-0.5 h-4 w-4 accent-action-primary" />
          <span>
            <span className="block text-sm font-semibold text-ink">Required</span>
            <span className="block text-xs leading-5 text-ink-muted">{draft.required ? 'Counts toward progress.' : 'Optional stretch: visible, but doesn\'t count toward progress.'}</span>
          </span>
        </label>
      </Section>

      <Section title="Schedule">
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Week" value={week} disabled={readOnly} className="app-control w-full min-w-0" onChange={(event) => {
            const nextWeek = Number(event.target.value)
            const weekday = current?.day_name
            const target = days.find((day) => day.week === nextWeek && day.day_name === weekday) || days.find((day) => day.week === nextWeek)
            if (target) onLesson({ release_day: target.release_day })
          }}>
            {weeks.map((value) => <option key={value} value={value}>Week {value}</option>)}
          </select>
          <select aria-label="Day" value={current?.release_day ?? ''} disabled={readOnly} className="app-control w-full min-w-0" onChange={(event) => onLesson({ release_day: Number(event.target.value) })}>
            {!current && <option value="">Not a scheduled day</option>}
            {dayNames.map((day) => <option key={day.release_day} value={day.release_day}>{day.day_name}</option>)}
          </select>
        </div>
        <p className="text-xs text-ink-muted">Students in a program see this lesson on this day of the module. Self-paced students see it in order.</p>
      </Section>

      <Section title="Objectives" icon={<Target className="h-3.5 w-3.5" aria-hidden="true" />}>
        {draft.alignments.length === 0 && <p className="text-sm text-ink-muted">No objectives yet. Tell students what they're building toward.</p>}
        {draft.alignments.map((alignment) => {
          const objective = objectives.find((item) => item.id === alignment.learning_objective_id)
          if (!objective) return null
          return (
            <div key={objective.id} className="grid gap-2 rounded-xl border border-line p-3">
              <div className="flex items-start gap-2">
                <span className="shrink-0 rounded-md border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-xs font-semibold text-ink-secondary">{objective.code}</span>
                <p className="min-w-0 flex-1 text-sm font-semibold text-ink">{objective.title}</p>
                {!readOnly && <IconButton size="sm" label={`Remove ${objective.title}`} onClick={() => onLesson({ alignments: draft.alignments.filter((item) => item.learning_objective_id !== objective.id) })}><X className="h-4 w-4" /></IconButton>}
              </div>
              <label className="text-xs font-semibold text-ink-secondary">Applies to
                <select value={alignment.block_key || ''} disabled={readOnly} className="app-control mt-1 block w-full min-w-0" onChange={(event) => onLesson({
                  alignments: draft.alignments.map((item) => item.learning_objective_id === objective.id ? { ...item, block_key: event.target.value || null } : item),
                })}>
                  <option value="">Whole lesson</option>
                  {draft.blocks.map((item, index) => <option key={item.key} value={item.key}>{index + 1}. {blockTitle(item)}</option>)}
                </select>
              </label>
            </div>
          )
        })}
        {!readOnly && available.length > 0 && (
          <select aria-label="Add an objective from this curriculum" value="" className="app-control w-full min-w-0" onChange={(event) => {
            if (event.target.value) onLesson({ alignments: [...draft.alignments, { learning_objective_id: Number(event.target.value), block_key: null }] })
          }}>
            <option value="">Add an objective…</option>
            {available.map((objective) => <option key={objective.id} value={objective.id}>{objective.code} · {objective.title}</option>)}
          </select>
        )}
        {!readOnly && (
          <details className="rounded-xl border border-line px-3 py-1">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink-secondary">New objective</summary>
            <div className="grid gap-2 pb-3">
              <label className="text-xs font-semibold text-ink-secondary">Code<input value={objectiveDraft.code} onChange={(event) => setObjectiveDraft((value) => ({ ...value, code: event.target.value }))} placeholder="JS.4" className="app-control mt-1 block w-full font-mono" /></label>
              <label className="text-xs font-semibold text-ink-secondary">What students will be able to do<input value={objectiveDraft.title} onChange={(event) => setObjectiveDraft((value) => ({ ...value, title: event.target.value }))} placeholder="Choose between paths with if and else" className="app-control mt-1 block w-full" /></label>
              <label className="text-xs font-semibold text-ink-secondary">Success criteria<textarea value={objectiveDraft.success_criteria} onChange={(event) => setObjectiveDraft((value) => ({ ...value, success_criteria: event.target.value }))} rows={2} placeholder="I can say which branch runs for a given input." className="app-control mt-1 block w-full" /></label>
              <Button variant="secondary" size="sm" disabled={creating} onClick={() => void createObjective()}><Plus className="h-4 w-4" />{creating ? 'Adding…' : 'Add objective'}</Button>
            </div>
          </details>
        )}
      </Section>

      <Section title="Used in" icon={<Layers className="h-3.5 w-3.5" aria-hidden="true" />}>
        <LessonUsedIn lessonId={lessonId} context={context} />
      </Section>
    </div>
  )
}

/**
 * Where this lesson is used (L-3.1): the cohorts you can see, when it opens in
 * each, a View as student link, and its submissions and help. Counts come from
 * the editor's context until the lesson's usage loads.
 */
function LessonUsedIn({ lessonId, context }: { lessonId: number; context: LessonEditorContext }) {
  const { usage, error, reload } = useRecordUsage('lesson', lessonId)
  const totals = usage?.totals ?? { submissions: context.submissions_count, waiting: context.waiting_count, open_help: context.open_help_count }
  const single = usage && usage.cohorts.length === 1 ? usage.cohorts[0].id : null
  return (
    <>
      {usage ? (
        <UsedInCohorts compact id="editor-used-in" rows={usage.cohorts.map((cohort) => ({ kind: 'lesson' as const, cohort, lessonId, moduleId: usage.module.id }))} otherCount={usage.other_cohorts_count} />
      ) : error ? (
        <p className="text-sm text-ink-muted">Couldn't load where this lesson is used. <button type="button" className="app-link" onClick={() => void reload()}>Retry</button></p>
      ) : (
        <ul className="grid gap-1.5" aria-busy="true">
          {context.used_in.map((cohort) => (
            <li key={cohort.id} className="flex items-baseline gap-2 text-sm">
              <RecordLink record={{ type: 'cohort', id: cohort.id }} variant="plain" truncate className="min-w-0 flex-1 text-ink">{cohort.name}</RecordLink>
              <span className="shrink-0 text-xs text-ink-muted">{cohort.status === 'upcoming' ? 'starts' : 'started'} {cohort.start_date ? formatShortDate(cohort.start_date) : 'unscheduled'}</span>
            </li>
          ))}
          {!context.used_in.length && <li className="text-sm text-ink-muted">{context.other_cohorts_count ? 'None of the cohorts you teach use it.' : 'No cohort uses this curriculum yet.'}</li>}
        </ul>
      )}
      {/* One cohort already shows its own counts; the totals cover several, or wait for the list. */}
      {(!usage || usage.cohorts.length !== 1) && <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
        <Link to={gradingPath({ cohortId: single, lessonId, all: true })} className="app-link inline-flex min-h-11 items-center sm:min-h-0">{plural(totals.submissions, 'submission')}</Link>
        <Link to={gradingPath({ cohortId: single, lessonId })} className="app-link inline-flex min-h-11 items-center sm:min-h-0">{totals.waiting} waiting</Link>
        {typeof totals.open_help === 'number' && <Link to={supportPath(single, { lessonId })} className="app-link inline-flex min-h-11 items-center sm:min-h-0">{totals.open_help} open help</Link>}
      </p>}
      <Link to={lessonRecordPath(lessonId)} className="app-link inline-flex min-h-11 items-center text-sm sm:min-h-0">Open the lesson page</Link>
    </>
  )
}

function BlockSettings({ block, onBlock, activity, objectives, rubrics, onRubricCreated, curriculumId, readOnly, rubricDraft, setRubricDraft }: InspectorProps & { block: BlockDraft; rubricDraft: RubricDraft; setRubricDraft: (update: RubricDraft | ((value: RubricDraft) => RubricDraft)) => void }) {
  const id = useId()
  const toast = useToast()
  const blockActivity = block.id ? activity.get(block.id) : undefined
  const work = hasLearnerWork(blockActivity)
  const isVideo = block.block_type === 'video' || block.block_type === 'recording'
  const isExercise = block.block_type === 'exercise' || block.block_type === 'code_challenge'
  const runner = normalizeCodeRunnerConfig(block.submission_config, codeRunnerLanguageFromEditor(detectLanguage(block.filename)) || 'ruby')
  const rubric = rubrics.find((item) => item.id === block.rubric_id)
  const [creatingRubric, setCreatingRubric] = useState(false)

  const createRubric = async () => {
    const criteria = rubricDraft.criteria.map((criterion) => criterion.trim()).filter(Boolean)
    if (!rubricDraft.title.trim() || !criteria.length) {
      toast.error('Give the rubric a title and at least one criterion.')
      return
    }
    setCreatingRubric(true)
    const response = await api.createRubric({ curriculum_id: curriculumId, title: rubricDraft.title.trim(), criteria: criteria.map((title) => ({ title, description: title })) })
    setCreatingRubric(false)
    if (!response.data) {
      toast.error(response.error || 'The rubric couldn\'t be created.')
      return
    }
    onRubricCreated(response.data.rubric)
    onBlock({ rubric_id: response.data.rubric.id })
    setRubricDraft({ title: '', criteria: ['', ''] })
  }

  return (
    <div>
      <Section title={`${BLOCK_LABELS[block.block_type]} block`}>
        {block.block_type === 'text' && (
          <label className="text-sm font-semibold text-ink-secondary">Heading (optional)
            <input value={block.title} readOnly={readOnly} onChange={(event) => onBlock({ title: event.target.value })} placeholder="Why decisions matter" className="app-control mt-1.5 block w-full" />
          </label>
        )}
        {(isVideo || isExercise) && (
          <label className="text-sm font-semibold text-ink-secondary">Kind
            <select value={block.block_type} disabled={readOnly || work} className="app-control mt-1.5 block w-full min-w-0" onChange={(event) => onBlock({ block_type: event.target.value as BlockDraft['block_type'] })}>
              {isVideo ? <><option value="video">Video</option><option value="recording">Class recording</option></> : <><option value="exercise">Exercise</option><option value="code_challenge">Code challenge</option></>}
            </select>
          </label>
        )}
        {(isExercise || block.block_type === 'checkpoint') && (
          <>
            <label className="text-sm font-semibold text-ink-secondary" htmlFor={`${id}-submission`}>Submission type</label>
            <select id={`${id}-submission`} value={block.submission_type || ''} disabled={readOnly} className="app-control -mt-1.5 block w-full min-w-0 truncate" onChange={(event) => {
              const value = event.target.value || null
              onBlock({ submission_type: value, submission_config: buildSubmissionConfigWithRunner(block.submission_config, value === 'text_submission' ? runner : { ...runner, enabled: false }) })
            }}>
              {block.submission_type === null && <option value="">Lesson default</option>}
              {SUBMISSION_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <p className="-mt-1 text-xs leading-5 text-ink-muted">{submissionTypeHint(block.submission_type)} Reviewed work goes to the cohort's grading queue, self-paced work included.</p>
          </>
        )}
        {isExercise && (
          <label className="text-sm font-semibold text-ink-secondary">Filename
            <input value={block.filename} readOnly={readOnly} onChange={(event) => onBlock({ filename: event.target.value })} placeholder="ticket-price.js" className="app-control mt-1.5 block w-full font-mono" />
            <span className="mt-1 block text-xs font-normal text-ink-muted">Sets the starter language and the file name for GitHub sync.</span>
          </label>
        )}
        {isExercise && block.submission_type === 'text_submission' && !readOnly && (
          <CodeRunnerSettings value={runner} compact onChange={(next) => onBlock({ submission_config: buildSubmissionConfigWithRunner(block.submission_config, next) })} />
        )}
        {block.block_type === 'checkpoint' && block.check && (
          <label className="text-sm font-semibold text-ink-secondary">Question checks
            <select value={block.check.learning_objective_id || ''} disabled={readOnly || block.check_locked} className="app-control mt-1.5 block w-full min-w-0" onChange={(event) => onBlock({ check: { ...block.check!, learning_objective_id: event.target.value ? Number(event.target.value) : null } })}>
              <option value="">No specific objective</option>
              {objectives.filter((objective) => objective.active).map((objective) => <option key={objective.id} value={objective.id}>{objective.code} · {objective.title}</option>)}
            </select>
          </label>
        )}
        {work && <p className="rounded-xl border border-info-line bg-info-soft px-3 py-2 text-xs leading-5 text-info-ink">Students have work here ({learnerWorkSummary(blockActivity)}). You can edit the content; the block can't be deleted or change kind, so their work stays attached.</p>}
      </Section>

      {(isExercise || block.block_type === 'checkpoint') && (
        <Section title="Rubric" icon={<ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />}>
          <select aria-label="Rubric" value={block.rubric_id || ''} disabled={readOnly} className="app-control w-full min-w-0" onChange={(event) => onBlock({ rubric_id: event.target.value ? Number(event.target.value) : null })}>
            <option value="">No rubric</option>
            {rubrics.filter((item) => item.active !== false || item.id === block.rubric_id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          {rubric && <ul className="grid gap-1.5">{rubric.criteria.map((criterion) => <li key={criterion.id} className="text-sm text-ink">{criterion.title}</li>)}</ul>}
          {!readOnly && (
            <details className="rounded-xl border border-line px-3 py-1">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink-secondary">New rubric</summary>
              <div className="grid gap-2 pb-3">
                <label className="text-xs font-semibold text-ink-secondary">Title<input value={rubricDraft.title} onChange={(event) => setRubricDraft((value) => ({ ...value, title: event.target.value }))} placeholder="Ticket prices rubric" className="app-control mt-1 block w-full" /></label>
                {rubricDraft.criteria.map((criterion, index) => (
                  <input key={index} aria-label={`Criterion ${index + 1}`} value={criterion} onChange={(event) => setRubricDraft((value) => ({ ...value, criteria: value.criteria.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} placeholder={index === 0 ? 'Correct output' : 'Readable code'} className="app-control w-full" />
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button variant="quiet" size="sm" onClick={() => setRubricDraft((value) => ({ ...value, criteria: [...value.criteria, ''] }))}><Plus className="h-4 w-4" />Criterion</Button>
                  <Button variant="secondary" size="sm" disabled={creatingRubric} onClick={() => void createRubric()}>{creatingRubric ? 'Adding…' : 'Add rubric'}</Button>
                </div>
              </div>
            </details>
          )}
        </Section>
      )}
    </div>
  )
}
