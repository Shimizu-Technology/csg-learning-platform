// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// L-0.4: a record page asks for its related panel once per record and viewer,
// even under StrictMode or with two consumers, and a sign-out cancels it.

const mocks = vi.hoisted(() => ({ getRecordRelated: vi.fn(), user: { id: 1 } as { id: number } | null }))
vi.mock('./api', () => ({ api: { getRecordRelated: mocks.getRecordRelated } }))
vi.mock('../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: mocks.user }) }))

import { useRecordRelated } from './recordRelated'
import { clearRecordRelatedCache, loadRecordRelated } from './recordRelatedCache'

const related = (id: number) => ({ type: 'submission', id, context: {}, items: [{ key: 'other_attempts', count: id, value: null }] })
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  mocks.user = { id: 1 }
  mocks.getRecordRelated.mockReset().mockImplementation(async (_type: string, id: number) => ({ data: { related: related(id) }, error: null }))
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); clearRecordRelatedCache() })

function Probe({ id, name }: { id: number; name: string }) {
  const state = useRecordRelated('submission', id)
  return <output data-probe={name}>{state.loading ? 'loading' : state.error || state.related?.items[0].count}</output>
}
const text = (name: string) => container.querySelector(`[data-probe="${name}"]`)?.textContent

describe('useRecordRelated', () => {
  it('sends one request under StrictMode even when a header and a panel both ask', async () => {
    await act(async () => root.render(<StrictMode><Probe id={812} name="header" /><Probe id={812} name="panel" /></StrictMode>))
    await flush()
    expect(mocks.getRecordRelated).toHaveBeenCalledTimes(1)
    expect(mocks.getRecordRelated).toHaveBeenCalledWith('submission', 812, { cohortId: undefined, studentId: undefined }, expect.any(AbortSignal))
    expect(text('header')).toBe('812')
    expect(text('panel')).toBe('812')
  })

  it('asks again on the next visit and on Retry; nothing is kept once a request settles', async () => {
    await act(async () => root.render(<Probe id={812} name="a" />))
    await flush()
    await act(async () => root.render(<Probe id={813} name="a" />))
    await flush()
    await act(async () => root.render(<Probe id={812} name="a" />))
    await flush()
    expect(mocks.getRecordRelated.mock.calls.map((call) => call[1])).toEqual([812, 813, 812])
  })
})

describe('loadRecordRelated', () => {
  it('shares only per viewer and record scope', async () => {
    const a = loadRecordRelated(1, 'lesson', 40, { cohortId: 3 })
    const b = loadRecordRelated(1, 'lesson', 40, { cohortId: 3 })
    const otherViewer = loadRecordRelated(2, 'lesson', 40, { cohortId: 3 })
    const otherCohort = loadRecordRelated(1, 'lesson', 40, { cohortId: 4 })
    const preview = loadRecordRelated(1, 'lesson', 40, { cohortId: 3, studentId: 9 })
    const signedOut = loadRecordRelated(null, 'lesson', 40, { cohortId: 3 })
    expect(a.promise).toBe(b.promise)
    await Promise.all([a, b, otherViewer, otherCohort, preview, signedOut].map((load) => load.promise))
    expect(mocks.getRecordRelated).toHaveBeenCalledTimes(5)
  })

  it('cancels only when the last caller lets go', async () => {
    const a = loadRecordRelated(1, 'cohort', 3)
    const b = loadRecordRelated(1, 'cohort', 3)
    await Promise.resolve()
    const signal = mocks.getRecordRelated.mock.calls[0][3] as AbortSignal
    a.release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(signal.aborted).toBe(false)
    b.release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(signal.aborted).toBe(true)
  })

  it('signing out cancels requests in flight and drops a late answer', async () => {
    let answer: (value: unknown) => void = () => {}
    mocks.getRecordRelated.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve }))
    const load = loadRecordRelated(1, 'student', 9, { cohortId: 3 })
    await Promise.resolve()
    const signal = mocks.getRecordRelated.mock.calls[0][3] as AbortSignal
    clearRecordRelatedCache()
    expect(signal.aborted).toBe(true)
    answer({ data: { related: related(9) }, error: null })
    expect(await load.promise).toEqual({ status: 'aborted' })
    // The next viewer gets their own request, not the cancelled one.
    loadRecordRelated(1, 'student', 9, { cohortId: 3 })
    await Promise.resolve()
    expect(mocks.getRecordRelated).toHaveBeenCalledTimes(2)
  })

  it('turns a thrown request into an error result', async () => {
    mocks.getRecordRelated.mockImplementationOnce(() => { throw new Error('offline') })
    expect(await loadRecordRelated(1, 'help_request', 4).promise).toEqual({ status: 'error', error: 'Related records are unavailable.' })
  })
})
