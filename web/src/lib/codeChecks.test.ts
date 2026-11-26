// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeChecksWorkerMessage, RunChecksRequest } from './codeChecks'

/** A stand-in for the code runner worker: each test scripts what it answers. */
class FakeWorker {
  static instances: FakeWorker[] = []
  static respond: (worker: FakeWorker, request: RunChecksRequest) => void = () => {}
  listeners: Record<string, ((event: unknown) => void)[]> = {}
  terminated = false
  requests: RunChecksRequest[] = []
  constructor() {
    FakeWorker.instances.push(this)
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    ;(this.listeners[type] ??= []).push(listener)
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((item) => item !== listener)
  }
  postMessage(request: RunChecksRequest) {
    this.requests.push(request)
    FakeWorker.respond(this, request)
  }
  emit(message: CodeChecksWorkerMessage) {
    ;(this.listeners.message ?? []).forEach((listener) => listener({ data: message }))
  }
  terminate() {
    this.terminated = true
  }
}

const CHECKS = ['a', 'b', 'c'].map((id) => ({ id, name: `Check ${id}`, code: `check ${id}` }))
const pass = (worker: FakeWorker, request: RunChecksRequest, index: number) =>
  worker.emit({ id: request.id, type: 'check_result', index, result: { id: CHECKS[index].id, name: CHECKS[index].name, passed: true, timedOut: false, error: null, stdout: '', durationMs: 1 } })

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('runCodeChecks', () => {
  it('collects every result from one worker and summarizes them', async () => {
    FakeWorker.respond = (worker, request) => {
      request.checks.forEach((_, offset) => pass(worker, request, request.startIndex + offset))
      worker.emit({ id: request.id, type: 'checks_done' })
    }
    const { runCodeChecks } = await import('./codeChecks')
    const run = await runCodeChecks({ language: 'javascript', code: 'x', checks: CHECKS })
    expect(run).toMatchObject({ passed: 3, failed: 0, total: 3, timedOut: false })
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('replaces the worker when a check runs too long and finishes the rest on a new one', async () => {
    FakeWorker.respond = (worker, request) => {
      if (FakeWorker.instances.length === 1) {
        pass(worker, request, 0)
        worker.emit({ id: request.id, type: 'check_phase', index: 1, phase: 'check' })
        return // check b never finishes
      }
      request.checks.forEach((_, offset) => pass(worker, request, request.startIndex + offset))
      worker.emit({ id: request.id, type: 'checks_done' })
    }
    const { runCodeChecks } = await import('./codeChecks')
    const promise = runCodeChecks({ language: 'ruby', code: 'x', checks: CHECKS, timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(2_000)
    const run = await promise
    expect(FakeWorker.instances[0].terminated).toBe(true)
    expect(FakeWorker.instances[1].requests[0]).toMatchObject({ startIndex: 2, checks: [CHECKS[2]] })
    expect(run.results.map((result) => [result.id, result.passed, result.timedOut])).toEqual([['a', true, false], ['b', false, true], ['c', true, false]])
    expect(run).toMatchObject({ passed: 2, failed: 1, timedOut: true })
  })

  it("fails every remaining check at once when the student's code never finishes", async () => {
    FakeWorker.respond = (worker, request) => worker.emit({ id: request.id, type: 'check_phase', index: 0, phase: 'student' })
    const { runCodeChecks } = await import('./codeChecks')
    const promise = runCodeChecks({ language: 'ruby', code: 'loop {}', checks: CHECKS, timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(2_000)
    const run = await promise
    expect(FakeWorker.instances).toHaveLength(1)
    expect(run.results.every((result) => !result.passed && result.timedOut && result.error?.includes('Stopped after 100ms'))).toBe(true)
  })

  it('queues runs one at a time on the shared worker', async () => {
    const order: string[] = []
    FakeWorker.respond = (worker, request) => {
      order.push(request.code)
      setTimeout(() => {
        request.checks.forEach((_, offset) => pass(worker, request, request.startIndex + offset))
        worker.emit({ id: request.id, type: 'checks_done' })
      }, 10)
    }
    const { runCodeChecks } = await import('./codeChecks')
    const first = runCodeChecks({ language: 'ruby', code: 'first', checks: CHECKS.slice(0, 1) })
    const second = runCodeChecks({ language: 'ruby', code: 'second', checks: CHECKS.slice(0, 1) })
    await vi.advanceTimersByTimeAsync(5)
    expect(order).toEqual(['first'])
    await vi.advanceTimersByTimeAsync(50)
    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
  })

  it('summarizes counts in plain words', async () => {
    const { codeChecksSummary } = await import('./codeChecks')
    expect(codeChecksSummary({ passed: 3, failed: 0, total: 3 })).toBe('3 of 3 checks passed')
    expect(codeChecksSummary({ passed: 2, failed: 1, total: 3 })).toBe('1 of 3 checks failed')
    expect(codeChecksSummary({ passed: 1, failed: 0, total: 1 })).toBe('1 of 1 check passed')
  })
})
