import { describe, expect, it, vi } from 'vitest'
import { MAX_BULK_RECIPIENTS, bulkClientMessageId, dedupeRecipients, duplicateNote, duplicateNoteState, recipientKey, sendToEach, sentRecipientKeys, summarizeBulk, type BulkMessageApi, type BulkRecipient } from './bulkMessage'

const people = (count: number): BulkRecipient[] => Array.from({ length: count }, (_, index) => ({ userId: index + 1, name: `Learner ${index + 1}`, cohortId: 3 }))

function fakeApi(responses: Record<number, { status: number; error?: string }> = {}) {
  // Direct conversations belong to one cohort workspace: cohort 3 + user 1 is conversation 301.
  const createDirectConversation = vi.fn(async ({ cohort_id, user_ids }: { cohort_id: number; user_ids: number[] }) => {
    const failure = responses[user_ids[0]]
    if (failure && failure.status !== 429) return { data: null, error: failure.error || 'Nope', status: failure.status }
    return { data: { direct_conversation: { id: cohort_id * 100 + user_ids[0] } }, error: null, status: 201 }
  })
  const createDirectMessage = vi.fn(async (conversationId: number, data: { body: string; client_message_id: string }) => {
    const failure = data.body ? responses[conversationId % 100] : undefined
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
      [301, { body: 'Checking in', client_message_id: 'bulk-batch1-dm301-u1' }],
      [302, { body: 'Checking in', client_message_id: 'bulk-batch1-dm302-u2' }],
      [303, { body: 'Checking in', client_message_id: 'bulk-batch1-dm303-u3' }],
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

  it('reports progress for the recipients skipped after a rate limit too', async () => {
    const progress: number[] = []
    await sendToEach(fakeApi({ 2: { status: 429 } }), people(4), 'Hi', 'b', (results) => progress.push(results.length))
    expect(progress).toEqual([1, 2, 3, 4])
  })

  it('keys each send by its conversation, so different conversations never share an idempotency key', async () => {
    // The server's client_message_id is unique per author across every conversation.
    const api = fakeApi()
    const sameStudentTwoCohorts = [{ userId: 1, name: 'Ana', cohortId: 3 }, { userId: 1, name: 'Ana', cohortId: 4 }]
    const results = await sendToEach(api, sameStudentTwoCohorts, 'Hi', 'b')
    const keys = api.createDirectMessage.mock.calls.map(([, data]) => data.client_message_id)
    expect(keys).toEqual(['bulk-b-dm301-u1', 'bulk-b-dm401-u1'])
    expect(new Set(keys).size).toBe(2)
    expect(results.map((result) => result.outcome.status)).toEqual(['sent', 'sent'])
    // A retry of the same batch reopens the same conversation and reuses its key.
    expect(bulkClientMessageId('b', 301, 1)).toBe(keys[0])
    expect(bulkClientMessageId('b', 301, 1).length).toBeLessThanOrEqual(100)
  })

  it('sends one message per student when the same student is selected in two cohorts', () => {
    const { recipients, duplicates } = dedupeRecipients([
      { userId: 7, name: 'Ana', cohortId: 3 },
      { userId: 8, name: 'Ben', cohortId: 3 },
      { userId: 7, name: 'Ana', cohortId: 4 },
      { userId: 7, name: 'Ana', cohortId: 5 },
    ])
    expect(recipients).toEqual([{ userId: 7, name: 'Ana', cohortId: 3 }, { userId: 8, name: 'Ben', cohortId: 3 }])
    expect(duplicates).toEqual([{ userId: 7, name: 'Ana', cohortCount: 3 }])
    expect(duplicateNote(duplicates[0], 'sent')).toBe('Ana is in 3 selected cohorts; one message sent.')
    expect(duplicateNote(duplicates[0], 'pending')).toBe('Ana is in 3 selected cohorts; one message will be sent.')
    expect(duplicateNote(duplicates[0], 'not_sent')).toBe('Ana is in 3 selected cohorts; the message was not sent.')
    expect(dedupeRecipients(people(3))).toEqual({ recipients: people(3), duplicates: [] })
  })

  it(`never sends to more than ${MAX_BULK_RECIPIENTS} students in one batch`, async () => {
    const api = fakeApi()
    const results = await sendToEach(api, people(MAX_BULK_RECIPIENTS + 5), 'Hi', 'b')
    expect(results).toHaveLength(MAX_BULK_RECIPIENTS)
    // Two requests a student stays inside the 120-a-minute message limit (#252).
    expect(MAX_BULK_RECIPIENTS * 2).toBeLessThan(120)
  })

  it('deselects only the rows the batch reached, including a student merged from a second cohort', () => {
    const selected: BulkRecipient[] = [
      { userId: 1, name: 'Ana', cohortId: 3 },
      { userId: 2, name: 'Ben', cohortId: 3 },
      { userId: 3, name: 'Cy', cohortId: 3 },
      { userId: 4, name: 'Di', cohortId: 3 },
      { userId: 1, name: 'Ana', cohortId: 4 },
      { userId: 5, name: 'Ed', cohortId: 3 },
    ]
    const keys = sentRecipientKeys(selected, [
      { ...selected[0], outcome: { status: 'sent', conversationId: 1 } },
      { ...selected[1], outcome: { status: 'failed', error: 'Nope' } },
      { ...selected[2], outcome: { status: 'rate_limited' } },
      { ...selected[3], outcome: { status: 'not_sent' } },
    ])
    // Ed was past the batch, so he was never tried and stays selected too.
    expect(keys).toEqual(['1:3', '1:4'])
    expect(recipientKey({ userId: 9, cohortId: 2 })).toBe('9:2')
  })

  it('reports a merged student\'s note from their own outcome', () => {
    const ana = { userId: 7, name: 'Ana', cohortId: 3 }
    expect(duplicateNoteState(7, [{ ...ana, outcome: { status: 'sent', conversationId: 1 } }], false)).toBe('sent')
    expect(duplicateNoteState(7, [{ ...ana, outcome: { status: 'blocked', error: 'No' } }], false)).toBe('not_sent')
    expect(duplicateNoteState(7, [], true)).toBe('pending')
    // Past the cap: the batch finished without reaching her.
    expect(duplicateNoteState(7, [], false)).toBe('not_sent')
  })
})
