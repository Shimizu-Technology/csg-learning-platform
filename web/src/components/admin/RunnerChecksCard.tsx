import { useEffect, useMemo } from 'react'
import { CheckCircle2, ListChecks, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import type { CodeRunnerCheck, CodeRunnerLanguage } from '../../lib/codeRunner'
import { useCodeChecks } from '../../lib/useCodeChecks'
import { gradeLabel } from '../../lib/glossary'
import type { GradingScale } from '../../lib/gradingScale'
import { CodeChecksList } from '../shared/CodeChecksResults'
import { Button } from '../ui/Button'

/** The passing grade automated checks suggest on each scale: Pass on Pass / Redo, B on A / B / C / Redo. */
export function checksSuggestedGrade(scale: GradingScale | null | undefined): 'P' | 'B' {
  return scale === 'pass_redo' ? 'P' : 'B'
}

/**
 * The exercise's automated checks, run in the instructor's own browser against the saved
 * submission text (never a pass or fail the student's browser reported). Selecting the
 * suggested grade only chooses it; Save is still the instructor's.
 */
export function RunnerChecksCard({
  submissionId,
  code,
  language,
  checks,
  gradingScale,
  selectedGrade,
  disabled,
  onSelectSuggested,
}: {
  submissionId: number
  code: string
  language: CodeRunnerLanguage
  checks: CodeRunnerCheck[]
  gradingScale: GradingScale | null | undefined
  selectedGrade: string | null
  disabled: boolean
  onSelectSuggested: (grade: 'P' | 'B') => void
}) {
  const checksKey = JSON.stringify(checks)
  // A stable list for the hook, rebuilt only when the checks themselves change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableChecks = useMemo(() => checks, [checksKey])
  const { running, run, start } = useCodeChecks(language, stableChecks)
  useEffect(() => {
    void start(code)
  }, [submissionId, code, start])

  const suggested = checksSuggestedGrade(gradingScale)
  const allPassed = Boolean(run && run.failed === 0)
  const headline = !run
    ? `Running ${checks.length} ${checks.length === 1 ? 'check' : 'checks'} in your browser…`
    : allPassed
      ? `All ${run.total} ${run.total === 1 ? 'check' : 'checks'} passed · ${gradeLabel(suggested)} suggested`
      : `${run.failed} of ${run.total} ${run.total === 1 ? 'check' : 'checks'} failed · Review for Redo`
  const tone = !run ? 'border-line' : allPassed ? 'border-info-line' : 'border-warning-line'

  return (
    <section
      aria-label="Automated code checks"
      aria-busy={running}
      data-runner-checks={!run ? 'running' : allPassed ? 'passed' : 'failed'}
      className={`space-y-3 rounded-2xl border bg-surface-raised p-4 text-sm text-ink ${tone}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          {!run ? (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-ink-muted" aria-hidden="true" />
          ) : allPassed ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-info-ink" aria-hidden="true" />
          ) : (
            <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" aria-hidden="true" />
          )}
          <div className="min-w-0 space-y-1">
            <h3 className="break-words font-bold text-ink" role="status">{headline}</h3>
            <p className="text-xs text-ink-secondary">
              The exercise's checks ran in your browser against the saved submission. Instructors confirm every final grade.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {allPassed && !disabled && (
            <Button
              variant={selectedGrade === suggested ? 'primary' : 'secondary'}
              size="md"
              className="w-full sm:w-auto"
              aria-pressed={selectedGrade === suggested}
              onClick={() => onSelectSuggested(suggested)}
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Select {gradeLabel(suggested)}
            </Button>
          )}
          <Button variant="secondary" size="md" className="w-full sm:w-auto" disabled={running} onClick={() => void start(code)}>
            <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} aria-hidden="true" />
            {running ? 'Running checks…' : 'Re-run checks'}
          </Button>
        </div>
      </div>
      {run && (
        <details open={!allPassed || undefined} className="text-xs">
          <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 font-semibold text-ink-secondary">
            <ListChecks className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            Check details
          </summary>
          <CodeChecksList run={run} />
        </details>
      )}
    </section>
  )
}
