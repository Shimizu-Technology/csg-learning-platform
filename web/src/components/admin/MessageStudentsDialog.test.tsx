// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MessageStudentsDialog } from './MessageStudentsDialog'
import { ToastProvider } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import type { BulkRecipient } from '../../lib/bulkMessage'

vi.mock('../../lib/api', () => ({ api: { createDirectConversation: vi.fn(), createDirectMessage: vi.fn() } }))
// A plain textarea stands in for the rich editor; the dialog only needs its value.
vi.mock('../shared/MarkdownEditor', () => ({
  MarkdownEditor: ({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) => (
    <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

const createDirectConversation = vi.mocked(api.createDirectConversation)
const createDirectMessage = vi.mocked(api.createDirectMessage)
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  createDirectConversation.mockReset()
  createDirectMessage.mockReset()
  createDirectConversation.mockImplementation(async ({ cohort_id, user_ids }) => ({ data: { direct_conversation: { id: (cohort_id ?? 0) * 100 + user_ids[0] } }, error: null, status: 201 }) as never)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

function render(recipients: BulkRecipient[], onSent?: (keys: string[]) => void) {
  act(() => root.render(<ToastProvider><MemoryRouter><MessageStudentsDialog open recipients={recipients} onClose={() => {}} onSent={onSent} /></MemoryRouter></ToastProvider>))
}

async function writeAndSend(body: string) {
  const textarea = document.body.querySelector('textarea')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, body)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const form = document.body.querySelector('form')!
  await act(async () => { form.requestSubmit() })
}

function outcomeRows() {
  const list = document.body.querySelector('ul[aria-label="Who got the message"]')!
  return [...list.querySelectorAll('li')].map((row) => row.textContent)
}

it('lists every recipient after a rate-limit pause, including the ones never tried', async () => {
  createDirectMessage.mockImplementation(async (conversationId) => (conversationId === 302
    ? { data: null, error: 'Too many requests', status: 429 }
    : { data: {}, error: null, status: 201 }) as never)
  render([1, 2, 3, 4].map((userId) => ({ userId, name: `Learner ${userId}`, cohortId: 3 })))
  await writeAndSend('Checking in')

  expect(outcomeRows()).toEqual([
    'Learner 1Sent',
    'Learner 2Paused: you’ve sent a lot of messages this minute. Try again shortly.',
    'Learner 3Not sent after the pause.',
    'Learner 4Not sent after the pause.',
  ])
  expect(createDirectConversation).toHaveBeenCalledTimes(2)
  expect(document.body.textContent).toContain('Done')
})

it('sends one message to a student selected in two cohorts and says so', async () => {
  createDirectMessage.mockImplementation(async () => ({ data: {}, error: null, status: 201 }) as never)
  render([
    { userId: 7, name: 'Ana', cohortId: 3 },
    { userId: 8, name: 'Ben', cohortId: 3 },
    { userId: 7, name: 'Ana', cohortId: 4 },
  ])
  expect(document.body.textContent).toContain('Message 2 students')
  expect(document.body.textContent).toContain('Ana is in 2 selected cohorts; one message will be sent.')
  await writeAndSend('Checking in')

  expect(createDirectConversation.mock.calls.map(([data]) => data)).toEqual([{ cohort_id: 3, user_ids: [7] }, { cohort_id: 3, user_ids: [8] }])
  expect(createDirectMessage).toHaveBeenCalledTimes(2)
  expect(outcomeRows()).toEqual(['AnaSent', 'BenSent'])
  expect(document.body.textContent).toContain('Ana is in 2 selected cohorts; one message sent.')
})

it('hands back only the recipients who got the message, so the rest stay selected for the next batch', async () => {
  createDirectMessage.mockImplementation(async (conversationId) => (conversationId === 302
    ? { data: null, error: 'Couldn’t send.', status: 500 }
    : conversationId === 324 ? { data: null, error: 'Too many requests', status: 429 } : { data: {}, error: null, status: 201 }) as never)
  const onSent = vi.fn()
  // 26 selected: the dialog sends to the first 25, so the 26th is never tried.
  render(Array.from({ length: 26 }, (_, index) => ({ userId: index + 1, name: `Learner ${index + 1}`, cohortId: 3 })), onSent)
  await writeAndSend('Checking in')
  const done = [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Done')!
  act(() => done.click())

  expect(onSent).toHaveBeenCalledTimes(1)
  const sentKeys: string[] = onSent.mock.calls[0][0]
  // 1 and 3 through 23 were sent; 2 failed, 24 hit the rate limit, 25 was not tried after it, 26 was over the limit.
  expect(sentKeys).toEqual([1, ...Array.from({ length: 21 }, (_, index) => index + 3)].map((userId) => `${userId}:3`))
  for (const kept of ['2:3', '24:3', '25:3', '26:3']) expect(sentKeys).not.toContain(kept)
})
