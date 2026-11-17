import { CheckCircle2, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import type { ContentBlockRendererProps } from './contentBlockTypes'
import type { ContentBlockController } from './useContentBlockController'

export function ManualCompleteBlock({ controller, ...props }: ContentBlockRendererProps & { controller: ContentBlockController }) {
  const { studentExperience, isCompleted, usesManualExerciseCompletion, workLocked, handleToggleComplete } = controller
  const { block, isStaff, readOnly, completionInFooter } = props
  return (
    <>
      {studentExperience.v2 && usesManualExerciseCompletion && block.filename && (
        <div className="mt-3 rounded-xl bg-surface-sunken px-3 py-2 text-sm text-ink-secondary [overflow-wrap:anywhere]">
          <p>Exercise file: <span className="font-mono">{block.filename}</span></p>
          <p className="mt-1">Work in your own editor. Nothing to upload here.</p>
        </div>
      )}
      {!completionInFooter && !isStaff && !readOnly && usesManualExerciseCompletion && (
        <div className={`mt-4 rounded-xl border px-4 py-3 ${isCompleted ? 'border-success-line bg-success-soft' : 'border-line bg-surface-sunken/60'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${isCompleted ? 'text-success-ink' : 'text-ink'}`}>
                {isCompleted ? 'Exercise marked complete' : 'Mark this exercise complete when you finish it'}
              </p>
              {studentExperience.v2 ? (
                <p className="mt-1 text-sm text-ink-muted">Nothing to hand in for this one.</p>
              ) : (
                <p className="mt-1 text-sm text-ink-muted">
                  For practice exercises that don't need a submission.
                </p>
              )}
            </div>
            <Button
              variant={isCompleted ? 'secondary' : 'primary'}
              onClick={handleToggleComplete}
              disabled={readOnly || workLocked && !isCompleted}
            >
              {isCompleted ? (
                <>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {studentExperience.v2 ? 'Undo' : 'Mark not done'}
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Mark complete
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
