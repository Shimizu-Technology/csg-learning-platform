import { describe, expect, it, vi } from 'vitest'
import { MAX_BULK_RECIPIENTS, sendToEach, summarizeBulk, type BulkMessageApi, type BulkRecipient } from './bulkMessage'

const people = (count: number): BulkRecipient[] => Array.from({ length: count }, (_, index) => ({ userId: index + 1, name: `Learner ${index + 1}`, cohortId: 3 }))

function fakeApi(responses: Record<number, { status: number; error?: string }> = {}) {
  const createDirectConversation = vi.fn(async ({ user_ids }: { cohort_id: number; user_ids: number[] }) => {
    const failure = responses[user_ids[0]]
    if (failure && failure.status !== 429) return { data: null, error: failure.error || 'Nope', status: failure.status }
    return { data: { direct_conversation: { id: 100 + user_ids[0] } }, error: null, status: 201 }
  })
  const createDirectMessage = vi.fn(async (conversationId: number, data: { body: string; client_message_id: string }) => {
    const failure = data.body ? responses[conversationId - 100] : undefined
    if (failure?.status === 429) return { data: null, error: 'Too many requests', status: 429 }
    return { data: {}, error: null, status: 201 }
  })
  return { createDirectConversation, createDirectMessage } satisfies BulkMessageApi
}

describe('message selected students (T-3)', () => {
  it('sends each student their own direct message, one at a time, through the normal endpoints', async () => {
    const api = fakeApi()
    const results = await sendToEach(api, people(3), 'Checking in', 'batch1')
    expect(api.createDirectConversation.mock.calls.map(([data]) => data)).toEqual([
      { cohort_id: 3, user_ids: [1] }, { cohort_id: 3, user_ids: [2] }, { cohort_id: 3, user_ids: [3] },
    ])
    expect(api.createDirectMessage.mock.calls.map(([id, data]) => [id, data])).toEqual([
      [101, { body: 'Checking in', client_message_id: 'bulk-batch1-1' }],
      [102, { body: 'Checking in', client_message_id: 'bulk-batch1-2' }],
      [103, { body: 'Checking in', client_message_id: 'bulk-batch1-3' }],
    ])
    expect(summarizeBulk(results)).toMatchObject({ sent: 3, total: 3, unsent: [] })
  })

  it('reports a student the server refuses (blocked or not reachable) and keeps going', async () => {
    const api = fakeApi({ 2: { status: 403, error: 'This direct conversation is unavailable because one of its members is blocked' } })
    const results = await sendToEach(api, people(3), 'Hi', 'b')
    expect(results.map((result) => result.outcome.status)).toEqual(['sent', 'blocked', 'sent'])
    expect(api.createDirectMessage).toHaveBeenCalledTimes(2)
    expect(summarizeBulk(results).unsent.map((result) => result.name)).toEqual(['Learner 2'])
  })

  it('stops at the message rate limit instead of retrying, and says who was not sent', async () => {
    const api = fakeApi({ 2: { status: 429 } })
    const results = await sendToEach(api, people(4), 'Hi', 'b')
    expect(results.map((result) => result.outcome.status)).toEqual(['sent', 'rate_limited', 'not_sent', 'not_sent'])
    expect(api.createDirectConversation).toHaveBeenCalledTimes(2)
  })

  it(`never sends to more than ${MAX_BULK_RECIPIENTS} students in one batch`, async () => {
    const api = fakeApi()
    const results = await sendToEach(api, people(MAX_BULK_RECIPIENTS + 5), 'Hi', 'b')
    expect(results).toHaveLength(MAX_BULK_RECIPIENTS)
    // Two requests a student stays inside the 120-a-minute message limit (#252).
    expect(MAX_BULK_RECIPIENTS * 2).toBeLessThan(120)
  })
})
