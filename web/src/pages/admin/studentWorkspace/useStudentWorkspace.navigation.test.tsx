// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { useStudentWorkspace } from './useStudentWorkspace'

const state = vi.hoisted(() => ({ create: vi.fn(), error: vi.fn() }))
vi.mock('../../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1 } }) }))
vi.mock('../../../contexts/ToastContext', () => ({ useToast: () => ({ error: state.error }) }))
vi.mock('../../../lib/recordRelated', () => ({ useRecordRelated: () => ({ related: null }) }))
vi.mock('../../../lib/useRecordPath', () => ({ useRecordViewer: () => ({}) }))
vi.mock('../../../lib/useRecordQueue', () => ({ useRecordQueue: () => null }))
vi.mock('../../../lib/api', () => ({
  api: {
    getStudentProgress: async (id: number) => ({ data: { user: { full_name: `Student ${id}` }, enrollment: { id } } }),
    getCohort: async (id: number) => ({ data: { cohort: { id, students: [] } } }),
    getSubmissions: async () => ({ data: { submissions: [] } }),
    getHelpRequests: async () => ({ data: { help_requests: [] } }),
    getStudentWatchProgress: async () => ({ data: { watch_progresses: [] } }),
    getStudentLessonVideoProgress: async () => ({ data: { lesson_videos: [] } }),
    getInterventions: async () => ({ data: { interventions: [] } }),
    getRecoveryPlans: async () => ({ data: { recovery_plans: [] } }),
    createDirectConversation: state.create,
  },
}))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it.each([
  ['/away', false],
  ['/admin/cohorts/1/students/4/overview', false],
  ['/admin/cohorts/2/students/3/overview', true],
] as const)('ignores a late direct-message response after moving to %s', async (destination, error) => {
  state.error.mockClear()
  let finish!: (value: unknown) => void
  state.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  function Probe() {
    const workspace = useStudentWorkspace()
    return (
      <>
        <button disabled={!workspace.data} onClick={() => void workspace.openDirectMessage()}>
          Message
        </button>
        <output>{String(workspace.openingMessage)}</output>
      </>
    )
  }
  const router = createMemoryRouter(
    [
      { path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <Probe /> },
      { path: '*', element: <p>Away</p> },
    ],
    { initialEntries: ['/admin/cohorts/1/students/3/overview'] },
  )
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    await act(async () => host.querySelector('button')!.click())
    expect(host.querySelector('output')?.textContent).toBe('true')
    await act(async () => {
      await router.navigate(destination)
    })
    await act(async () => finish(error ? { error: 'Late failure' } : { data: { direct_conversation: { id: 99 } } }))
    expect(router.state.location.pathname).toBe(destination)
    expect(state.error).not.toHaveBeenCalled()
    if (destination !== '/away') expect(host.querySelector('output')?.textContent).toBe('false')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    router.dispose()
  }
})
