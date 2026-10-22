// @vitest-environment jsdom
import { act, startTransition, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useStaffResource } from './useStaffResource'

it('hides old scope data and ignores responses from requests that finish after a scope switch', async () => {
  let finishA!: (value: { data: { name: string } }) => void
  const loaderA = vi.fn(() => new Promise<{ data: { name: string } }>((resolve) => { finishA = resolve }))
  const loaderB = vi.fn(async () => ({ data: { name: 'Cohort B' } }))
  function View({ scope }: { scope: string }) {
    const { data, error } = useStaffResource(scope, scope === 'A' ? loaderA : loaderB)
    return <p>{data?.name || error || 'Loading'}</p>
  }
  const container = document.createElement('div'); const root = createRoot(container)
  await act(async () => root.render(<View scope="A" />))
  await act(async () => root.render(<View scope="B" />))
  expect(container.textContent).toBe('Cohort B')
  await act(async () => finishA({ data: { name: 'Cohort A' } }))
  expect(container.textContent).toBe('Cohort B')
  act(() => root.unmount())
})

it('keeps the committed scope loading when a different scope render suspends', async () => {
  let finishA!: (value: { data: { name: string } }) => void
  const loaderA = () => new Promise<{ data: { name: string } }>((resolve) => { finishA = resolve })
  const loaderB = vi.fn(async () => ({ data: { name: 'Cohort B' } }))
  const pending = new Promise(() => {})
  function View({ scope }: { scope: string }) {
    const { data } = useStaffResource(scope, scope === 'A' ? loaderA : loaderB)
    if (scope === 'B') throw pending
    return <p>{data?.name || 'Loading A'}</p>
  }
  const container = document.createElement('div'); const root = createRoot(container)
  const view = (scope: string) => <Suspense fallback="Suspended"><View scope={scope} /></Suspense>
  try {
    await act(async () => root.render(view('A')))
    await act(async () => { startTransition(() => root.render(view('B'))) })
    expect(container.textContent).toBe('Loading A')
    await act(async () => finishA({ data: { name: 'Cohort A' } }))
    expect(container.textContent).toBe('Cohort A')
    expect(loaderB).not.toHaveBeenCalled()
  } finally { act(() => root.unmount()) }
})
