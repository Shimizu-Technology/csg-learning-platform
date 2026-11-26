import { newQuickJSWASMModule, newVariant, RELEASE_SYNC, shouldInterruptAfterDeadline } from 'quickjs-emscripten'
import type { QuickJSHandle } from 'quickjs-emscripten'
import { DefaultRubyVM } from '@ruby/wasm-wasi/dist/browser'
import quickJsWasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url'
import rubyWasmUrl from '@ruby/3.3-wasm-wasi/dist/ruby+stdlib.wasm?url'
import type { CodeRunnerCheck, CodeRunnerLanguage } from '../../lib/codeRunner'
import type { CodeCheckResult, CodeChecksWorkerMessage, RunChecksRequest } from '../../lib/codeChecks'

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

const quickJsModulePromise = newQuickJSWASMModule(
  newVariant(RELEASE_SYNC, { wasmLocation: quickJsWasmUrl })
)
let rubyModulePromise: Promise<WebAssembly.Module> | null = null

function getRubyModule() {
  rubyModulePromise ??= fetch(rubyWasmUrl)
    .then((response) => response.arrayBuffer())
    .then((buffer) => WebAssembly.compile(buffer))
  return rubyModulePromise
}

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
    const module = await getRubyModule()
    const { vm } = await DefaultRubyVM(module, { consolePrint: true })
    self.postMessage({ id, type: 'started' })
    try {
      vm.eval(code)
    } catch (error: unknown) {
      captureRubyOutput([error instanceof Error ? error.message : String(error)], stderr)
    }
  } finally {
    console.log = originalLog
    console.warn = originalWarn
  }

  return { stdout: stdout.join(''), stderr: stderr.join('') }
}

// ─── Automated checks ────────────────────────────────────────────────────────
//
// Every check gets a fresh VM: the student's code runs in it, its printed
// output becomes `output`, then the check runs with the assertion helpers. A
// check can't see another check's globals or stop the others. The helpers are
// built before the student's code runs, from captured built-ins, and reach the
// check as parameters, so the student's code can't replace them.

const JS_HELPERS = `(() => {
  const isArray = Array.isArray, keys = Object.keys, getProto = Object.getPrototypeOf, objectProto = Object.prototype,
    stringify = JSON.stringify, toText = String, ErrorType = Error, apply = Reflect.apply,
    stringIncludes = String.prototype.includes, hasOwn = Object.prototype.hasOwnProperty;
  const format = (value) => {
    if (value === undefined) return 'undefined';
    try { const text = stringify(value); return text === undefined ? toText(value) : text } catch { return toText(value) }
  };
  const plain = (value) => value !== null && typeof value === 'object' && (getProto(value) === objectProto || getProto(value) === null);
  const equal = (a, b) => {
    if (a === b || (a !== a && b !== b)) return true;
    if (isArray(a) && isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) if (!equal(a[i], b[i])) return false;
      return true;
    }
    if (plain(a) && plain(b)) {
      const aKeys = keys(a), bKeys = keys(b);
      if (aKeys.length !== bKeys.length) return false;
      for (let i = 0; i < aKeys.length; i += 1) {
        const key = aKeys[i];
        if (!apply(hasOwn, b, [key]) || !equal(a[key], b[key])) return false;
      }
      return true;
    }
    return false;
  };
  const fail = (message, fallback) => { throw new ErrorType(message === undefined || message === null ? fallback : toText(message)) };
  return {
    assert(condition, message) { if (!condition) fail(message, 'Assertion failed') },
    assertEqual(expected, actual, message) {
      if (!equal(expected, actual)) fail(message, 'Expected ' + format(expected) + ', got ' + format(actual));
    },
    assertIncludes(collection, item, message) {
      let found = false;
      if (typeof collection === 'string') found = apply(stringIncludes, collection, [toText(item)]);
      else if (isArray(collection)) for (let i = 0; i < collection.length && !found; i += 1) found = equal(collection[i], item);
      if (!found) fail(message, 'Expected ' + format(collection) + ' to include ' + format(item));
    },
  };
})()`

