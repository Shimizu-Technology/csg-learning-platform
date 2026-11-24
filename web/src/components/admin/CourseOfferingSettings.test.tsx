// @vitest-environment jsdom
import { TestRouter } from '../../test/TestRouter'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CourseOfferingSettings } from './CourseOfferingSettings'
import type { CourseOfferingTerms } from '../../types/api'
const api = vi.hoisted(() => ({ getCohortInstructorAssignments: vi.fn(), updateCohort: vi.fn(), getSetupReadiness: vi.fn(), verifyOfferingPrice: vi.fn() }))
vi.mock('../../lib/api', () => ({ api }))
let root: Root, container: HTMLDivElement
const stamp = { stripe_price_id: 'price_python', price_cents: 14900, verified_at: '2026-11-24T02:00:00Z' }
const cohort: CourseOfferingTerms & { id: number } = {
  id: 13, public_checkout_enabled: false, public_price_cents: 14900, stripe_price_id: 'price_python', support_instructor_id: 9,
  self_paced_access_months: 12, self_paced_support_weeks: 6,
  offering_price_verified: stamp,
  offering_readiness: { curriculum_assigned: true, price_set: true, price_verified: true, support_instructor_set: true, published_content: true, cohort_active: true },
}
const onSaved = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  api.getCohortInstructorAssignments.mockResolvedValue({ data: { instructors: [{ id: 9, full_name: 'Assigned instructor' }] } })
  api.getSetupReadiness.mockResolvedValue({ data: { readiness: { ...cohort.offering_readiness, catalog_copy: false, school_checkout_enabled: false }, errors: [] } })
  api.updateCohort.mockResolvedValue({ data: { cohort } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })
const render = async (value = cohort) => act(async () => root.render(<TestRouter><CourseOfferingSettings cohort={value} onSaved={onSaved} /></TestRouter>))
it.each(['error', 'rejection'])('stages marketing independently of instructor loading (%s)', async failure => {
  if (failure === 'error') api.getCohortInstructorAssignments.mockResolvedValue({ error: 'Unavailable' })
  else api.getCohortInstructorAssignments.mockRejectedValue(new Error('Offline'))
  const onDraftChange = vi.fn()
  await act(async () => root.render(<TestRouter><CourseOfferingSettings cohort={cohort} onSaved={onSaved} onDraftChange={onDraftChange} /></TestRouter>))
  const field = [...container.querySelectorAll('label')].find(el => el.textContent?.startsWith('Public title'))!.querySelector('input')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Keep this draft'); field.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(onDraftChange).toHaveBeenLastCalledWith({ public_title: 'Keep this draft' })
  expect(container.textContent).toContain('Course copy can still be saved')
  expect((container.querySelector('select') as HTMLSelectElement).disabled).toBe(true)
  expect((container.querySelector('[type="checkbox"]') as HTMLInputElement).disabled).toBe(true)
})
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
  expect(api.updateCohort).toHaveBeenCalledWith(13, expect.objectContaining({ public_price_cents: 19950, stripe_price_id: 'price_python', support_instructor_id: 9, self_paced_access_months: 12, self_paced_support_weeks: 6 }))
  expect(api.updateCohort.mock.calls[0][1]).not.toHaveProperty('public_checkout_enabled')
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
  expect(links).toEqual(['/admin/content?open=', '/#offering-price', '/#offering-stripe-price', '/admin/cohorts/13?tab=team', '/admin/content?open=', '/#cohort-status', '/#offering-price', '/#offering-price'])
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

it('uses server catalog and school checks before enabling visibility', async () => {
  await render()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
  expect(api.getSetupReadiness).toHaveBeenCalledWith(13, expect.objectContaining({ stripe_price_id: 'price_python' }))
  expect(container.textContent).toContain('Needed: Public title, description and image set')
  expect(container.textContent).toContain('Needed: School checkout is on')
  expect((container.querySelector('[type="checkbox"]') as HTMLInputElement).disabled).toBe(true)
})

