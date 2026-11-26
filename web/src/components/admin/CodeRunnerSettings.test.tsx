// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { summarizeCodeChecks } from '../../lib/codeChecks'
import type { CodeRunnerConfig } from '../../lib/codeRunner'
import { CodeRunnerSettings } from './CodeRunnerSettings'

const runCodeChecks = vi.hoisted(() => vi.fn())
vi.mock('../../lib/codeChecks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/codeChecks')>()),
  runCodeChecks,
}))

let container: HTMLDivElement
let root: Root
const saved: { latest: CodeRunnerConfig | null } = { latest: null }

function Harness({ initial }: { initial: CodeRunnerConfig }) {
  const [value, setValue] = useState(initial)
  const change = (next: CodeRunnerConfig) => {
    saved.latest = next
    setValue(next)
  }
  return <CodeRunnerSettings value={value} onChange={change} compact />
}

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}
const button = (label: string) => [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === label || element.getAttribute('aria-label') === label)!
const field = (label: string) => container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement

beforeEach(() => {
  runCodeChecks.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('CodeRunnerSettings', () => {
  it('edits starter code and checks, reorders and removes them, and tests them against the starter code', async () => {
    await act(async () => root.render(<Harness initial={{ enabled: true, language: 'ruby', starterCode: '', checks: [] }} />))
    expect(container.textContent).toContain('assert_equal(expected, actual)')

    const starter = [...container.querySelectorAll('textarea')][0]
    await act(async () => type(starter, 'def add(a, b) = a + b'))
    await act(async () => button('Add check').click())
    await act(async () => button('Add check').click())
    await act(async () => type(field('Check 1 name'), 'Adds'))
    await act(async () => type(field('Check 1 code'), 'assert_equal 3, add(1, 2)'))
    await act(async () => type(field('Check 2 name'), 'Zero'))
    await act(async () => type(field('Check 2 code'), 'assert_equal 0, add(0, 0)'))
    expect(saved.latest!.starterCode).toBe('def add(a, b) = a + b')
    expect(saved.latest!.checks?.map((check) => check.id)).toEqual(['check-1', 'check-2'])

    await act(async () => button('Move check 2 up').click())
    expect(saved.latest!.checks?.map((check) => check.name)).toEqual(['Zero', 'Adds'])

    runCodeChecks.mockResolvedValue(summarizeCodeChecks([
      { id: 'check-2', name: 'Zero', passed: true, timedOut: false, error: null, stdout: '', durationMs: 1 },
      { id: 'check-1', name: 'Adds', passed: false, timedOut: false, error: 'Expected 3, got 4', stdout: '', durationMs: 1 },
    ]))
    await act(async () => button('Test checks').click())
    expect(runCodeChecks).toHaveBeenCalledWith(expect.objectContaining({ language: 'ruby', code: 'def add(a, b) = a + b' }))
    expect(container.textContent).toContain('1 of 2 checks failed')
    expect(container.textContent).toContain('Expected 3, got 4')

    await act(async () => button('Remove check 1').click())
    expect(saved.latest!.checks?.map((check) => check.name)).toEqual(['Adds'])
  })

  it('tests pasted code instead of the starter, and shows JavaScript helpers', async () => {
    await act(async () => root.render(<Harness initial={{ enabled: true, language: 'javascript', starterCode: 'function add() {}', checks: [{ id: 'a', name: 'Adds', code: 'assertEqual(3, add(1, 2))' }] }} />))
    expect(container.textContent).toContain('assertEqual(expected, actual)')
    const testCode = [...container.querySelectorAll('textarea')].at(-1)!
    await act(async () => type(testCode, 'function add(a, b) { return a + b }'))
    runCodeChecks.mockResolvedValue(summarizeCodeChecks([{ id: 'a', name: 'Adds', passed: true, timedOut: false, error: null, stdout: '', durationMs: 1 }]))
    await act(async () => button('Test checks').click())
    expect(runCodeChecks).toHaveBeenCalledWith(expect.objectContaining({ code: 'function add(a, b) { return a + b }' }))
    expect(container.textContent).toContain('1 of 1 check passed')
  })
})
