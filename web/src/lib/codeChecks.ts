import { CODE_RUNNER_TIMEOUT_MS, type CodeRunnerCheck, type CodeRunnerLanguage } from './codeRunner'

/**
 * Automated code checks, run in this browser's code runner worker (never on the server).
 *
 * Each check runs the code and then the check in a fresh VM (codeRunner.worker.ts). The worker
 * is shared, so runs queue one at a time; a check that runs too long has its worker replaced,
 * and the remaining checks continue on the new one. When the code itself never finishes, every
 * remaining check fails with the same timeout instead of waiting again.
 */
export interface CodeCheckResult {
  id: string
  name: string
  passed: boolean
  timedOut: boolean
  error: string | null
  stdout: string
  durationMs: number
}

export interface CodeChecksRun {
  passed: number
  failed: number
  total: number
  timedOut: boolean
  results: CodeCheckResult[]
}

export interface RunChecksRequest {
  type: 'run_checks'
  id: string
  language: CodeRunnerLanguage
  code: string
  checks: CodeRunnerCheck[]
  /** The index of checks[0] in the whole run, so results line up after a worker restart. */
  startIndex: number
  timeoutMs: number
}

export type CodeChecksWorkerMessage =
  | { id: string; type: 'checks_started' }
  | { id: string; type: 'check_phase'; index: number; phase: 'student' | 'check' }
  | { id: string; type: 'check_result'; index: number; result: CodeCheckResult }
  | { id: string; type: 'checks_done' }

export interface RunCodeChecksOptions {
  language: CodeRunnerLanguage
  code: string
  checks: CodeRunnerCheck[]
  timeoutMs?: number
}

/** Loading the Ruby or JavaScript runtime the first time can take a while on a slow connection. */
const STARTUP_TIMEOUT_MS = 30_000
/** A fresh Ruby VM per check takes a moment to boot before the time limit applies. */
const PHASE_GRACE_MS = 1_000

let worker: Worker | null = null
let queue: Promise<unknown> = Promise.resolve()

function sharedWorker() {
  worker ??= new Worker(new URL('../components/shared/codeRunner.worker.ts', import.meta.url), { type: 'module' })
  return worker
}

function replaceWorker() {
  worker?.terminate()
  worker = null
}

export function summarizeCodeChecks(results: CodeCheckResult[]): CodeChecksRun {
  const passed = results.filter((result) => result.passed).length
  return {
    passed,
    failed: results.length - passed,
    total: results.length,
    timedOut: results.some((result) => result.timedOut),
    results,
  }
}

/** Runs `checks` against `code`. Never rejects: a broken runner fails the checks with its error. */
export function runCodeChecks({ language, code, checks, timeoutMs = CODE_RUNNER_TIMEOUT_MS }: RunCodeChecksOptions): Promise<CodeChecksRun> {
  const run = queue.then(() => runQueued(language, code, checks, timeoutMs))
  queue = run.catch(() => undefined)
  return run
}

async function runQueued(language: CodeRunnerLanguage, code: string, checks: CodeRunnerCheck[], timeoutMs: number): Promise<CodeChecksRun> {
  const results: CodeCheckResult[] = []
  while (results.length < checks.length) {
    const outcome = await runOnWorker(language, code, checks, results.length, timeoutMs)
    results.push(...outcome.results)
    const stop = outcome.stop ?? (outcome.results.length ? null : { reason: 'The code runner stopped before running the checks.', timedOut: false })
    if (stop) {
      const { reason, timedOut } = stop
      for (const check of checks.slice(results.length)) {
        results.push({ id: check.id, name: check.name, passed: false, timedOut, error: reason, stdout: '', durationMs: 0 })
      }
    }
  }
  return summarizeCodeChecks(results)
}

interface WorkerOutcome {
  results: CodeCheckResult[]
  /** Set when the remaining checks can't run: they all fail with this reason. */
  stop?: { reason: string; timedOut: boolean }
}

function runOnWorker(
  language: CodeRunnerLanguage,
  code: string,
  checks: CodeRunnerCheck[],
  startIndex: number,
  timeoutMs: number,
): Promise<WorkerOutcome> {
  return new Promise((resolve) => {
    const runner = sharedWorker()
    const id = crypto.randomUUID()
    const results: CodeCheckResult[] = []
    let timer: number | undefined
    let phase: { index: number; phase: 'student' | 'check'; startedAt: number } | null = null

    const finish = (outcome: WorkerOutcome) => {
      window.clearTimeout(timer)
      runner.removeEventListener('message', onMessage)
      runner.removeEventListener('error', onError)
      resolve(outcome)
    }
    const arm = (ms: number, onTimeout: () => void) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(onTimeout, ms)
    }
    const startupFailed = () => {
      replaceWorker()
      finish({ results, stop: { reason: 'The code runner did not start in time. Check your connection and run the checks again.', timedOut: true } })
    }
    const timedOut = () => {
      replaceWorker()
      const index = phase?.index ?? startIndex + results.length
      const check = checks[index]
      const message = `Stopped after ${timeoutMs}ms. The code may be running forever.`
      if (check) {
        results.push({
          id: check.id, name: check.name, passed: false, timedOut: true, error: message, stdout: '',
          durationMs: Math.round(performance.now() - (phase?.startedAt ?? performance.now())),
        })
      }
      // The code itself never finished, so it won't for the next check either.
      finish(phase?.phase === 'student' ? { results, stop: { reason: message, timedOut: true } } : { results })
    }
    function onMessage(event: MessageEvent<CodeChecksWorkerMessage>) {
      const message = event.data
      if (!message || message.id !== id) return
      if (message.type === 'check_phase') {
        if (phase?.index !== message.index) phase = { index: message.index, phase: message.phase, startedAt: performance.now() }
        else phase = { ...phase, phase: message.phase }
        arm(timeoutMs + PHASE_GRACE_MS, timedOut)
      } else if (message.type === 'check_result') {
        results.push(message.result)
        phase = null
        // The next check boots a fresh VM before its first phase message.
        arm(STARTUP_TIMEOUT_MS, timedOut)
      } else if (message.type === 'checks_done') {
        finish({ results })
      }
    }
    function onError(event: ErrorEvent) {
      replaceWorker()
      finish({ results, stop: { reason: event.message || 'The code runner failed to start.', timedOut: false } })
    }

    runner.addEventListener('message', onMessage)
    runner.addEventListener('error', onError)
    arm(STARTUP_TIMEOUT_MS, startupFailed)
    const request: RunChecksRequest = {
      type: 'run_checks', id, language, code, checks: checks.slice(startIndex), startIndex, timeoutMs,
    }
    runner.postMessage(request)
  })
}

/** "3 of 3 checks passed" or "1 of 3 checks failed". */
export function codeChecksSummary(run: Pick<CodeChecksRun, 'passed' | 'failed' | 'total'>): string {
  const noun = run.total === 1 ? 'check' : 'checks'
  return run.failed === 0 ? `${run.passed} of ${run.total} ${noun} passed` : `${run.failed} of ${run.total} ${noun} failed`
}
