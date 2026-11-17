import { CheckCircle2, ChevronDown, ChevronUp, Circle, Code, RotateCcw } from 'lucide-react'
import { SubmissionDraftGuard } from '../student/SubmissionDraftGuard'
import { Button } from '../ui/Button'
import { Collapse } from '../ui/Motion'
import { CodeBlock } from './CodeBlock'
import type { ContentBlockRendererProps } from './contentBlockTypes'
import { FeedbackBody } from './FeedbackBody'
import { KnowledgeCheckBlock } from './KnowledgeCheckBlock'
import { ManualCompleteBlock } from './ManualCompleteBlock'
import { MarkdownRenderer } from './MarkdownRenderer'
import { StatusBadge } from './StatusBadge'
import { SubmissionBlock } from './SubmissionBlock'
import { useContentBlockController } from './useContentBlockController'
import { VideoBlock } from './VideoBlock'
const GRADE_LABELS: Record<string, string> = { A: 'Excellent', B: 'Good', C: 'Satisfactory' }
export function ContentBlockRenderer(props: ContentBlockRendererProps) {
  const controller = useContentBlockController(props)
  const { studentExperience, v2, latestSubmission, hasRedoRequest, canEditSubmission, isCompleted, showSolution, setShowSolution, hasEditedSubmissionDraft, knowledgeCheck, isWorkBlock, detectedLang, submissionType, usesManualExerciseCompletion, usesTextSubmission, usesRepoArtifactSubmission, workLocked, starterLinks, latestStatus, blockIcons, handleToggleComplete, header } = controller
  const { block, isStaff, readOnly, completionInFooter } = props
  return (
    <div className="app-surface overflow-hidden">
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface-sunken/60 px-4 py-2">
        <div className="text-ink-muted">{blockIcons[block.block_type]}</div>
        <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
          {header.typeLabel && <span className="font-semibold text-ink">{header.typeLabel}</span>}
          {header.typeLabel && header.title && <span className="text-ink-muted"> · </span>}
          {header.title && <span className={header.typeLabel ? 'text-ink-muted' : 'font-semibold text-ink'}>{header.title}</span>}
        </span>
        {!v2 && latestStatus && <StatusBadge status={latestStatus} />}
        {workLocked && (
          readOnly ? <span className="text-xs font-semibold text-ink-muted">Review only</span> : <StatusBadge status="closed" />
        )}
        <div className="ml-auto">
          {isStaff ? (
            <span className="text-xs font-semibold text-ink-muted">Preview</span>
          ) : completionInFooter || readOnly ? null : usesManualExerciseCompletion && studentExperience.v2 ? (
            // One completion control per manual exercise (S-14): the button below. The header only shows where it stands.
            isCompleted
              ? <span role="img" aria-label="Exercise complete"><CheckCircle2 className="h-5 w-5 text-success-ink" aria-hidden="true" /></span>
              : <span role="img" aria-label="Exercise not complete yet"><Circle className="h-5 w-5 text-ink-muted" aria-hidden="true" /></span>
          ) : usesManualExerciseCompletion ? (
            <button
              onClick={handleToggleComplete}
              disabled={readOnly || workLocked && !isCompleted}
              className="pressable -my-1 flex h-11 w-11 items-center justify-center rounded-lg hover:bg-line/60 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={isCompleted ? 'Mark exercise not done' : 'Mark exercise complete'}
            >
              {isCompleted ? (
                <CheckCircle2 className="h-5 w-5 text-success-ink" aria-hidden="true" />
              ) : (
                <Circle className="h-5 w-5 text-ink-muted" aria-hidden="true" />
              )}
            </button>
          ) : isWorkBlock ? null : knowledgeCheck ? (
            isCompleted || knowledgeCheck.latest_attempt?.correct
              ? <span role="img" aria-label="Check complete"><CheckCircle2 className="h-5 w-5 text-success-ink" aria-hidden="true" /></span>
              : <span role="img" aria-label="Check not answered yet"><Circle className="h-5 w-5 text-ink-muted" aria-hidden="true" /></span>
          ) : (
            <button
              type="button"
              onClick={handleToggleComplete}
              disabled={readOnly || workLocked && !isCompleted}
              aria-pressed={isCompleted}
              className="pressable -my-1 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-ink-secondary hover:bg-line/60 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCompleted ? (
                <CheckCircle2 className="h-5 w-5 text-success-ink" aria-hidden="true" />
              ) : (
                <Circle className="h-5 w-5 text-ink-muted" aria-hidden="true" />
              )}
              {isCompleted ? 'Completed' : 'Mark complete'}
            </button>
          )}
        </div>
      </div>

      <div className="p-4 lg:p-6">
        {v2 && !isStaff && hasEditedSubmissionDraft && <SubmissionDraftGuard dirty />}
        {latestSubmission?.grade && (
          /* One card for the latest review: the feedback lives inside it; the status badge is in the block header. */
          <section
            aria-label={hasRedoRequest ? 'Instructor feedback: redo requested' : 'Instructor feedback'}
            className={`rounded-xl border px-4 py-3 ${hasRedoRequest ? 'border-warning-line bg-warning-soft' : 'border-success-line bg-success-soft'}`}
          >
            <p className={`flex items-center gap-1.5 text-sm font-semibold ${hasRedoRequest ? 'text-warning-ink' : 'text-success-ink'}`}>
              {hasRedoRequest ? <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
              {hasRedoRequest ? (readOnly ? 'Your instructor asked for a redo. Your feedback remains available below.' : submissionType === 'prework_github_sync' ? 'Redo requested (R). Update your code on GitHub — your instructor will re-check it' : submissionType === 'manual_complete' ? 'Your instructor asked for a redo (R). Read the feedback — your instructor will re-check this' : canEditSubmission && !workLocked && (usesTextSubmission || usesRepoArtifactSubmission) ? 'Your instructor asked for a redo (R). Read the feedback, then resubmit below.' : 'Your instructor asked for a redo (R). Read the feedback and revise your work.') : `Reviewed by your instructor${GRADE_LABELS[latestSubmission.grade] ? ` · ${latestSubmission.grade} (${GRADE_LABELS[latestSubmission.grade]})` : ''}`}
            </p>
            {latestSubmission.feedback ? (
              <FeedbackBody feedback={latestSubmission.feedback} className="mt-2 text-ink" />
            ) : hasRedoRequest ? (
              <p className="mt-1 text-sm text-ink-secondary">Review the instructions and try again. Message your instructor if you are not sure what to change.</p>
            ) : null}
          </section>
        )}

        <VideoBlock {...props} controller={controller} />

        {block.body && (
          <div className={block.block_type === 'video' ? 'mt-4' : ''}>
            <MarkdownRenderer content={block.body} starterLinks={starterLinks} />
          </div>
        )}

        <KnowledgeCheckBlock {...props} controller={controller} />

        {block.filename && (
          <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-lg bg-surface-sunken px-3 py-1.5 text-sm text-ink-secondary [overflow-wrap:anywhere]">
            <Code className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="font-mono">{block.filename}</span>
          </div>
        )}

        <ManualCompleteBlock {...props} controller={controller} />

        <SubmissionBlock {...props} controller={controller} />

        {isStaff && block.solution && (
          <div className="mt-4">
            <Button variant="quiet" size="sm" aria-expanded={showSolution} onClick={() => setShowSolution(!showSolution)} className="-ml-2">
              {showSolution ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
              Solution
            </Button>
            <Collapse open={showSolution}>
              <div className="pt-2">
                <CodeBlock code={block.solution} language={detectedLang} label="Solution" lineNumbers className="my-0" />
              </div>
            </Collapse>
          </div>
        )}
      </div>
    </div>
  )
}
