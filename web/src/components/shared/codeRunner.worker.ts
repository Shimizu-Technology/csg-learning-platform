import { newQuickJSWASMModule, newVariant, RELEASE_SYNC, shouldInterruptAfterDeadline } from 'quickjs-emscripten'
import type { QuickJSHandle } from 'quickjs-emscripten'
import { DefaultRubyVM } from '@ruby/wasm-wasi/dist/browser'
import quickJsWasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url'
import rubyWasmUrl from '@ruby/3.3-wasm-wasi/dist/ruby+stdlib.wasm?url'
import type { CodeRunnerLanguage } from '../../lib/codeRunner'

interface RunRequest {
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

const quickJsModulePromise = newQuickJSWASMModule(
  newVariant(RELEASE_SYNC, { wasmLocation: quickJsWasmUrl })
)
const rubyModulePromise = fetch(rubyWasmUrl)
  .then((response) => response.arrayBuffer())
  .then((buffer) => WebAssembly.compile(buffer))

function stringifyQuickJsValue(value: unknown) {
  if (typeof value === 'string') return value
  if (typeof value === 'undefined') return 'undefined'

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

async function runJavaScript(id: string, code: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  const quickjs = await quickJsModulePromise
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

function captureRubyOutput(args: unknown[], stream: string[]) {
  const text = args.map(String).join(' ')
  stream.push(text.endsWith('\n') ? text : `${text}\n`)
}

async function runRuby(id: string, code: string): Promise<{ stdout: string; stderr: string }> {
  const stdout: string[] = []
  const stderr: string[] = []
  const originalLog = console.log
  const originalWarn = console.warn

  console.log = (...args: unknown[]) => {
    captureRubyOutput(args, stdout)
  }
  console.warn = (...args: unknown[]) => {
    captureRubyOutput(args, stderr)
  }

  try {
    const module = await rubyModulePromise
    const { vm } = await DefaultRubyVM(module, { consolePrint: true })
    self.postMessage({ id, type: 'started' })
    vm.eval(code)
  } finally {
    console.log = originalLog
    console.warn = originalWarn
  }

  return { stdout: stdout.join(''), stderr: stderr.join('') }
}

self.onmessage = (event: MessageEvent<RunRequest>) => {
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
