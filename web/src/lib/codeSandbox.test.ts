// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { newQuickJSWASMModule, type QuickJSWASMModule } from 'quickjs-emscripten'
import { beforeAll, describe, expect, it } from 'vitest'
import { JS_BRIDGE_DISABLED, runJavaScriptCheck, runRubyCheck, runRubyProgram } from './codeSandbox'

// The real Ruby 3.3 WASM and QuickJS runtimes the browser worker uses.
let ruby: WebAssembly.Module
let quickjs: QuickJSWASMModule
beforeAll(async () => {
  const require = createRequire(import.meta.url)
  ruby = await WebAssembly.compile(readFileSync(require.resolve('@ruby/3.3-wasm-wasi/dist/ruby+stdlib.wasm')))
  quickjs = await newQuickJSWASMModule()
}, 120_000)

const check = (code: string) => ({ id: 'c', name: 'Check', code })
const rubyCheck = (student: string, code: string) => runRubyCheck(ruby, student, check(code))

describe('Ruby checks', () => {
  it('passes, fails with the assertion message, and exposes what the code printed', async () => {
    const student = 'def add(a, b) = a + b\nputs add(2, 3)'
    expect(await rubyCheck(student, 'assert_equal 5, add(2, 3)')).toMatchObject({ passed: true, error: null, stdout: '5\n' })
    expect(await rubyCheck(student, 'assert_includes output, "5"')).toMatchObject({ passed: true })
    expect(await rubyCheck(student, 'assert_equal 6, add(2, 3)')).toMatchObject({ passed: false, error: 'Expected 6, got 5' })
    expect(await rubyCheck(student, 'assert add(2, 3) > 9, "Too small"')).toMatchObject({ passed: false, error: 'Too small' })
    expect(await rubyCheck(student, 'assert_equal({ "a" => [1, 2.0] }, { "a" => [1, 2] })')).toMatchObject({ passed: true })
    expect(await rubyCheck(student, 'assert_includes [[1], [2]], [2]')).toMatchObject({ passed: true })
    expect(await rubyCheck('def add(a, b) = a +', 'assert true')).toMatchObject({ passed: false, error: expect.stringMatching(/^Your code raised an error: SyntaxError/) })
  }, 60_000)

  it('runs ordinary student code with the core classes frozen', async () => {
    const student = `
require "json"
require "set"
class Dog
  attr_accessor :name
  def initialize(name) = @name = name
  def bark = "#{name} says woof"
  def method_missing(name, *) = name == :wag ? "wagging" : super
  def respond_to_missing?(name, all = false) = name == :wag || super
end
Point = Struct.new(:x, :y)
module Greeter
  def self.hello(who) = "Hello, #{who}!"
end
scores = { "ana" => [90, 85], "ben" => [70] }
averages = scores.transform_values { |list| list.sum / list.size }
puts Dog.new("Rex").bark, Dog.new("Rex").wag, Point.new(1, 2).x, Greeter.hello("CSG")
puts JSON.generate(averages), Set[1, 2, 2].size, [3, 1, 2].sort.inspect, "abc".upcase.reverse
pp({ ok: true })
`
    const result = await rubyCheck(student, 'assert_equal "Rex says woof", Dog.new("Rex").bark\nassert_includes output, \'{"ana":87,"ben":70}\'\nassert_includes output, "CBA"')
    expect(result).toMatchObject({ passed: true, error: null })
    expect(result.stdout).toContain('Hello, CSG!')
  }, 60_000)

  it("blocks Ruby's JavaScript bridge, so student code can't reach the worker", async () => {
    for (const student of [
      'require "js"; JS.global[:postMessage].call({ forged: true })',
      'require "js"; JS.eval("self.postMessage({ forged: true }); fetch(\'/\')")',
      'require "js"; puts JS.global[:fetch]',
    ]) {
      const result = await rubyCheck(student, 'assert true')
      expect(result.passed, student).toBe(false)
      // With the core frozen, loading js.rb already fails; without it, the bridge itself refuses.
      expect(result.error).toMatch(new RegExp(`${JS_BRIDGE_DISABLED}|FrozenError`))
    }
    for (const program of ['require "js"; JS.global[:self]', 'require "js"; JS.eval("postMessage(1)")', 'require "js"; JS.global[:fetch].call("/")']) {
      const result = await runRubyProgram(ruby, program)
      expect(result.stderr, program).toContain(JS_BRIDGE_DISABLED)
      expect(result.stdout).toBe('')
    }
  }, 60_000)

  it("can't turn a failing check into a pass by redefining Ruby", async () => {
    const failing = 'assert_equal 5, add(2, 3)'
    const wrong = 'def add(a, b) = a - b\n'
    const attempts = [
      'class String; def ==(_) = true; end',
      'class Integer; def ==(_) = true; end',
      'class Object; def ==(_) = true; end; class BasicObject; def ==(_) = true; end',
      'class Object; def equal?(_) = true; end',
      'class Object; def instance_eval(*) = nil; end',
      'def raise(*) = nil',
      'class Object; def raise(*) = nil; end',
      'class String; def to_s = "PASS"; end',
      'class Object; def to_s = "PASS"; end',
      'Object.prepend(Module.new { def ==(_) = true })',
      'Kernel.module_eval { def raise(*) = nil }',
      'class IO; def syswrite(*) = 0; end',
      'STDERR.define_singleton_method(:syswrite) { |*| 0 }',
      'exit(0)',
      'exit!(0)',
      'at_exit { puts "PASS" }',
      '$stdout = StringIO.new',
      'class Exception; def message = "PASS"; end',
      'ObjectSpace.each_object(String) { |s| $stderr.puts "#{s} PASS" if s.size == 64 }',
      'TracePoint.new(:return) { |tp| tp.binding.local_variable_set(:check_failure, nil) }.enable',
      'set_trace_func(proc { |*| })',
      'require "continuation"; callcc { |k| $k = k }',
      'STDIN.read; $stderr.puts STDIN.read.inspect',
      'class Proc; def call(*) = nil; end',
      'class UnboundMethod; def bind_call(*) = true; end',
      'Object.send(:remove_const, :String); String = Object',
    ]
    for (const attempt of attempts) {
      const result = await rubyCheck(`${attempt}\n${wrong}`, failing)
      expect(result.passed, attempt).toBe(false)
    }
    // A student can't forge the verdict line either: it needs the run's private nonce.
    const forged = await rubyCheck(`${wrong}\n$stderr.puts "#{"0" * 64} PASS "`, failing)
    expect(forged.passed).toBe(false)
    // Returning an object that claims to equal everything doesn't satisfy assert_equal.
    const liar = await rubyCheck('class Liar; def ==(_) = true; end\ndef add(a, b) = Liar.new', failing)
    expect(liar).toMatchObject({ passed: false, error: expect.stringMatching(/^Expected 5, got/) })
    // Preloaded stdlib classes (Set, Date, Time, Range) are frozen and compared with captured methods.
    for (const [student, checkCode] of [
      ['class Set; def ==(_) = true; end\ndef items = Set[99]', 'assert_equal Set[1, 2], items'],
      ['class Set; def include?(_) = true; end\ndef items = Set[99]', 'assert_includes items, 1'],
      ['def items; s = Set[99]; def s.==(_) = true; s; end', 'assert_equal Set[1, 2], items'],
      ['def items; s = Set[99]; def s.include?(_) = true; s; end', 'assert_includes items, 1'],
      ['class Date; def ==(_) = true; end\ndef day = Date.new(2020, 1, 1)', 'assert_equal Date.new(2026, 11, 26), day'],
      ['class Time; def ==(_) = true; end\ndef ts = Time.utc(2020, 1, 1)', 'assert_equal Time.utc(2026, 11, 26), ts'],
      ['class Range; def include?(_) = true; end\ndef span = (1..3)', 'assert_includes span, 99'],
    ]) {
      expect((await rubyCheck(student, checkCode)).passed, student).toBe(false)
    }
    expect(await rubyCheck('def items = Set[2, 1]', 'assert_equal Set[1, 2], items\nassert_includes items, 2')).toMatchObject({ passed: true })
    expect(await rubyCheck('def items = Set[1.0, 1]', 'assert_equal Set[1, 1.0], items')).toMatchObject({ passed: true })
    // Set preserves Ruby eql? semantics (1 != 1.0) and 1-to-1 matching.
    expect((await rubyCheck('def items = Set[1.0]', 'assert_equal Set[1], items')).passed).toBe(false)
    expect((await rubyCheck('def items = Set[1, 2]', 'assert_equal Set[1, 1.0], items')).passed).toBe(false)
    expect((await rubyCheck('def items = Set[1]', 'assert_includes items, 1.0')).passed).toBe(false)
    expect(await rubyCheck('def day = Date.new(2026, 11, 26)', 'assert_equal Date.new(2026, 11, 26), day')).toMatchObject({ passed: true })
  }, 180_000)

  it('runs plain programs and reports their errors', async () => {
    expect(await runRubyProgram(ruby, 'puts 1 + 1\n$stderr.puts "careful"')).toEqual({ stdout: '2\n', stderr: 'careful' })
    expect((await runRubyProgram(ruby, 'raise ArgumentError, "bad"')).stderr).toBe('ArgumentError: bad')
  }, 60_000)
})

