// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { WorkspaceSectionSelect } from './WorkspaceSectionSelect'

vi.mock('../../lib/useMediaQuery', () => ({ useMediaQuery: () => true }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('uses native selection with URL history and forwards the resolved return context', async () => {
  const state = { returnTo: '/admin/students?cohort_id=2&q=QA', returnLabel: 'Filtered students' }
  const sections = [
    { to: '/admin/cohorts/2/students/6/overview', label: 'Overview' },
    { to: '/admin/cohorts/2/students/6/work', label: 'Work (3)' },
    { to: '/admin/cohorts/2/students/6/access', label: 'Access' },
  ]
  function Screen() {
    const location = useLocation()
    return (
      <WorkspaceSectionSelect
        label="Student page sections"
        value={location.pathname}
        sections={sections}
        state={state}
      />
    )
  }
  const router = createMemoryRouter([{ path: '*', element: <Screen /> }], { initialEntries: [sections[0].to] })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    const select = container.querySelector('select')!
    expect(select.getAttribute('aria-label')).toBe('Student page sections')
    expect(select.closest('label')?.classList.contains('lg:hidden')).toBe(true)
    expect([...select.options].map((option) => option.text)).toEqual(['Overview', 'Work (3)', 'Access'])
    await act(async () => {
      select.value = sections[2].to
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(router.state.location.pathname).toBe(sections[2].to)
    expect(router.state.location.state).toEqual(state)
    expect(select.value).toBe(sections[2].to)
    await act(async () => {
      await router.navigate(-1)
    })
    expect(router.state.location.pathname).toBe(sections[0].to)
    expect(select.value).toBe(sections[0].to)
  } finally {
    await act(async () => root.unmount())
    router.dispose()
    container.remove()
  }
})
