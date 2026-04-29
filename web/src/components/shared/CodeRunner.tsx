import { useEffect, useRef, useState } from 'react'
import { Loader2, Play, Square, Terminal } from 'lucide-react'
import type { CodeRunnerLanguage } from '../../lib/codeRunner'

interface CodeRunnerProps {
  code: string
  language: CodeRunnerLanguage
  timeoutMs: number
}

interface RunResponse {
  id: string
  type: 'result'
  stdout: string
  stderr: string
  durationMs: number
}

interface RunStarted {
  id: string
  type: 'started'
}

type WorkerResponse = RunResponse | RunStarted

interface RunState {
  status: 'idle' | 'running' | 'success' | 'error' | 'timeout'
  stdout: string
  stderr: string
  durationMs: number | null
}

const EMPTY_STATE: RunState = {
  status: 'idle',
  stdout: '',
  stderr: '',
  durationMs: null,
}

export function CodeRunner({ code, language, timeoutMs }: CodeRunnerProps) {
  const [runState, setRunState] = useState<RunState>(EMPTY_STATE)
  const workerRef = useRef<Worker | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const runIdRef = useRef<string | null>(null)

  const stopWorker = () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    workerRef.current?.terminate()
    workerRef.current = null
    runIdRef.current = null
  }

  useEffect(() => stopWorker, [])

  const handleRun = () => {
    stopWorker()
    const runId = crypto.randomUUID()
    const startedAt = performance.now()
    const worker = new Worker(new URL('./codeRunner.worker.ts', import.meta.url), { type: 'module' })

    workerRef.current = worker
    runIdRef.current = runId
    setRunState({ status: 'running', stdout: '', stderr: '', durationMs: null })

    timeoutRef.current = window.setTimeout(() => {
      stopWorker()
      setRunState({
        status: 'timeout',
        stdout: '',
        stderr: 'Code runner did not start in time.',
        durationMs: Math.round(performance.now() - startedAt),
      })
    }, 30_000)

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== runIdRef.current) return
      if (event.data.type === 'started') {
        if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
        timeoutRef.current = window.setTimeout(() => {
          stopWorker()
          setRunState({
            status: 'timeout',
            stdout: '',
            stderr: `Execution stopped after ${timeoutMs}ms.`,
            durationMs: Math.round(performance.now() - startedAt),
          })
        }, timeoutMs + 250)
        return
      }

      const hasError = event.data.stderr.trim().length > 0
      stopWorker()
      setRunState({
        status: hasError ? 'error' : 'success',
        stdout: event.data.stdout,
        stderr: event.data.stderr,
        durationMs: event.data.durationMs,
      })
    }

    worker.onerror = (event) => {
      if (runId !== runIdRef.current) return
      stopWorker()
      setRunState({
        status: 'error',
        stdout: '',
        stderr: event.message || 'Code runner failed to start.',
        durationMs: Math.round(performance.now() - startedAt),
      })
    }

    worker.postMessage({ id: runId, code, language, timeoutMs })
  }

  const handleStop = () => {
    stopWorker()
    setRunState((current) => ({
      ...current,
      status: 'timeout',
      stderr: current.stderr || 'Execution stopped.',
      durationMs: current.durationMs,
    }))
  }

  const outputIsEmpty = !runState.stdout && !runState.stderr
  const languageLabel = language === 'ruby' ? 'Ruby' : 'JavaScript'

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Terminal className="h-4 w-4 text-slate-500" />
          Browser Runner
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">{languageLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {runState.status === 'running' ? (
            <button
              type="button"
              onClick={handleStop}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRun}
              disabled={!code.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              Run
            </button>
          )}
        </div>
      </div>
      <div className="min-h-24 bg-slate-950 px-3 py-3 font-mono text-xs leading-6 text-slate-100">
        {runState.status === 'running' && (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Running in browser...
          </div>
        )}
        {runState.status !== 'running' && outputIsEmpty && (
          <p className="text-slate-500">Output will appear here.</p>
        )}
        {runState.stdout && <pre className="whitespace-pre-wrap break-words text-slate-100">{runState.stdout}</pre>}
        {runState.stderr && <pre className="whitespace-pre-wrap break-words text-red-300">{runState.stderr}</pre>}
      </div>
      <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-3 py-1.5 text-[11px] text-slate-400">
        <span>{runState.status === 'timeout' ? 'Stopped' : runState.status === 'error' ? 'Finished with errors' : runState.status === 'success' ? 'Finished' : 'Ready'}</span>
        <span>{runState.durationMs === null ? `${timeoutMs}ms limit` : `${runState.durationMs}ms`}</span>
      </div>
    </div>
  )
}
