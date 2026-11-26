import { ConsoleStdout, Fd, File, OpenFile, PreopenDirectory, WASI, wasi as wasiDefs } from '@bjorn3/browser_wasi_shim'
import { RubyVM } from '@ruby/wasm-wasi'
import { shouldInterruptAfterDeadline, type QuickJSHandle, type QuickJSWASMModule } from 'quickjs-emscripten'
import type { CodeRunnerCheck } from './codeRunner'

/**
 * The code runner's sandboxes, shared by the browser worker (codeRunner.worker.ts) and the
 * real-runtime tests. Nothing here reaches the page: the worker owns the globals.
 *
 * Ruby runs in a fresh WASI instance for every run, with Ruby's JavaScript bridge removed at the
 * WebAssembly import boundary: every `rb-js-abi-host` import throws, so `require "js"` or
 * `JS.global` stops the run instead of reaching the worker's globals, network or messages.
 * Printed output is captured at the WASI file layer, not through Ruby objects.
 *
 * A check's verdict never comes from a Ruby value. The harness reads a random 256-bit nonce
 * from a one-shot stdin before the student's code runs, keeps it in a closure the student's
 * code can't reach (ObjectSpace walking, TracePoint, set_trace_func and callcc are removed, and
 * Ruby's core classes are frozen), and writes `<nonce> PASS` or `<nonce> FAIL ...` to stderr.
 * Assertions compare through method objects captured before the student's code runs, so
 * redefining `==`, `raise` or `to_s` can't turn a failure into a pass. Anything unexpected (no
 * verdict, two verdicts, the VM stopping) counts as a failure.
 */

export interface SandboxCheckOutcome {
  passed: boolean
  timedOut: boolean
  error: string | null
  stdout: string
}

export interface SandboxHooks {
  /** The student's code started running, or finished and the check started. */
  onPhase?: (phase: 'student' | 'check') => void
}

export const JS_BRIDGE_DISABLED = 'JavaScript access is turned off in the code runner.'
export const studentErrorMessage = (error: string) => `Your code raised an error: ${error.trim()}`
export const timeoutMessage = (timeoutMs: number) => `Stopped after ${timeoutMs}ms. The code may be running forever.`
const NO_VERDICT = 'The check stopped before it could report a result.'

// ─── Ruby ────────────────────────────────────────────────────────────────────

const RUBY_ARGS = ['ruby.wasm', '--disable-gems', '-EUTF-8', '-W0', '-e_=0']

/** A stdin that hands out its bytes once and can't be rewound or re-read. */
class OneShotStdin extends Fd {
  private data: Uint8Array
  constructor(text: string) {
    super()
    this.data = new TextEncoder().encode(text)
  }
  fd_fdstat_get() {
    return { ret: 0, fdstat: new wasiDefs.Fdstat(wasiDefs.FILETYPE_CHARACTER_DEVICE, 0) }
  }
  fd_read(size: number) {
    const slice = this.data.slice(0, size)
    this.data = this.data.subarray(slice.length)
    return { ret: 0, data: slice }
  }
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

interface RubySandbox {
  vm: RubyVM
  stdout: () => string
  stderr: () => string
}

/** A fresh Ruby VM with no JavaScript bridge, its output captured at the WASI file layer. */
async function rubySandbox(module: WebAssembly.Module, files: Record<string, string>, stdin: string, onStderr?: (text: string) => void): Promise<RubySandbox> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const stdoutFile = new File([])
  const stderrChunks: string[] = []
  const stderr = new ConsoleStdout((bytes: Uint8Array) => {
    const text = decoder.decode(bytes)
    stderrChunks.push(text)
    onStderr?.(text)
  })
  const directory = new Map<string, File>(Object.entries(files).map(([name, text]) => [name, new File(encoder.encode(text), { readonly: true })]))
  directory.set('stdout.txt', stdoutFile)
  const fds = [new OneShotStdin(stdin), new OpenFile(stdoutFile), stderr, new PreopenDirectory('/csg', directory)]
  const wasi = new WASI(RUBY_ARGS, [], fds, { debug: false })
  const { vm } = await RubyVM.instantiateModule({
    module,
    wasip1: wasi,
    args: RUBY_ARGS,
    addToImports(imports: WebAssembly.Imports) {
      const host = imports['rb-js-abi-host'] as Record<string, unknown>
      for (const name of Object.keys(host)) {
        // Raised by Ruby itself for an unsafe VM operation; it reaches nothing outside the VM.
        if (name === 'rb_wasm_throw_prohibit_rewind_exception') continue
        host[name] = () => {
          throw new Error(JS_BRIDGE_DISABLED)
        }
      }
    },
  } as Parameters<typeof RubyVM.instantiateModule>[0])
  return { vm, stdout: () => decoder.decode(stdoutFile.data), stderr: () => stderrChunks.join('') }
}