it('edits the remaining public marketing fields without implicitly writing checkout visibility', async () => {
  await render({ ...cohort, public_checkout_enabled: true })
  for (const [label, value] of [['What learners will learn', 'Explain your own code'], ['Estimated duration', '6 hours'], ['Prerequisites', 'A browser'], ['Course preview', 'Try a counter']]) {
    const control = [...container.querySelectorAll('label')].find(el => el.textContent?.startsWith(label))!.querySelector('input,textarea')!
    await act(async () => { Object.getOwnPropertyDescriptor(control.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(api.updateCohort).toHaveBeenCalledWith(13, expect.objectContaining({ public_outcomes: 'Explain your own code', public_duration: '6 hours', public_prerequisites: 'A browser', public_preview: 'Try a counter' }))
  expect(api.updateCohort.mock.calls[0][1]).not.toHaveProperty('public_checkout_enabled')
})

it('uses unsaved public copy to refresh readiness and enable checkout in this form', async () => {
  api.getSetupReadiness.mockImplementation(async (_id, patch) => ({ data: { readiness: { ...cohort.offering_readiness, school_checkout_enabled: true, catalog_copy: Boolean(patch.public_title && patch.public_description && patch.public_image_url) }, errors: [] } }))
  await render()
  for (const [label, value] of [['Public title', 'Public course'], ['Description', 'Learn something'], ['Image URL (HTTPS)', 'https://example.test/course.png']]) {
    const control = [...container.querySelectorAll('label')].find(el => el.textContent?.startsWith(label))!.querySelector('input,textarea')!
    await act(async () => { Object.getOwnPropertyDescriptor(control.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
  expect(api.getSetupReadiness).toHaveBeenLastCalledWith(13, expect.objectContaining({ public_title: 'Public course', public_description: 'Learn something', public_image_url: 'https://example.test/course.png' }))
  expect((container.querySelector('[type="checkbox"]') as HTMLInputElement).disabled).toBe(false)
  expect(api.updateCohort).not.toHaveBeenCalled()
})

it('validates and stages seat limit and unlisted toggle for guided cohorts without self-paced duration fields', async () => {
  const onDraftChange = vi.fn()
  await act(async () => root.render(<TestRouter><CourseOfferingSettings cohort={{ ...cohort, seat_limit: 15, seats_taken: 4, seats_remaining: 11, sold_out: false, unlisted: false, public_slug: 'python-pilot' }} courseDelivery="guided" onSaved={onSaved} onDraftChange={onDraftChange} /></TestRouter>))
  expect(container.textContent).not.toContain('Lesson access (months)')
  expect(container.textContent).not.toContain('Help period (weeks)')
  expect(container.textContent).toContain('Currently 4 of 15 seats occupied')

  const seatInput = container.querySelector('#offering-seat-limit') as HTMLInputElement
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(seatInput, '0'); seatInput.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('at least 1')

  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(seatInput, '20'); seatInput.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(onDraftChange).toHaveBeenLastCalledWith({ seat_limit: 20 })

  const unlistedBox = container.querySelector('#offering-unlisted') as HTMLInputElement
  await act(async () => { unlistedBox.click() })
  expect(onDraftChange).toHaveBeenLastCalledWith({ seat_limit: 20, unlisted: true })
  expect(container.textContent).toContain('/courses/python-pilot')
})

it('requires a verified price and reports the live amount after verification', async () => {
  const draft = { ...cohort, offering_price_verified: null, offering_readiness: { ...cohort.offering_readiness, price_verified: false } }
  api.getSetupReadiness.mockResolvedValue({ data: { readiness: { ...cohort.offering_readiness, catalog_copy: true, school_checkout_enabled: true }, errors: [] } })
  api.verifyOfferingPrice.mockResolvedValue({ data: { offering_price_verified: stamp } })
  await render(draft)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
  const checkout = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
  expect(checkout.disabled).toBe(true)
  const verify = [...container.querySelectorAll('button')].find(button => button.textContent === 'Verify price in Stripe')!
  await act(async () => verify.click())
  expect(api.verifyOfferingPrice).toHaveBeenCalledWith(13)
  expect(container.textContent).toContain('Verified in Stripe · $149.00 USD')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
  expect(checkout.disabled).toBe(false)
})

it('shows the exact Stripe failure and asks to save price edits before verification', async () => {
  const draft = { ...cohort, offering_price_verified: null }
  api.verifyOfferingPrice.mockResolvedValue({ error: 'Stripe price is $199.00 USD, but display price is $149.00 USD.' })
  await render(draft)
  const verify = [...container.querySelectorAll('button')].find(button => button.textContent === 'Verify price in Stripe')!
  await act(async () => verify.click())
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Stripe price is $199.00 USD, but display price is $149.00 USD.')
  const stripeId = container.querySelector<HTMLInputElement>('#offering-stripe-price')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(stripeId, 'price_replacement'); stripeId.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(verify.disabled).toBe(true)
  expect(container.textContent).toContain('Save the course offering to verify this price.')
  expect(container.querySelector('[role="alert"]')).toBeNull()
})

it.each([['#offering-price', '199.00'], ['#offering-stripe-price', 'price_changed']])('clears the verified badge and prevents enabling checkout while editing %s', async (selector, value) => {
  await render()
  const control = container.querySelector<HTMLInputElement>(selector)!
  expect(container.textContent).toContain('Verified in Stripe')
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(container.textContent).not.toContain('Verified in Stripe')
  expect(container.textContent).toContain('Save the course offering to verify this price.')
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true)
})
