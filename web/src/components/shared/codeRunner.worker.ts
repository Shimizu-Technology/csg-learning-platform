import { newQuickJSWASMModule, newVariant, RELEASE_SYNC, shouldInterruptAfterDeadline } from 'quickjs-emscripten'
import type { QuickJSHandle } from 'quickjs-emscripten'
import quickJsWasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url'
import rubyWasmUrl from '@ruby/3.3-wasm-wasi/dist/ruby+stdlib.wasm?url'
import type { CodeRunnerLanguage } from '../../lib/codeRunner'
import type { CodeCheckResult, CodeChecksWorkerMessage, RunChecksRequest } from '../../lib/codeChecks'
import { runJavaScriptCheck, runRubyCheck, runRubyProgram, stringifyQuickJsValue, type SandboxCheckOutcome } from '../../lib/codeSandbox'

interface RunRequest {
  type?: 'run'
  id: string
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

let quickJsModulePromise: ReturnType<typeof newQuickJSWASMModule> | null = null
let rubyModulePromise: Promise<WebAssembly.Module> | null = null

function getQuickJsModule() {
  quickJsModulePromise ??= newQuickJSWASMModule(
    newVariant(RELEASE_SYNC, { wasmLocation: quickJsWasmUrl })
  ).catch((error: unknown) => {
    quickJsModulePromise = null
    throw error
  })
  return quickJsModulePromise
}

function getRubyModule() {
  rubyModulePromise ??= fetch(rubyWasmUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load Ruby runtime (HTTP ${response.status}).`)
      return response.arrayBuffer()
    })
    .then((buffer) => WebAssembly.compile(buffer))
    .catch((error: unknown) => {
      rubyModulePromise = null
      throw error
    })
  return rubyModulePromise
}

async function runJavaScript(id: string, code: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  const quickjs = await getQuickJsModule()
  const runtime = quickjs.newRuntime({
    interruptHandler: shouldInterruptAfterDeadline(Date.now() + timeoutMs),
    memoryLimitBytes: 8 * 1024 * 1024,
    maxStackSizeBytes: 512 * 1024,
  })
  const vm = runtime.newContext()
  const stdout: string[] = []
  const stderr: string[] = []

  const writeConsole = (stream: 'stdout' | 'stderr', values: QuickJSHandle[]) => {
    const line = values.map((value) => stringifyQuickJsValue(vm.dump(value))).join(' ')
    if (stream === 'stderr') {
      stderr.push(`${line}\n`)
    } else {
      stdout.push(`${line}\n`)
    }
  }

  try {
    const consoleHandle = vm.newObject()
    const logHandle = vm.newFunction('log', (...args) => {
      writeConsole('stdout', args)
      return vm.undefined
    })
    const warnHandle = vm.newFunction('warn', (...args) => {
      writeConsole('stderr', args)
      return vm.undefined
    })
    const printHandle = vm.newFunction('print', (...args) => {
      writeConsole('stdout', args)
      return vm.undefined
    })

    vm.setProp(consoleHandle, 'log', logHandle)
    vm.setProp(consoleHandle, 'info', logHandle)
    vm.setProp(consoleHandle, 'warn', warnHandle)
    vm.setProp(consoleHandle, 'error', warnHandle)
    vm.setProp(vm.global, 'console', consoleHandle)
    vm.setProp(vm.global, 'print', printHandle)

    logHandle.dispose()
    warnHandle.dispose()
    printHandle.dispose()
    consoleHandle.dispose()

    self.postMessage({ id, type: 'started' })

    const result = vm.evalCode(code, 'student.js')

    if (result.error) {
      stderr.push(`${stringifyQuickJsValue(vm.dump(result.error))}\n`)
      result.error.dispose()
    } else {
      result.value.dispose()
    }
  } finally {
    vm.dispose()
    runtime.dispose()
  }

  return { stdout: stdout.join(''), stderr: stderr.join('') }
}

// Ruby runs in a fresh sandbox with no JavaScript bridge (codeSandbox.ts).
async function runRuby(id: string, code: string): Promise<{ stdout: string; stderr: string }> {
  const module = await getRubyModule()
  self.postMessage({ id, type: 'started' })
  return runRubyProgram(module, code)
}

// ─── Automated checks ────────────────────────────────────────────────────────
//
// Every check gets a fresh VM (codeSandbox.ts): the student's code runs in it, its printed output
// becomes `output`, then the check runs with the assertion helpers.

async function runChecks(request: RunChecksRequest) {
  const post = (message: CodeChecksWorkerMessage) => self.postMessage({ ...message, id: request.id })
  post({ id: request.id, type: 'checks_started' })
  for (const [offset, check] of request.checks.entries()) {
    const index = request.startIndex + offset
    const startedAt = performance.now()
    let phase: 'student' | 'check' | null = null
    const onPhase = (next: 'student' | 'check') => {
      phase = next
      post({ id: request.id, type: 'check_phase', index, phase: next })
    }
    let outcome: SandboxCheckOutcome
    try {
      outcome = request.language === 'ruby'
        ? await runRubyCheck(await getRubyModule(), request.code, check, { onPhase })
        : runJavaScriptCheck(await getQuickJsModule(), request.code, check, request.timeoutMs, { onPhase })
    } catch (error: unknown) {
      outcome = { passed: false, timedOut: false, error: error instanceof Error ? error.message : String(error), stdout: '' }
    }
    post({
      id: request.id,
      type: 'check_result',
      index,
      result: { id: check.id, name: check.name, ...outcome, durationMs: Math.round(performance.now() - startedAt) },
    })
    // The student's own code ran out of time: it won't finish for the next check either.
    if (outcome.timedOut && phase === 'student') {
      for (const [rest, skipped] of request.checks.slice(offset + 1).entries()) {
        const result: CodeCheckResult = { id: skipped.id, name: skipped.name, passed: false, timedOut: true, error: outcome.error, stdout: '', durationMs: 0 }
        post({ id: request.id, type: 'check_result', index: index + 1 + rest, result })
      }
      break
    }
  }
  post({ id: request.id, type: 'checks_done' })
}

self.onmessage = (event: MessageEvent<RunRequest | RunChecksRequest>) => {
  if (event.data.type === 'run_checks') {
    void runChecks(event.data)
    return
  }
  const startedAt = performance.now()
  const { id, code, language, timeoutMs } = event.data

  const run = language === 'ruby' ? runRuby(id, code) : runJavaScript(id, code, timeoutMs)

  run
    .then(({ stdout, stderr }) => {
      const response: RunResponse = {
        id,
        type: 'result',
        stdout,
        stderr,
        durationMs: Math.round(performance.now() - startedAt),
      }
      self.postMessage(response)
    })
    .catch((error: unknown) => {
      const response: RunResponse = {
        id,
        type: 'result',
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(performance.now() - startedAt),
      }
      self.postMessage(response)
    })
}