/** Runs a program for the Run button: what it printed, and its error if it raised. */
export async function runRubyProgram(module: WebAssembly.Module, code: string): Promise<{ stdout: string; stderr: string }> {
  const errors: string[] = []
  let sandbox: RubySandbox | null = null
  try {
    sandbox = await rubySandbox(module, { 'student.rb': code }, '')
    sandbox.vm.eval(RUBY_PROGRAM)
  } catch (error: unknown) {
    errors.push(error instanceof Error && error.message.includes(JS_BRIDGE_DISABLED) ? JS_BRIDGE_DISABLED : error instanceof Error ? error.message : String(error))
  }
  // When the bridge stops the VM, Ruby prints its own crash report: keep only what came before it.
  const stderr = (sandbox?.stderr() ?? '').split('\n-- Control frame information')[0].split('-- Control frame information')[0]
  return { stdout: sandbox?.stdout() ?? '', stderr: [stderr.trim(), ...errors].filter(Boolean).join('\n') }
}

const RUBY_PROGRAM = String.raw`
begin
  TOPLEVEL_BINDING.eval(File.read("/csg/student.rb", encoding: "UTF-8"), "student.rb", 1)
rescue SystemExit
  nil
rescue Exception => error
  STDERR.puts "#{error.class}: #{error.message}"
ensure
  STDOUT.flush rescue nil
end
nil
`

/**
 * The check harness. It holds the nonce and every method it relies on in its own closure, loads
 * the standard libraries students use, removes the ways to reach another frame's objects, freezes
 * the core classes, then runs the student's code and the check.
 */