const RUBY_HELPERS = `
require "stringio"

class CSGCheckFailure < StandardError; end

class CSGCheckContext
  def initialize(output)
    @output = output.dup.freeze
  end

  def output
    @output
  end

  def assert(condition, message = "Assertion failed")
    raise CSGCheckFailure, message.to_s unless condition
  end

  def assert_equal(expected, actual, message = nil)
    return if expected == actual

    raise CSGCheckFailure, (message || "Expected #{expected.inspect}, got #{actual.inspect}").to_s
  end

  def assert_includes(collection, item, message = nil)
    return if collection.respond_to?(:include?) && collection.include?(item)

    raise CSGCheckFailure, (message || "Expected #{collection.inspect} to include #{item.inspect}").to_s
  end
end

module CSGCheckRunner
  def self.run_student(source, out)
    previous = $stdout
    $stdout = out
    TOPLEVEL_BINDING.eval(source, "student.rb", 1)
    ""
  rescue Exception => error
    "#{error.class}: #{error.message}"
  ensure
    $stdout = previous
  end

  def self.run_check(context, source)
    context.instance_eval(source, "check.rb", 1)
    ""
  rescue CSGCheckFailure => failure
    failure.message.empty? ? "Assertion failed" : failure.message
  rescue Exception => error
    "#{error.class}: #{error.message}"
  end
end

[CSGCheckFailure, CSGCheckContext, CSGCheckRunner].each(&:freeze)
`

function base64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

const studentErrorMessage = (error: string) => `Your code raised an error: ${error.trim()}`
const timeoutMessage = (timeoutMs: number) => `Stopped after ${timeoutMs}ms. The code may be running forever.`

function quickJsErrorMessage(value: unknown) {
  if (value && typeof value === 'object' && 'message' in value) {
    const { name, message } = value as { name?: unknown; message?: unknown }
    return name && name !== 'Error' ? `${String(name)}: ${String(message)}` : String(message)
  }
  return stringifyQuickJsValue(value)
}

function isQuickJsInterrupt(value: unknown) {
  return Boolean(value && typeof value === 'object' && (value as { name?: unknown }).name === 'InternalError' &&
    String((value as { message?: unknown }).message).includes('interrupted'))
}

async function runJavaScriptCheck(
  post: (message: CodeChecksWorkerMessage) => void,
  index: number,
  studentCode: string,
  check: CodeRunnerCheck,
  timeoutMs: number,
): Promise<Omit<CodeCheckResult, 'id' | 'name' | 'durationMs'>> {
  const quickjs = await quickJsModulePromise
  const runtime = quickjs.newRuntime({
    interruptHandler: shouldInterruptAfterDeadline(Date.now() + timeoutMs),
    memoryLimitBytes: 8 * 1024 * 1024,
    maxStackSizeBytes: 512 * 1024,
  })
  const vm = runtime.newContext()
  const stdout: string[] = []
  const handles: QuickJSHandle[] = []
  const keep = (handle: QuickJSHandle) => {
    handles.push(handle)
    return handle
  }
  const fail = (error: unknown, fromStudent: boolean) => {
    if (isQuickJsInterrupt(error)) return { passed: false, timedOut: true, error: timeoutMessage(timeoutMs), stdout: stdout.join('') }
    const message = quickJsErrorMessage(error)
    return { passed: false, timedOut: false, error: fromStudent ? studentErrorMessage(message) : message, stdout: stdout.join('') }
  }

  try {
    const consoleHandle = keep(vm.newObject())
    const log = keep(vm.newFunction('log', (...args) => {
      stdout.push(`${args.map((value) => stringifyQuickJsValue(vm.dump(value))).join(' ')}\n`)
      return vm.undefined
    }))
    const quiet = keep(vm.newFunction('warn', () => vm.undefined))
    for (const name of ['log', 'info']) vm.setProp(consoleHandle, name, log)
    for (const name of ['warn', 'error']) vm.setProp(consoleHandle, name, quiet)
    vm.setProp(vm.global, 'console', consoleHandle)
    vm.setProp(vm.global, 'print', log)

    const helpersResult = vm.evalCode(JS_HELPERS, 'helpers.js')
    if (helpersResult.error) {
      const error = vm.dump(helpersResult.error)
      helpersResult.error.dispose()
      return fail(error, false)
    }
    const helpers = keep(helpersResult.value)
    const helperArgs = ['assert', 'assertEqual', 'assertIncludes'].map((name) => keep(vm.getProp(helpers, name)))

    post({ id: '', type: 'check_phase', index, phase: 'student' })
    const studentResult = vm.evalCode(studentCode, 'student.js')
    if (studentResult.error) {
      const error = vm.dump(studentResult.error)
      studentResult.error.dispose()
      return fail(error, true)
    }
    studentResult.value.dispose()

    post({ id: '', type: 'check_phase', index, phase: 'check' })
    const output = keep(vm.newString(stdout.join('')))
    const fnResult = vm.evalCode(`(function (assert, assertEqual, assertIncludes, output) {\n${check.code}\n})`, 'check.js')
    if (fnResult.error) {
      const error = vm.dump(fnResult.error)
      fnResult.error.dispose()
      return fail(error, false)
    }
    const fn = keep(fnResult.value)
    const callResult = vm.callFunction(fn, vm.undefined, [...helperArgs, output])
    if (callResult.error) {
      const error = vm.dump(callResult.error)
      callResult.error.dispose()
      return fail(error, false)
    }
    callResult.value.dispose()
    return { passed: true, timedOut: false, error: null, stdout: stdout.join('') }
  } finally {
    handles.reverse().forEach((handle) => handle.alive && handle.dispose())
    vm.dispose()
    runtime.dispose()
  }
}

