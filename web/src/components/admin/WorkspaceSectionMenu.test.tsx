// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { LeaveGuardProvider } from '../../lib/useLeaveGuard'
import { UnsavedChangesGuard } from '../shared/UnsavedChangesGuard'
import { WorkspaceSectionMenu } from './WorkspaceSectionMenu'

const viewport = vi.hoisted(() => ({ width: 390 }))
vi.mock('../../lib/useMediaQuery', () => ({
  useMediaQuery: (query: string) => {
    if (query === 'not all and (min-width: 1024px)') return viewport.width < 1024
    if (query === '(max-width: 1023px)') return viewport.width <= 1023
    return false
  },
}))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sections = [
  { to: '/admin/cohorts/2', label: 'Overview' },
  { to: '/admin/cohorts/2?tab=students', label: 'Students' },
  { to: '/admin/cohorts/2?tab=settings', label: 'Settings' },
]
const state = { returnTo: '/admin/students?q=QA', returnLabel: 'Filtered students' }
async function setup(dirty = false) {
  function Screen() {
    const location = useLocation()
    return (
      <>
        <UnsavedChangesGuard dirty={dirty && location.search === '?tab=settings'} pathnameOnly={false} />
        <WorkspaceSectionMenu
          label="Cohort sections"
          value={location.pathname + location.search}
          sections={sections}
          state={state}
        />
      </>
    )
  }
  const router = createMemoryRouter(
    [
      {
        element: (
          <LeaveGuardProvider>
            <Outlet />
          </LeaveGuardProvider>
        ),
        children: [{ path: '*', element: <Screen /> }],
      },
    ],
    { initialEntries: [dirty ? sections[2].to : sections[0].to] },
  )
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<RouterProvider router={router} />))
  const button = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  expect(button).not.toBeNull()
  return {
    container,
    router,
    button,
    close: async () => {
      await act(async () => root.unmount())
      router.dispose()
      container.remove()
    },
  }
}

it('discloses real links without navigating on intermediate keys, pushes once on activation, and preserves Back', async () => {
  const app = await setup()
  try {
    expect(app.button.textContent).toContain('Section: Overview')
    expect(app.button.getAttribute('aria-expanded')).toBe('false')
    await act(async () => app.button.click())
    const links = [...app.container.querySelectorAll('a')]
    expect(links.map((link) => link.getAttribute('href'))).toEqual(sections.map((section) => section.to))
    expect(links[0].getAttribute('aria-current')).toBe('page')
    for (const key of ['s', 'e', 'ArrowDown', 'ArrowDown']) {
      await act(async () => app.button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
    }
    expect(app.router.state.location.search).toBe('')
    // Modified clicks retain browser new-tab behavior rather than invoking router navigation.
    await act(async () =>
      links[2].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })),
    )
    expect(app.router.state.location.search).toBe('')
    expect(app.button.getAttribute('aria-expanded')).toBe('true')
    await act(async () => links[2].click())
    expect(app.router.state.location.search).toBe('?tab=settings')
    expect(app.router.state.location.state).toEqual(state)
    expect(app.button.textContent).toContain('Section: Settings')
    expect(app.button.getAttribute('aria-expanded')).toBe('false')
    await act(async () => {
      await app.router.navigate(-1)
    })
    expect(app.router.state.location.search).toBe('')
    expect(app.button.textContent).toContain('Section: Overview')
  } finally {
    await app.close()
  }
})

it('returns focus to the disclosure button on Escape', async () => {
  const app = await setup()
  try {
    await act(async () => app.button.click())
    const link = app.container.querySelector('a')!
    link.focus()
    await act(async () => link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(app.button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(app.button)
  } finally {
    await app.close()
  }
})

it('keeps a Settings draft until a link is activated and honors Keep editing', async () => {
  const app = await setup(true)
  try {
    await act(async () => app.button.click())
    for (const key of ['s', 'e', 'ArrowDown']) {
      await act(async () => app.button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
    }
    expect(document.body.textContent).not.toContain('Leave without saving?')
    expect(app.router.state.location.search).toBe('?tab=settings')
    const link = app.container.querySelector<HTMLAnchorElement>('a[href="/admin/cohorts/2?tab=students"]')!
    await act(async () => link.click())
    expect(document.body.textContent).toContain('Leave without saving?')
    const keep = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Keep editing')!
    await act(async () => keep.click())
    expect(app.router.state.location.search).toBe('?tab=settings')
    expect(app.button.textContent).toContain('Section: Settings')
    expect(app.button.getAttribute('aria-expanded')).toBe('false')
  } finally {
    await app.close()
  }
})

// jsdom has no fractional CSS viewport; evaluate the two media-query boundaries explicitly.
it.each([1023.25, 1023.5, 1023.98])('keeps a section control at fractional width %s', async (width) => {
  viewport.width = width
  const app = await setup()
  try {
    expect(app.button.textContent).toContain('Section: Overview')
  } finally {
    viewport.width = 390
    await app.close()
  }
})