const RUBY_HARNESS = String.raw`
->() {
  nonce = STDIN.read(64)
  STDIN.close
  report_io = IO.new(2, "w", autoclose: false)
  out_io = STDOUT
  syswrite = IO.instance_method(:syswrite)
  flush = IO.instance_method(:flush)
  pack = Array.instance_method(:pack)
  report = ->(word, detail = "") { syswrite.bind_call(report_io, "\n#{nonce} #{word} #{pack.bind_call([detail], "m0")}\n") }
  student_source = File.read("/csg/student.rb", encoding: "UTF-8")
  check_source = File.read("/csg/check.rb", encoding: "UTF-8")
  read_output = File.method(:binread)

  %w[set json date time pp prettyprint stringio ostruct securerandom digest forwardable singleton bigdecimal objspace continuation].each do |library|
    require library
  rescue LoadError
    nil
  end

  same = BasicObject.instance_method(:equal?)
  class_of = Kernel.instance_method(:class)
  raise_error = Kernel.instance_method(:raise)
  module_eqq = Module.instance_method(:===)
  module_name = Module.instance_method(:name)
  exception_message = Exception.instance_method(:message)
  instance_eval = BasicObject.instance_method(:instance_eval)
  binding_eval = Binding.instance_method(:eval)
  force_encoding = String.instance_method(:force_encoding)
  integer_eq = Integer.instance_method(:==)
  integer_lt = Integer.instance_method(:<)
  integer_plus = Integer.instance_method(:+)
  float_eq = Float.instance_method(:==)
  string_eq = String.instance_method(:==)
  string_include = String.instance_method(:include?)
  array_size = Array.instance_method(:size)
  array_at = Array.instance_method(:[])
  hash_pairs = Hash.instance_method(:to_a)
  set_class = defined?(Set) ? Set : nil
  set_to_a = set_class ? set_class.instance_method(:to_a) : nil
  range_class = Range
  range_begin = Range.instance_method(:begin)
  range_end = Range.instance_method(:end)
  range_excl = Range.instance_method(:exclude_end?)
  range_include = Range.instance_method(:include?)
  regexp_class = Regexp
  regexp_eq = Regexp.instance_method(:==)
  symbol_class = Symbol
  symbol_eq = Symbol.instance_method(:==)
  rational_class = Rational
  rational_eq = Rational.instance_method(:==)
  complex_class = Complex
  complex_eq = Complex.instance_method(:==)
  time_class = Time
  time_eq = Time.instance_method(:==)
  date_class = defined?(Date) ? Date : nil
  date_eq = date_class ? date_class.instance_method(:==) : nil
  datetime_class = defined?(DateTime) ? DateTime : nil
  datetime_eq = datetime_class ? datetime_class.instance_method(:==) : nil
  bigdecimal_class = defined?(BigDecimal) ? BigDecimal : nil
  bigdecimal_eq = bigdecimal_class ? bigdecimal_class.instance_method(:==) : nil
  string_class = String
  integer_class = Integer
  float_class = Float
  array_class = Array
  hash_class = Hash
  exception_class = Exception
  system_exit = SystemExit
  toplevel = TOPLEVEL_BINDING
  failure = Class.new(StandardError)

  as_text = ->(value, fallback) {
    begin
      module_eqq.bind_call(string_class, value) ? value : fallback
    rescue exception_class
      fallback
    end
  }
  describe_value = ->(value) {
    begin
      as_text.(value.inspect, "(value)")
    rescue exception_class
      "(value)"
    end
  }
  describe_error = ->(error) {
    name = begin
      as_text.(module_name.bind_call(class_of.bind_call(error)), "Error")
    rescue exception_class
      "Error"
    end
    message = begin
      as_text.(exception_message.bind_call(error), "")
    rescue exception_class
      ""
    end
    same.bind_call(string_eq.bind_call(message, ""), true) ? name : "#{name}: #{message}"
  }

  values_equal = nil
  values_equal = ->(expected, actual) {
    return true if same.bind_call(expected, actual)
    expected_class = class_of.bind_call(expected)
    actual_class = class_of.bind_call(actual)
    numeric = ->(klass) { same.bind_call(klass, integer_class) || same.bind_call(klass, float_class) }
    if numeric.(expected_class) && numeric.(actual_class)
      return same.bind_call(expected_class, integer_class) ? integer_eq.bind_call(expected, actual) : float_eq.bind_call(expected, actual)
    end
    return false unless same.bind_call(expected_class, actual_class)
    if same.bind_call(expected_class, string_class)
      string_eq.bind_call(expected, actual)
    elsif same.bind_call(expected_class, array_class)
      size = array_size.bind_call(expected)
      return false unless integer_eq.bind_call(size, array_size.bind_call(actual))
      index = 0
      while integer_lt.bind_call(index, size)
        return false unless values_equal.(array_at.bind_call(expected, index), array_at.bind_call(actual, index))
        index = integer_plus.bind_call(index, 1)
      end
      true
    elsif same.bind_call(expected_class, hash_class)
      expected_pairs = hash_pairs.bind_call(expected)
      actual_pairs = hash_pairs.bind_call(actual)
      size = array_size.bind_call(expected_pairs)
      return false unless integer_eq.bind_call(size, array_size.bind_call(actual_pairs))
      index = 0
      while integer_lt.bind_call(index, size)
        pair = array_at.bind_call(expected_pairs, index)
        found = false
        other = 0
        while (found ? false : integer_lt.bind_call(other, size))
          candidate = array_at.bind_call(actual_pairs, other)
          found = values_equal.(array_at.bind_call(pair, 0), array_at.bind_call(candidate, 0)) &&
            values_equal.(array_at.bind_call(pair, 1), array_at.bind_call(candidate, 1))
          other = integer_plus.bind_call(other, 1)
        end
        return false unless found
        index = integer_plus.bind_call(index, 1)
      end
      true
    elsif set_class && same.bind_call(expected_class, set_class)
      expected_items = set_to_a.bind_call(expected)
      actual_items = set_to_a.bind_call(actual)
      size = array_size.bind_call(expected_items)
      return false unless integer_eq.bind_call(size, array_size.bind_call(actual_items))
      index = 0
      while integer_lt.bind_call(index, size)
        item = array_at.bind_call(expected_items, index)
        found = false
        other = 0
        while (found ? false : integer_lt.bind_call(other, size))
          found = values_equal.(item, array_at.bind_call(actual_items, other))
          other = integer_plus.bind_call(other, 1)
        end
        return false unless found
        index = integer_plus.bind_call(index, 1)
      end
      true
    elsif same.bind_call(expected_class, range_class)
      same.bind_call(range_excl.bind_call(expected), range_excl.bind_call(actual)) &&
        values_equal.(range_begin.bind_call(expected), range_begin.bind_call(actual)) &&
        values_equal.(range_end.bind_call(expected), range_end.bind_call(actual))
    elsif same.bind_call(expected_class, regexp_class)
      regexp_eq.bind_call(expected, actual)
    elsif same.bind_call(expected_class, symbol_class)
      symbol_eq.bind_call(expected, actual)
    elsif same.bind_call(expected_class, rational_class)
      rational_eq.bind_call(expected, actual)
    elsif same.bind_call(expected_class, complex_class)
      complex_eq.bind_call(expected, actual)
    elsif same.bind_call(expected_class, time_class)
      time_eq.bind_call(expected, actual)
    elsif datetime_class && same.bind_call(expected_class, datetime_class)
      datetime_eq.bind_call(expected, actual)
    elsif date_class && same.bind_call(expected_class, date_class)
      date_eq.bind_call(expected, actual)
    elsif bigdecimal_class && same.bind_call(expected_class, bigdecimal_class)
      bigdecimal_eq.bind_call(expected, actual)
    else
      # Student-defined classes compare the way they define equality.
      expected == actual
    end
  }
  fail_with = ->(message, fallback) {
    text = same.bind_call(message, nil) ? fallback : as_text.(message, nil) || describe_value.(message)
    raise_error.bind_call(nil, failure, text)
  }
  includes = ->(collection, item) {
    collection_class = class_of.bind_call(collection)
    if same.bind_call(collection_class, string_class) && same.bind_call(class_of.bind_call(item), string_class)
      string_include.bind_call(collection, item)
    elsif same.bind_call(collection_class, array_class) || same.bind_call(collection_class, hash_class) || (set_class && same.bind_call(collection_class, set_class))
      entries = if same.bind_call(collection_class, hash_class)
        hash_pairs.bind_call(collection)
      elsif set_class && same.bind_call(collection_class, set_class)
        set_to_a.bind_call(collection)
      else
        collection
      end
      size = array_size.bind_call(entries)
      index = 0
      found = false
      while (found ? false : integer_lt.bind_call(index, size))
        entry = array_at.bind_call(entries, index)
        found = values_equal.(same.bind_call(collection_class, hash_class) ? array_at.bind_call(entry, 0) : entry, item)
        index = integer_plus.bind_call(index, 1)
      end
      found
    elsif same.bind_call(collection_class, range_class)
      range_include.bind_call(collection, item)
    else
      collection.include?(item)
    end
  }
  context_class = Class.new do
    define_method(:initialize) { |output| @output = output }
    define_method(:output) { @output }
    define_method(:assert) do |condition, message = nil|
      fail_with.(message, "Assertion failed") unless condition
      nil
    end
    define_method(:assert_equal) do |expected, actual, message = nil|
      fail_with.(message, "Expected #{describe_value.(expected)}, got #{describe_value.(actual)}") unless values_equal.(expected, actual)
      nil
    end
    define_method(:assert_includes) do |collection, item, message = nil|
      fail_with.(message, "Expected #{describe_value.(collection)} to include #{describe_value.(item)}") unless includes.(collection, item)
      nil
    end
  end

  # Nothing the student's code runs may reach another frame's objects or redefine the core.
  ObjectSpace.singleton_methods.each { |name| ObjectSpace.singleton_class.send(:undef_method, name) unless name == :garbage_collect }
  ObjectSpace.private_instance_methods(false).each { |name| ObjectSpace.send(:undef_method, name) }
  TracePoint.singleton_class.send(:undef_method, :new, :trace)
  [Kernel, Kernel.singleton_class].each do |owner|
    %i[set_trace_func callcc].each { |name| owner.send(:undef_method, name) if owner.method_defined?(name) || owner.private_method_defined?(name) }
  end
  %i[set_trace_func add_trace_func].each { |name| Thread.send(:undef_method, name) if Thread.method_defined?(name) }
  [
    BasicObject, Kernel, Comparable, Enumerable, ObjectSpace, TracePoint, Thread, Fiber, GC, Math, Marshal, Struct,
    String, Symbol, Integer, Float, Numeric, Rational, Complex, Array, Hash, Range, Regexp, MatchData, Time,
    TrueClass, FalseClass, NilClass, Proc, Method, UnboundMethod, Binding, Module, Class, IO, File, Dir, Encoding,
    Exception, StandardError, RuntimeError, ScriptError, SyntaxError, LoadError, NotImplementedError, NameError,
    NoMethodError, TypeError, ArgumentError, ZeroDivisionError, FloatDomainError, RangeError, IndexError, KeyError,
    StopIteration, LocalJumpError, FrozenError, SystemExit, SignalException, Interrupt, UncaughtThrowError,
    FiberError, ThreadError, IOError, EOFError, SecurityError, NoMatchingPatternError, NoMatchingPatternKeyError,
    failure, context_class
  ].each(&:freeze)
  %i[Set Date DateTime BigDecimal StringIO OpenStruct JSON PP PrettyPrint Digest SecureRandom Forwardable Singleton].each do |name|
    Object.const_get(name).freeze if Object.const_defined?(name)
  end

  report.("STUDENT_START")
  student_error = nil
  begin
    binding_eval.bind_call(toplevel, student_source, "student.rb", 1)
  rescue system_exit
    nil
  rescue exception_class => error
    student_error = describe_error.(error)
  end
  begin
    flush.bind_call(out_io)
  rescue exception_class
    nil
  end
  report.("STUDENT_DONE")
  if student_error
    report.("STUDENT_ERROR", student_error)
    return nil
  end

  output = begin
    force_encoding.bind_call(read_output.call("/csg/stdout.txt"), "UTF-8")
  rescue exception_class
    ""
  end
  check_failure = begin
    instance_eval.bind_call(context_class.new(output), check_source, "check.rb", 1)
    nil
  rescue failure => assertion
    begin
      as_text.(exception_message.bind_call(assertion), "Assertion failed")
    rescue exception_class
      "Assertion failed"
    end
  rescue system_exit
    "The check stopped the program before it finished."
  rescue exception_class => error
    describe_error.(error)
  end
  check_failure ? report.("FAIL", check_failure) : report.("PASS")
  nil
}.call
nil
`

