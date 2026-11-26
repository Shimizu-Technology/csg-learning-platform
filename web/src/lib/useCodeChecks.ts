import { useCallback, useEffect, useRef, useState } from 'react'
import { runCodeChecks, type CodeChecksRun } from './codeChecks'
import type { CodeRunnerCheck, CodeRunnerLanguage } from './codeRunner'

export interface CodeChecksState {
  running: boolean
  run: CodeChecksRun | null
  /** The code the shown results were run against. */
  ranCode: string | null
}

/** Runs checks in the browser worker; a newer run (or unmounting) drops an older run's results. */
export function useCodeChecks(language: CodeRunnerLanguage, checks: CodeRunnerCheck[]) {
  const [state, setState] = useState<CodeChecksState>({ running: false, run: null, ranCode: null })
  const generation = useRef(0)
  useEffect(() => () => {
    generation.current += 1
  }, [])

  const start = useCallback(async (code: string) => {
    const current = ++generation.current
    setState((previous) => ({ ...previous, running: true }))
    const run = await runCodeChecks({ language, code, checks })
    if (current !== generation.current) return null
    setState({ running: false, run, ranCode: code })
    return run
  }, [language, checks])

  const reset = useCallback(() => {
    generation.current += 1
    setState({ running: false, run: null, ranCode: null })
  }, [])

  return { ...state, start, reset }
}
