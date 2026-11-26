import { useCallback, useEffect, useRef, useState } from 'react'
import { failedCodeChecks, runCodeChecks, type CodeChecksRun } from './codeChecks'
import type { CodeRunnerCheck, CodeRunnerLanguage } from './codeRunner'

export interface CodeChecksState {
  running: boolean
  run: CodeChecksRun | null
  /** The code the shown results were run against. */
  ranCode: string | null
}

const IDLE: CodeChecksState = { running: false, run: null, ranCode: null }

/**
 * Runs checks in the browser worker. Results belong to the language and checks they ran with:
 * changing either drops finished and in-flight runs, as does a newer run or unmounting.
 */
export function useCodeChecks(language: CodeRunnerLanguage, checks: CodeRunnerCheck[]) {
  const checksKey = JSON.stringify([language, checks.map(({ id, name, code }) => [id, name, code])])
  const [state, setState] = useState<CodeChecksState & { checksKey: string }>({ ...IDLE, checksKey })
  const generation = useRef(0)
  const abortController = useRef<AbortController | null>(null)
  const latest = useRef({ language, checks })
  useEffect(() => {
    latest.current = { language, checks }
  })
  useEffect(() => () => {
    generation.current += 1
    abortController.current?.abort()
    abortController.current = null
  }, [])
  useEffect(() => {
    generation.current += 1
    abortController.current?.abort()
    abortController.current = null
  }, [checksKey])

  const start = useCallback(async (code: string) => {
    const current = ++generation.current
    abortController.current?.abort()
    const controller = new AbortController()
    abortController.current = controller
    const { language: runLanguage, checks: runChecks } = latest.current
    setState({ ...IDLE, running: true, checksKey })
    let run: CodeChecksRun
    try {
      run = await runCodeChecks({ language: runLanguage, code, checks: runChecks, signal: controller.signal })
    } catch (error: unknown) {
      run = failedCodeChecks(runChecks, error instanceof Error ? error.message : 'The code runner failed.')
    }
    if (current !== generation.current) return null
    setState({ running: false, run, ranCode: code, checksKey })
    return run
  }, [checksKey])

  const reset = useCallback(() => {
    generation.current += 1
    abortController.current?.abort()
    abortController.current = null
    setState({ ...IDLE, checksKey })
  }, [checksKey])

  // A run for other checks (or language) is not shown at all.
  const current = state.checksKey === checksKey ? state : { ...IDLE, checksKey }
  return { running: current.running, run: current.run, ranCode: current.ranCode, start, reset }
}