function decodeDetail(detail: string) {
  try {
    const bytes = Uint8Array.from(atob(detail), (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

/** Reads the harness's nonce-stamped lines out of stderr. */
function readVerdict(stderr: string, nonce: string): { kind: 'pass' | 'fail' | 'student_error' | 'none'; detail: string } {
  const lines = stderr.split('\n').filter((line) => line.startsWith(`${nonce} `)).map((line) => line.slice(nonce.length + 1).split(' '))
  const terminal = lines.filter(([word]) => word === 'PASS' || word === 'FAIL' || word === 'STUDENT_ERROR')
  // Exactly one verdict, and it is the harness's last word.
  if (terminal.length !== 1 || lines.at(-1) !== terminal[0]) return { kind: 'none', detail: '' }
  const [word, detail = ''] = terminal[0]
  return { kind: word === 'PASS' ? 'pass' : word === 'FAIL' ? 'fail' : 'student_error', detail: decodeDetail(detail) }
}

export async function runRubyCheck(module: WebAssembly.Module, studentCode: string, check: CodeRunnerCheck, hooks: SandboxHooks = {}): Promise<SandboxCheckOutcome> {
  const nonce = randomNonce()
  let pending = ''
  const watch = (text: string) => {
    pending += text
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (line === `${nonce} STUDENT_START `) hooks.onPhase?.('student')
      else if (line === `${nonce} STUDENT_DONE `) hooks.onPhase?.('check')
    }
  }
  let sandbox: RubySandbox | null = null
  let crash: string | null = null
  try {
    sandbox = await rubySandbox(module, { 'student.rb': studentCode, 'check.rb': check.code }, nonce, watch)
    sandbox.vm.eval(RUBY_HARNESS)
  } catch (error: unknown) {
    crash = error instanceof Error && error.message.includes(JS_BRIDGE_DISABLED) ? JS_BRIDGE_DISABLED : error instanceof Error ? error.message : String(error)
  }
  const stdout = sandbox?.stdout() ?? ''
  const verdict = readVerdict(sandbox?.stderr() ?? '', nonce)
  if (verdict.kind === 'pass') return { passed: true, timedOut: false, error: null, stdout }
  if (verdict.kind === 'fail') return { passed: false, timedOut: false, error: verdict.detail || 'Assertion failed', stdout }
  if (verdict.kind === 'student_error') return { passed: false, timedOut: false, error: studentErrorMessage(verdict.detail), stdout }
  return { passed: false, timedOut: false, error: crash === JS_BRIDGE_DISABLED ? studentErrorMessage(JS_BRIDGE_DISABLED) : NO_VERDICT, stdout }
}

// ─── JavaScript (QuickJS) ────────────────────────────────────────────────────

// Built before the student's code runs, from captured built-ins, and passed to the check as
// parameters: the student's code can't replace them or the built-ins they use.
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
  // Freeze JavaScript intrinsics and lock their global bindings before student code runs so
  // expressions inside author checks (e.g. assert(result.includes(x))) can't be spoofed.
  const freeze = Object.freeze, define = Object.defineProperty, seen = new Set();
  const lockObj = (target) => {
    if (!target || (typeof target !== 'object' && typeof target !== 'function') || seen.has(target)) return;
    seen.add(target);
    freeze(target);
  };
  const builtinNames = [
    'Object', 'Function', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
    'RegExp', 'Date', 'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
    'TypeError', 'URIError', 'AggregateError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise',
    'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
    'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
    'BigInt64Array', 'BigUint64Array', 'JSON', 'Math', 'Reflect', 'Proxy', 'Intl',
    'console', 'print', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  ];
  for (let i = 0; i < builtinNames.length; i += 1) {
    const name = builtinNames[i];
    if (!(name in globalThis)) continue;
    const val = globalThis[name];
    lockObj(val);
    if (val && typeof val === 'function' && val.prototype) lockObj(val.prototype);
    try { define(globalThis, name, { value: val, writable: false, enumerable: false, configurable: false }); } catch {}
  }
  const typedArrayCtor = getProto(Int8Array);
  lockObj(typedArrayCtor);
  lockObj(typedArrayCtor && typedArrayCtor.prototype);
  lockObj(getProto(getProto([][Symbol.iterator]())));
  const genProto = getProto((function* () {})());
  lockObj(genProto);
  lockObj(getProto(genProto));
  lockObj(getProto(async function () {}));
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

export function stringifyQuickJsValue(value: unknown) {
  if (typeof value === 'string') return value
  if (typeof value === 'undefined') return 'undefined'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

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

export function runJavaScriptCheck(quickjs: QuickJSWASMModule, studentCode: string, check: CodeRunnerCheck, timeoutMs: number, hooks: SandboxHooks = {}): SandboxCheckOutcome {
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
  const fail = (error: unknown, fromStudent: boolean): SandboxCheckOutcome => {
    if (isQuickJsInterrupt(error)) return { passed: false, timedOut: true, error: timeoutMessage(timeoutMs), stdout: stdout.join('') }
    const message = quickJsErrorMessage(error)
    return { passed: false, timedOut: false, error: fromStudent ? studentErrorMessage(message) : message, stdout: stdout.join('') }
  }
  const evaluate = (code: string, filename: string): { value: QuickJSHandle } | { error: unknown } => {
    const result = vm.evalCode(code, filename)
    if (result.error) {
      const error = vm.dump(result.error)
      result.error.dispose()
      return { error }
    }
    return { value: keep(result.value) }
  }

  try {
    // Output is collected by host functions: the student's code can only add to it by printing.
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

    const helpers = evaluate(JS_HELPERS, 'helpers.js')
    if ('error' in helpers) return fail(helpers.error, false)
    const helperArgs = ['assert', 'assertEqual', 'assertIncludes'].map((name) => keep(vm.getProp(helpers.value, name)))

    hooks.onPhase?.('student')
    const student = evaluate(studentCode, 'student.js')
    if ('error' in student) return fail(student.error, true)

    hooks.onPhase?.('check')
    const output = keep(vm.newString(stdout.join('')))
    const checkFunction = evaluate(`(function (assert, assertEqual, assertIncludes, output) {\n${check.code}\n})`, 'check.js')
    if ('error' in checkFunction) return fail(checkFunction.error, false)
    // The verdict is the host's: whether calling the check threw.
    const call = vm.callFunction(checkFunction.value, vm.undefined, [...helperArgs, output])
    if (call.error) {
      const error = vm.dump(call.error)
      call.error.dispose()
      return fail(error, false)
    }
    call.value.dispose()
    return { passed: true, timedOut: false, error: null, stdout: stdout.join('') }
  } finally {
    handles.reverse().forEach((handle) => handle.alive && handle.dispose())
    vm.dispose()
    runtime.dispose()
  }
}