async function runRubyCheck(
  post: (message: CodeChecksWorkerMessage) => void,
  index: number,
  studentCode: string,
  check: CodeRunnerCheck,
): Promise<Omit<CodeCheckResult, 'id' | 'name' | 'durationMs'>> {
  const module = await getRubyModule()
  const originalLog = console.log
  const originalWarn = console.warn
  // Printing goes to a StringIO; anything else the VM writes is dropped.
  console.log = () => {}
  console.warn = () => {}
  try {
    const { vm } = await DefaultRubyVM(module, { consolePrint: false })
    vm.eval(RUBY_HELPERS)
    // Every Ruby value the check needs is made before the student's code can redefine anything.
    const rubyString = (text: string) => vm.eval(`"${base64(text)}".unpack1("m").force_encoding(Encoding::UTF_8)`)
    const studentSource = rubyString(studentCode)
    const checkSource = rubyString(check.code)
    const contextClass = vm.eval('CSGCheckContext')
    const runner = vm.eval('CSGCheckRunner')
    const out = vm.eval('StringIO.new')

    post({ id: '', type: 'check_phase', index, phase: 'student' })
    const studentError = runner.call('run_student', studentSource, out).toString()
    const stdout = out.call('string').toString()
    if (studentError) return { passed: false, timedOut: false, error: studentErrorMessage(studentError), stdout }

    post({ id: '', type: 'check_phase', index, phase: 'check' })
    const context = contextClass.call('new', out.call('string'))
    const checkError = runner.call('run_check', context, checkSource).toString()
    return { passed: !checkError, timedOut: false, error: checkError || null, stdout }
  } finally {
    console.log = originalLog
    console.warn = originalWarn
  }
}

async function runChecks(request: RunChecksRequest) {
  const post = (message: CodeChecksWorkerMessage) => self.postMessage({ ...message, id: request.id })
  post({ id: request.id, type: 'checks_started' })
  for (const [offset, check] of request.checks.entries()) {
    const index = request.startIndex + offset
    const startedAt = performance.now()
    let outcome: Omit<CodeCheckResult, 'id' | 'name' | 'durationMs'>
    try {
      outcome = request.language === 'ruby'
        ? await runRubyCheck(post, index, request.code, check)
        : await runJavaScriptCheck(post, index, request.code, check, request.timeoutMs)
    } catch (error: unknown) {
      outcome = { passed: false, timedOut: false, error: error instanceof Error ? error.message : String(error), stdout: '' }
    }
    post({
      id: request.id,
      type: 'check_result',
      index,
      result: { id: check.id, name: check.name, ...outcome, durationMs: Math.round(performance.now() - startedAt) },
    })
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
