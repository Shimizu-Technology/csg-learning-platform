import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { codeChecksSummary, type CodeChecksRun } from '../../lib/codeChecks'

/** One line per check: pass, fail or timed out, with the failure message. */
export function CodeChecksList({ run, className = '' }: { run: CodeChecksRun; className?: string }) {
  return (
    <ul aria-label="Check results" className={`divide-y divide-line rounded-xl border border-line bg-surface-sunken ${className}`}>
      {run.results.map((result) => (
        <li key={result.id} data-check-result={result.passed ? 'passed' : result.timedOut ? 'timed_out' : 'failed'} className="flex min-w-0 items-start gap-2 px-3 py-2 text-sm">
          {result.passed ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-ink" aria-hidden="true" />
          ) : result.timedOut ? (
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" aria-hidden="true" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-ink" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink [overflow-wrap:anywhere]">
              <span className="sr-only">{result.passed ? 'Passed: ' : result.timedOut ? 'Timed out: ' : 'Failed: '}</span>
              {result.name}
            </p>
            {result.error && <p className="mt-0.5 whitespace-pre-wrap font-mono text-xs leading-5 text-ink-secondary [overflow-wrap:anywhere]">{result.error}</p>}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** The summary line ("3 of 3 checks passed") with the per-check list under it. */
export function CodeChecksResults({ run }: { run: CodeChecksRun }) {
  const allPassed = run.failed === 0
  return (
    <div className="space-y-2" data-code-checks={allPassed ? 'passed' : 'failed'}>
      <p role="status" className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${allPassed ? 'border-success-line bg-success-soft text-success-ink' : 'border-danger-line bg-danger-soft text-danger-ink'}`}>
        {allPassed ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
        {codeChecksSummary(run)}
      </p>
      <CodeChecksList run={run} />
    </div>
  )
}