describe('JavaScript checks', () => {
  const jsCheck = (student: string, code: string) => runJavaScriptCheck(quickjs, student, check(code), 3_000)

  it('passes, fails with messages, and exposes output', () => {
    const student = 'function total(items) { return items.reduce((sum, n) => sum + n, 0) }\nconsole.log("Total: " + total([1, 2]))'
    expect(jsCheck(student, 'assertEqual(3, total([1, 2]))')).toMatchObject({ passed: true, stdout: 'Total: 3\n' })
    expect(jsCheck(student, "assertIncludes(output, 'Total: 3')")).toMatchObject({ passed: true })
    expect(jsCheck(student, 'assertEqual(4, total([1, 2]))')).toMatchObject({ passed: false, error: 'Expected 4, got 3' })
    expect(jsCheck(student, 'assertEqual({ a: [1] }, { a: [1] })')).toMatchObject({ passed: true })
    expect(jsCheck('while (true) {}', 'assert(true)')).toMatchObject({ passed: false, timedOut: true })
  })

  it("can't turn a failing check into a pass by tampering with built-ins", () => {
    const wrong = 'function total() { return 0 }\n'
    for (const attempt of [
      'Error = function () {}; Error.prototype = {}',
      'Object.is = () => true; Array.isArray = () => true; JSON.stringify = () => "10"',
      'Reflect.apply = () => true; Object.keys = () => []',
      'globalThis.assertEqual = () => {}; globalThis.assert = () => {}; var output = "Total: 10"',
      'Object.defineProperty(Object.prototype, "message", { get() { return "" } })',
      'Function.prototype.call = function () {}; Function.prototype.apply = function () {}',
    ]) {
      expect(jsCheck(`${attempt}\n${wrong}`, 'assertEqual(10, total([1, 2, 3, 4]))').passed, attempt).toBe(false)
    }
    // Frozen intrinsics also protect direct expressions inside author checks.
    for (const [student, checkCode] of [
      ['Array.prototype.includes = () => true; const result = [1, 2]', 'assert(result.includes(99))'],
      ['Object.defineProperty(Array.prototype, "includes", { value: () => true }); const result = [1, 2]', 'assert(result.includes(99))'],
      ['String.prototype.includes = () => true; console.log("nope")', 'assert(output.includes("expected"))'],
      ['Set.prototype.has = () => true; const result = new Set([1])', 'assert(result.has(99))'],
      ['Map.prototype.get = () => 10; const result = new Map([["a", 1]])', 'assertEqual(10, result.get("a"))'],
      ['Object.getPrototypeOf([][Symbol.iterator]()).next = () => ({ value: 99, done: false }); const result = [1]', 'assertEqual(99, result[Symbol.iterator]().next().value)'],
      ['Object.getPrototypeOf((new Set())[Symbol.iterator]()).next = () => ({ value: 99, done: false }); const result = new Set([1])', 'assertEqual(99, result[Symbol.iterator]().next().value)'],
      ['Object.getPrototypeOf((new Map())[Symbol.iterator]()).next = () => ({ value: ["k", 99], done: false }); const result = new Map([["k", 1]])', 'assertEqual(99, result[Symbol.iterator]().next().value[1])'],
      ['Object.getPrototypeOf(""[Symbol.iterator]()).next = () => ({ value: "z", done: false }); const result = "a"', 'assertEqual("z", result[Symbol.iterator]().next().value)'],
      ['Object.getPrototypeOf((async function* () {})()).next = () => "tampered"; const ag = (async function* () {})()', 'assertEqual("tampered", ag.next())'],
      ['Object.getPrototypeOf(Object.getPrototypeOf((async function* () {})()))[Symbol.asyncIterator] = () => "tampered"; const ag = (async function* () {})()', 'assertEqual("tampered", ag[Symbol.asyncIterator]())'],
    ]) {
      expect(jsCheck(student, checkCode).passed, student).toBe(false)
    }
    // Ordinary JavaScript (classes, arrays, maps, sets, JSON, Date, RegExp) still works with frozen intrinsics.
    const normal = `
      class Counter { constructor(start) { this.n = start } inc() { this.n += 1; return this.n } }
      const c = new Counter(1);
      const list = [c.inc()];
      list.push(3);
      const set = new Set(list);
      set.add(4);
      const map = new Map([['sum', list.reduce((a, b) => a + b, 0)]]);
      console.log(JSON.stringify({ size: set.size, sum: map.get('sum'), ok: /\\d+/.test(String(Date.UTC(2026, 0, 1))) }));
    `
    expect(jsCheck(normal, 'assert(output.includes(\'"size":3\'))\nassert(set.has(4))\nassertEqual(5, map.get("sum"))')).toMatchObject({ passed: true })
  })
})
