// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { HelpRequest, HelpRequestReplyResponse, LearnerCapabilities } from '../../types/api'

const replyToHelpRequest = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', () => ({ api: { getHelpRequests: vi.fn(), replyToHelpRequest } }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../shared/Modal', () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { ContextualHelp } from './ContextualHelp'

const capabilities: LearnerCapabilities = { live_support: true, features: {}, can_submit: true, read_only: false, support_mode: 'guided_help', support_expires_at: null, access_expires_at: null, support_instructor_id: 9 }
const staffReply = { id: 1, body: 'What error did you see?', resolved_request: false, from_student: false, author: { id: 9, full_name: 'Ina Teacher' }, created_at: '2026-10-01T01:00:00Z' }
const active: HelpRequest = { destination: null, context_destination: null, id: 31, cohort: { id: 4, name: 'Python' }, context_type: 'lesson', context_source: 'primary', context_id: 42, context_label: 'Lists', context_path: '/lessons/42', category: 'concept', urgency: 'normal', status: 'acknowledged', message: 'Lesson question', staff_response: staffReply.body, acknowledged_at: null, resolved_at: null, canceled_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', owner: { id: 9, full_name: 'Ina Teacher' }, replies: [staffReply] }

let root: Root
let container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); replyToHelpRequest.mockReset() })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

const box = () => container.querySelector<HTMLTextAreaElement>('#help-follow-up-31')!
const typeInto = async (text: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box(), text)
  box().dispatchEvent(new Event('input', { bubbles: true }))
})
const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label))!

it('locks the follow-up box while it sends and never wipes text that changed meanwhile', async () => {
  let finish!: (value: { data: HelpRequestReplyResponse; error: null }) => void
  replyToHelpRequest.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  await act(async () => root.render(<MemoryRouter><ContextualHelp capabilities={capabilities} cohortId={4} contextType="lesson" contextId={42} contextLabel="Lists" requests={[active]} requestsLoading={false} /></MemoryRouter>))
  await act(async () => button('Your instructor replied').click())
  await typeInto('NoMethodError on each')
  await act(async () => button('Send reply').click())
  expect(box().disabled).toBe(true)
  // Even if text arrives while sending (the box is locked for people), the success must not erase it.
  await typeInto('NoMethodError on each, and also on map')
  const followUp = { id: 2, body: 'NoMethodError on each', resolved_request: false, from_student: true, author: { id: 7, full_name: 'Student Test' }, created_at: '2026-10-01T02:00:00Z' }
  await act(async () => finish({ data: { help_request: { ...active, replies: [staffReply, followUp] }, reply: followUp, replayed: false }, error: null }))
  expect(box().disabled).toBe(false)
  expect(box().value).toBe('NoMethodError on each, and also on map')
})

it('clears the draft once the text it sent is saved', async () => {
  const followUp = { id: 2, body: 'NoMethodError on each', resolved_request: false, from_student: true, author: { id: 7, full_name: 'Student Test' }, created_at: '2026-10-01T02:00:00Z' }
  replyToHelpRequest.mockResolvedValue({ data: { help_request: { ...active, replies: [staffReply, followUp] }, reply: followUp, replayed: false }, error: null })
  await act(async () => root.render(<MemoryRouter><ContextualHelp capabilities={capabilities} cohortId={4} contextType="lesson" contextId={42} contextLabel="Lists" requests={[active]} requestsLoading={false} /></MemoryRouter>))
  await act(async () => button('Your instructor replied').click())
  await typeInto('NoMethodError on each')
  await act(async () => button('Send reply').click())
  expect(box().value).toBe('')
})
