// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { PersonActions } from './PersonActions'
import { PreviewNavigationContext } from '../../contexts/PreviewNavigationContext'
const create = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', () => ({ api: { createDirectConversation: create, getAvailableDirectUsersForCohort: vi.fn().mockResolvedValue({ data: { users: [{ id: 9 }, { id: 10 }] } }) } }))
function Location() {
  const location = useLocation()
  return (
    <output>
      {location.pathname}
      {location.search}
    </output>
  )
}
it('opens the named exact conversation and hides booking when meetings are off', async () => {
  create.mockResolvedValue({ data: { direct_conversation: { id: 77, cohort_id: 3 } } })
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <PersonActions person={{ id: 9, full_name: 'Tia Teacher', role: 'instructor' }} cohortId={3} />
          <Location />
        </MemoryRouter>
      )
    )
    expect(host.textContent).not.toContain('Book a meeting')
    await act(async () => host.querySelector('button')!.click())
    expect(create).toHaveBeenLastCalledWith({ cohort_id: 3, user_ids: [9] })
    expect(host.querySelector('output')?.textContent).toBe('/messages/dm/77?cohort_id=3')
  } finally {
    await act(async () => root.unmount())
  }
})
it('offers booking only for instructors and contains preview without writes', async () => {
  create.mockClear()
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    const content = (
      <PersonActions person={{ id: 9, full_name: 'Tia Teacher', role: 'instructor' }} cohortId={3} meetings />
    )
    await act(async () => root.render(<MemoryRouter>{content}</MemoryRouter>))
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/meetings?cohort_id=3&instructor_id=9')
    await act(async () =>
      root.render(
        <MemoryRouter>
          <PreviewNavigationContext.Provider value={(path) => `/preview${path}`}>
            {content}
          </PreviewNavigationContext.Provider>
        </MemoryRouter>
      )
    )
    expect(host.querySelector('button,a')).toBeNull()
    expect(create).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
  }
})

it('ignores a late conversation response after the displayed person changes', async () => {
  let resolve: (value: unknown) => void = () => {}
  create.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const host = document.createElement('div'); const root = createRoot(host)
  const tree = (id: number) => <MemoryRouter><PersonActions person={{ id, full_name: `Teacher ${id}` }} cohortId={3} /><Location /></MemoryRouter>
  try {
    await act(async () => root.render(tree(9)))
    await act(async () => host.querySelector('button')!.click())
    await act(async () => root.render(tree(10)))
    expect(host.querySelector('button')?.disabled).toBe(false)
    await act(async () => resolve({ data: { direct_conversation: { id: 99, cohort_id: 3 } } }))
    expect(host.querySelector('output')?.textContent).toBe('/')
  } finally { await act(async () => root.unmount()) }
})

it('hides both actions when either direction of block removes the person from the permitted directory', async () => {
  vi.mocked(api.getAvailableDirectUsersForCohort).mockResolvedValueOnce({ data: { users: [] }, error: null })
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(<MemoryRouter><PersonActions person={{ id: 9, full_name: 'Blocked Teacher', role: 'instructor' }} cohortId={3} meetings /></MemoryRouter>))
    expect(host.querySelector('button,a')).toBeNull()
  } finally { await act(async () => root.unmount()) }
})
it('never offers meeting booking for an admin author', async () => {
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(<MemoryRouter><PersonActions person={{ id: 9, full_name: 'Admin', role: 'admin' }} cohortId={3} meetings /></MemoryRouter>))
    expect(host.textContent).toContain('Message Admin')
    expect(host.querySelector('a')).toBeNull()
  } finally { await act(async () => root.unmount()) }
})
