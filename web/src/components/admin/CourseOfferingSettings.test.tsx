// @vitest-environment jsdom
import { TestRouter } from '../../test/TestRouter'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CourseOfferingSettings } from './CourseOfferingSettings'
import type { CourseOfferingTerms } from '../../types/api'
const api = vi.hoisted(() => ({ getCohortInstructorAssignments: vi.fn(), updateCohort: vi.fn() }))
vi.mock('../../lib/api', () => ({ api }))
let root: Root, container: HTMLDivElement
const cohort: CourseOfferingTerms & { id: number } = {
  id: 13, public_checkout_enabled: false, public_price_cents: 14900, stripe_price_id: 'price_python', support_instructor_id: 9,
  self_paced_access_months: 12, self_paced_support_weeks: 6,
  offering_readiness: { curriculum_assigned: true, price_set: true, support_instructor_set: true, published_content: true, cohort_active: true },
}
const onSaved = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  api.getCohortInstructorAssignments.mockResolvedValue({ data: { instructors: [{ id: 9, full_name: 'Assigned instructor' }] } })
  api.updateCohort.mockResolvedValue({ data: { cohort } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })
const render = async (value = cohort) => act(async () => root.render(<TestRouter><CourseOfferingSettings cohort={value} onSaved={onSaved} /></TestRouter>))
it('shows readiness and keeps checkout off by default', async () => {
  await render()
  expect(container.textContent).toContain('Ready: Selected modules contain a published lesson with content')
  expect((container.querySelector('[type="checkbox"]') as HTMLInputElement).checked).toBe(false)
  expect(container.textContent).toContain('Existing purchasers keep their agreed access dates')
  expect(container.querySelectorAll('select option')).toHaveLength(2)
})
it('explains missing readiness and prevents checkout visibility', async () => {
  await render({ ...cohort, offering_readiness: { ...cohort.offering_readiness, published_content: false } })
  expect(container.textContent).toContain('Needed: Selected modules contain a published lesson with content')
  expect((container.querySelector('[type="checkbox"]') as HTMLInputElement).disabled).toBe(true)
})
it('saves all offering terms and refreshes server readiness', async () => {
  await render()
  await act(async () => {
    const input = container.querySelector('input[type="number"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '199.50')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(api.updateCohort).toHaveBeenCalledWith(13, { public_checkout_enabled: false, public_price_cents: 19950, stripe_price_id: 'price_python', support_instructor_id: 9, self_paced_access_months: 12, self_paced_support_weeks: 6 })
  expect(onSaved).toHaveBeenCalledOnce()
  expect(container.textContent).toContain('Course offering saved')
})
it('keeps the draft and shows server validation errors', async () => {
  api.updateCohort.mockResolvedValue({ data: null, error: 'Support instructor must be assigned' })
  await render()
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('must be assigned')
  expect((container.querySelector('select') as HTMLSelectElement).value).toBe('9')
  expect(onSaved).not.toHaveBeenCalled()
})

it('links catalog preview and every readiness item to its repair location', async () => {
  await render()
  expect(container.querySelector('a[href="/courses?offering_id=13"]')?.textContent).toBe('View in catalog')
  const links = [...container.querySelectorAll('li a')].map(link => link.getAttribute('href'))
  expect(links).toEqual(['/admin/content?open=', '/#offering-price', '/admin/cohorts/13?tab=team', '/admin/content?open=', '/#cohort-status'])
  expect(container.querySelector('#offering-price')).not.toBeNull()
})

it('stages offering edits for the cohort save without a second save button', async () => {
  const onDraftChange = vi.fn()
  await act(async () => root.render(<TestRouter><CourseOfferingSettings cohort={cohort} onSaved={onSaved} onDraftChange={onDraftChange} /></TestRouter>))
  await act(async () => { const input = container.querySelector('#offering-price')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '299'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ public_price_cents: 29900 }))
  expect(container.textContent).not.toContain('Save course offering'); expect(api.updateCohort).not.toHaveBeenCalled()
})

it('leaves an archived checkout offering clean and stages only the edited price', async () => {
  const onDraftChange = vi.fn()
  const archived = { ...cohort, public_checkout_enabled: true, offering_readiness: { ...cohort.offering_readiness, cohort_active: false } }
  await act(async () => root.render(<TestRouter><CourseOfferingSettings cohort={archived} onSaved={onSaved} onDraftChange={onDraftChange} /></TestRouter>))
  expect(onDraftChange).toHaveBeenLastCalledWith({})
  expect(api.updateCohort).not.toHaveBeenCalled()
  await act(async () => { const input = container.querySelector('#offering-price')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '299'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(onDraftChange).toHaveBeenLastCalledWith({ public_price_cents: 29900 })
})
