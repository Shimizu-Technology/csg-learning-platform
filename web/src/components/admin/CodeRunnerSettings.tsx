import { useEffect, useId, useState } from 'react'
import { ArrowDown, ArrowUp, ListChecks, Loader2, Play, Plus, Trash2 } from 'lucide-react'
import {
  CODE_RUNNER_LIMITS,
  newCheckId,
  type CodeRunnerCheck,
  type CodeRunnerConfig,
  type CodeRunnerLanguage,
} from '../../lib/codeRunner'
import { useCodeChecks } from '../../lib/useCodeChecks'
import { CodeChecksResults } from '../shared/CodeChecksResults'
import { Button, IconButton } from '../ui/Button'

interface CodeRunnerSettingsProps {
  value: CodeRunnerConfig
  onChange: (value: CodeRunnerConfig) => void
  compact?: boolean
}

const CHECK_HINTS: Record<CodeRunnerLanguage, { helpers: string[]; example: string }> = {
  ruby: { helpers: ['assert_equal(expected, actual)', 'assert(condition)', 'output'], example: 'assert_equal 10, add(4, 6)' },
  javascript: { helpers: ['assertEqual(expected, actual)', 'assert(condition)', 'output'], example: 'assertEqual(10, add(4, 6))' },
}

export function CodeRunnerSettings({ value, onChange, compact = false }: CodeRunnerSettingsProps) {
  const id = useId()
  const update = (patch: Partial<CodeRunnerConfig>) => {
    onChange({ ...value, ...patch })
  }
  const checks = value.checks ?? []
  const starterCode = value.starterCode ?? ''
  const updateChecks = (next: CodeRunnerCheck[]) => update({ checks: next })
  const updateCheck = (index: number, patch: Partial<CodeRunnerCheck>) =>
    updateChecks(checks.map((check, checkIndex) => (checkIndex === index ? { ...check, ...patch } : check)))
  const moveCheck = (index: number, offset: -1 | 1) => {
    const next = [...checks]
    const [moved] = next.splice(index, 1)
    next.splice(index + offset, 0, moved)
    updateChecks(next)
  }
  const [testCode, setTestCode] = useState('')
  const runnableChecks = checks.filter((check) => check.name.trim() && check.code.trim())
  const codeChecks = useCodeChecks(value.language, runnableChecks)
  const codeToTest = testCode.trim() ? testCode : starterCode
  // Results belong to the checks and code they ran with (useCodeChecks drops them when the checks
  // or language change); a different test code drops them too, finished or still running.
  const { reset: resetChecks } = codeChecks
  useEffect(() => {
    resetChecks()
  }, [codeToTest, resetChecks])
  const hint = CHECK_HINTS[value.language]

  return (
    <div className={`rounded-xl border border-line bg-surface-sunken ${compact ? 'p-3' : 'p-4'}`}>
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
          className="mt-1 rounded border-line-strong text-primary-ink"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Play className="h-4 w-4 text-ink-muted" />
            Enable browser code runner
          </span>
          <span className="mt-1 block text-xs leading-5 text-ink-muted">
            Students can run Ruby or JavaScript in the browser for practice. Automated checks help you review; they never grade or submit work.
          </span>
        </span>
      </label>

      {value.enabled && (
        <div className={`space-y-4 ${compact ? 'mt-3' : 'mt-4'}`}>
          <label className={`block ${compact ? '' : 'max-w-sm'}`}>
            <span className="mb-1 block text-xs font-semibold text-ink-secondary">Runner language</span>
            <select
              value={value.language}
              onChange={(event) => update({ language: event.target.value as CodeRunnerLanguage })}
              className="app-control w-full"
            >
              <option value="ruby">Ruby</option>
              <option value="javascript">JavaScript</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-secondary">Starter code (optional)</span>
            <textarea
              value={starterCode}
              onChange={(event) => update({ starterCode: event.target.value })}
              maxLength={CODE_RUNNER_LIMITS.starterCode}
              rows={5}
              spellCheck={false}
              placeholder={value.language === 'ruby' ? 'def add(a, b)\n  # write your code here\nend' : 'function add(a, b) {\n  // write your code here\n}'}
              className="app-control block w-full font-mono text-xs leading-5"
            />
            <span className="mt-1 block text-xs text-ink-muted">Students start from this until they save a draft or submit.</span>
          </label>

          <fieldset className="min-w-0 space-y-3">
            <legend className="flex w-full items-center justify-between gap-2 text-xs font-semibold text-ink-secondary">
              <span className="flex items-center gap-1.5">
                <ListChecks className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
                Automated checks
              </span>
              <span className="font-normal tabular-nums text-ink-muted">{checks.length} of {CODE_RUNNER_LIMITS.checks}</span>
            </legend>
            <p id={`${id}-hint`} className="text-xs leading-5 text-ink-muted">
              Each check runs after the student's code, in a fresh copy. Use{' '}
              {hint.helpers.map((helper, index) => (
                <span key={helper}>
                  <code className="rounded bg-line/60 px-1 font-mono text-ink-secondary">{helper}</code>
                  {index < hint.helpers.length - 2 ? ', ' : index === hint.helpers.length - 2 ? ' and ' : ''}
                </span>
              ))}{' '}
              (what the code printed). Example: <code className="rounded bg-line/60 px-1 font-mono text-ink-secondary">{hint.example}</code>
              {value.language === 'ruby' && ". Ruby's built-in classes are frozen while checks run, so code that reopens String or Integer fails them."}
            </p>
            {checks.map((check, index) => (
              <div key={check.id} data-runner-check={check.id} className="space-y-2 rounded-xl border border-line bg-surface-raised p-3">
                <div className="flex items-center gap-1">
                  <input
                    value={check.name}
                    onChange={(event) => updateCheck(index, { name: event.target.value })}
                    maxLength={CODE_RUNNER_LIMITS.checkName}
                    aria-label={`Check ${index + 1} name`}
                    placeholder="Adds two numbers"
                    className="app-control min-w-0 flex-1 text-sm"
                  />
                  <IconButton size="sm" label={`Move check ${index + 1} up`} disabled={index === 0} onClick={() => moveCheck(index, -1)}>
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton size="sm" label={`Move check ${index + 1} down`} disabled={index === checks.length - 1} onClick={() => moveCheck(index, 1)}>
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton size="sm" variant="danger" label={`Remove check ${index + 1}`} onClick={() => updateChecks(checks.filter((_, checkIndex) => checkIndex !== index))}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                </div>
                <textarea
                  value={check.code}
                  onChange={(event) => updateCheck(index, { code: event.target.value })}
                  maxLength={CODE_RUNNER_LIMITS.checkCode}
                  aria-label={`Check ${index + 1} code`}
                  aria-describedby={`${id}-hint`}
                  rows={3}
                  spellCheck={false}
                  placeholder={hint.example}
                  className="app-control block w-full font-mono text-xs leading-5"
                />
                {(!check.name.trim() || !check.code.trim()) && (
                  <p className="text-xs text-warning-ink">Give this check a name and check code before saving.</p>
                )}
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              disabled={checks.length >= CODE_RUNNER_LIMITS.checks}
              onClick={() => updateChecks([...checks, { id: newCheckId(checks), name: '', code: '' }])}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add check
            </Button>
          </fieldset>

          {checks.length > 0 && (
            <div className="space-y-2 border-t border-line pt-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-secondary">Test code (optional)</span>
                <textarea
                  value={testCode}
                  onChange={(event) => setTestCode(event.target.value)}
                  rows={4}
                  spellCheck={false}
                  placeholder="Paste a solution to try the checks. Empty uses the starter code."
                  className="app-control block w-full font-mono text-xs leading-5"
                />
              </label>
              <Button
                variant="secondary"
                size="sm"
                disabled={codeChecks.running || !runnableChecks.length || !codeToTest.trim()}
                onClick={() => void codeChecks.start(codeToTest)}
              >
                {codeChecks.running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ListChecks className="h-4 w-4" aria-hidden="true" />}
                {codeChecks.running ? 'Testing checks…' : 'Test checks'}
              </Button>
              {!codeToTest.trim() && <p className="text-xs text-ink-muted">Add starter code or test code to try the checks.</p>}
              {codeChecks.run && <CodeChecksResults run={codeChecks.run} />}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
