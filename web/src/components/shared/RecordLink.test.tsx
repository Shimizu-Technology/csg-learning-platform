// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PreviewNavigationContext } from '../../contexts/PreviewNavigationContext'
import { studentPreviewPath } from '../../lib/studentPreviewPath'
import { RecordLink } from './RecordLink'

const auth = vi.hoisted(() => ({ user: { id: 1, is_staff: true, is_admin: false } as { id: number; is_staff: boolean; is_admin: boolean } | null }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: auth.user, enrollments: [] }) }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  auth.user = { id: 1, is_staff: true, is_admin: false }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function Where() {
  const location = useLocation()
  return <output data-testid="where">{`${location.pathname}${location.search}`}|{JSON.stringify(location.state)}</output>
}

function render(element: React.ReactNode, at = '/admin/support?view=active') {
  act(() => root.render(
    <MemoryRouter initialEntries={[at]}>
      <Routes><Route path="*" element={<>{element}<Where /></>} /></Routes>
    </MemoryRouter>,
  ))
}

it('renders a real link that carries the current page as return_to', () => {
  render(<RecordLink record={{ type: 'help_request', id: 9 }}>Nested routes</RecordLink>)
  const link = container.querySelector('a')!
  expect(link.getAttribute('href')).toBe('/admin/help-requests/9?return_to=%2Fadmin%2Fsupport%3Fview%3Dactive')
  expect(link.textContent).toBe('Nested routes')
  expect(link.className).toBe('record-link')
})

it('navigates in place on a plain click and leaves modifier clicks to the browser', () => {
  render(<RecordLink record={{ type: 'intervention', id: 61 }}>Follow-up</RecordLink>)
  const link = container.querySelector('a')!
  // Record whether the router claimed the click, then stop jsdom's own (unimplemented) navigation.
  let routerHandled: boolean | null = null
  const browser = (event: Event) => { routerHandled = event.defaultPrevented; event.preventDefault() }
  document.addEventListener('click', browser)
  act(() => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true })) })
  document.removeEventListener('click', browser)
  // React Router leaves ⌘-click alone, so the browser opens the href in a new tab.
  expect(routerHandled).toBe(false)
  expect(container.querySelector('[data-testid="where"]')!.textContent).toContain('/admin/support?view=active')
  act(() => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })) })
  expect(container.querySelector('[data-testid="where"]')!.textContent).toContain('/admin/interventions/61?return_to=%2Fadmin%2Fsupport%3Fview%3Dactive')
})

it('renders plain text, not a dead link, when the viewer cannot open the record', () => {
  auth.user = { id: 2, is_staff: false, is_admin: false }
  render(<RecordLink record={{ type: 'help_request', id: 9 }} className="truncate">Nested routes</RecordLink>, '/dashboard')
  expect(container.querySelector('a')).toBeNull()
  const text = container.querySelector('[data-record-link="unavailable"]')!
  expect(text.tagName).toBe('SPAN')
  expect(text.textContent).toBe('Nested routes')
  expect(text.className).toBe('truncate')
})

it('renders plain text for records without a page and for signed-out viewers', () => {
  render(<RecordLink record={{ type: 'curriculum', id: 2 }}>Web Development</RecordLink>)
  expect(container.querySelector('a')).toBeNull()
  auth.user = null
  render(<RecordLink record={{ type: 'cohort', id: 7 }}>Cohort 3</RecordLink>)
  expect(container.querySelector('a')).toBeNull()
})

it('keeps caller styling, adds a 44px target on request, and passes a Back label as router state', () => {
  render(<RecordLink record={{ type: 'student', id: 12, cohortId: 7 }} variant="plain" touchTarget truncate className="font-normal" linkClassName="text-sm" returnLabel="Students">Alex Rivera</RecordLink>, '/admin/students?q=alex')
  const link = container.querySelector('a')!
  // 44px on phones, compact from `sm` up; the name truncates in its own box because a flex box ignores the parent's ellipsis.
  expect(link.className).toBe('record-link-plain inline-flex max-w-full min-h-11 items-center sm:min-h-0 font-normal text-sm')
  expect(link.firstElementChild?.className).toBe('truncate')
  expect(link.textContent).toBe('Alex Rivera')
  act(() => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })) })
  expect(container.querySelector('[data-testid="where"]')!.textContent).toBe('/admin/cohorts/7/students/12/overview|{"returnTo":"/admin/students?q=alex","returnLabel":"Students"}')
})

it('opens learner pages inside a staff preview of the learner view', () => {
  auth.user = { id: 1, is_staff: true, is_admin: true }
  render(
    <PreviewNavigationContext.Provider value={(path) => studentPreviewPath(path, 7, 12)}>
      <RecordLink record={{ type: 'lesson', id: 42, cohortId: 7 }}>Loops</RecordLink>
    </PreviewNavigationContext.Provider>,
    '/admin/cohorts/7/student-view',
  )
  expect(container.querySelector('a')!.getAttribute('href')).toBe('/admin/cohorts/7/student-view/lessons/42?student_id=12')
})

it('opens the lesson editor for admins and the lesson for instructors', () => {
  auth.user = { id: 1, is_staff: true, is_admin: true }
  render(<RecordLink record={{ type: 'lesson', id: 42, cohortId: 7 }}>Loops</RecordLink>)
  expect(container.querySelector('a')!.getAttribute('href')).toBe('/admin/lessons/42/edit')
  auth.user = { id: 1, is_staff: true, is_admin: false }
  render(<RecordLink record={{ type: 'lesson', id: 42, cohortId: 7 }}>Loops</RecordLink>)
  expect(container.querySelector('a')!.getAttribute('href')).toBe('/lessons/42?cohort_id=7&return_to=%2Fadmin%2Fsupport%3Fview%3Dactive')
})
