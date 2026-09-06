import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, setAuthTokenGetter } from './api'

function successfulFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => '{}',
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  setAuthTokenGetter(async () => null)
})

describe('message API wire format', () => {
  it('adds before_message_id only when channel and DM history requests include it', async () => {
    const fetchMock = successfulFetch()
    vi.stubGlobal('fetch', fetchMock)

    await api.getChannel(12)
    await api.getChannel(12, { before_message_id: 90 })
    await api.getDirectConversation(34)
    await api.getDirectConversation(34, { before_message_id: 80 })

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringMatching(/\/api\/v1\/channels\/12$/),
      expect.stringMatching(/\/api\/v1\/channels\/12\?before_message_id=90$/),
      expect.stringMatching(/\/api\/v1\/direct_conversations\/34$/),
      expect.stringMatching(/\/api\/v1\/direct_conversations\/34\?before_message_id=80$/),
    ])
  })

  it('includes client_message_id only when channel and DM sends provide it', async () => {
    const fetchMock = successfulFetch()
    vi.stubGlobal('fetch', fetchMock)

    await api.createMessage(12, { body: 'Channel without ID' })
    await api.createMessage(12, { body: 'Channel with ID', client_message_id: 'channel-client-id' })
    await api.createDirectMessage(34, { body: 'DM without ID' })
    await api.createDirectMessage(34, { body: 'DM with ID', client_message_id: 'dm-client-id' })

    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)))).toEqual([
      { body: 'Channel without ID' },
      { body: 'Channel with ID', client_message_id: 'channel-client-id' },
      { body: 'DM without ID' },
      { body: 'DM with ID', client_message_id: 'dm-client-id' },
    ])
  })
})

describe('browser push preference API', () => {
  it('patches the account browser preference and returns its delivery state', async () => {
    const response = {
      web_push_notifications_enabled: false,
      active_subscription_count: 2,
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(response),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await api.updateWebPushNotifications(false)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/v1\/push_subscriptions\/web_preferences$/)
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ notifications_enabled: false }),
    }))
    expect(result).toEqual({ data: response, error: null, status: 200 })
  })
})

describe('submission grading API', () => {
  it('sends the exact submission version with every grading write', async () => {
    const fetchMock = successfulFetch()
    vi.stubGlobal('fetch', fetchMock)

    await api.gradeSubmission(42, {
      grade: 'A',
      feedback: 'Ready to ship',
      base_submission_updated_at: '2026-09-06T10:44:12.123456Z',
    })

    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        grade: 'A',
        feedback: 'Ready to ship',
        base_submission_updated_at: '2026-09-06T10:44:12.123456Z',
      }),
    }))
  })
})
