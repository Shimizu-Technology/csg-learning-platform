import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, setApiCacheScope, setAuthTokenGetter } from './api'

function successfulFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => '{}',
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setAuthTokenGetter(async () => null)
  setApiCacheScope(null)
})

describe('course-scoped response cache', () => {
  it('does not cache error-shaped dashboard or resources payloads with cohort query strings', async () => {
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    })
    setApiCacheScope('course-cache-test')
    setAuthTokenGetter(async () => 'test-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ error: 'Unavailable' }),
    }))

    await api.getDashboard(42)
    await api.getResources(42)

    expect(stored.size).toBe(0)
  })
})

describe('GitHub organization access timeout', () => {
  it('accepts a successful lookup after the normal 12-second request limit', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation((_url: string, options: RequestInit) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, status: 200, text: async () => JSON.stringify({ organization: 'alumni', statuses: {} }) }), 13_000)
      options.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('The request was aborted', 'AbortError'))
      }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const request = api.getCohortGithubAccess(4)
    await vi.advanceTimersByTimeAsync(13_000)

    expect(await request).toEqual({ data: { organization: 'alumni', statuses: {} }, error: null, status: 200 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('message API wire format', () => {
  it('bounds conversation reads to the message actually viewed', async () => {
    const fetchMock = successfulFetch()
    vi.stubGlobal('fetch', fetchMock)

    await api.markChannelRead(12, 90)
    await api.markDirectConversationRead(34, 80)

    expect(fetchMock.mock.calls.map(([url, options]) => ({ url: String(url), body: JSON.parse(String(options?.body)) }))).toEqual([
      { url: expect.stringMatching(/\/api\/v1\/channels\/12\/read$/), body: { message_id: 90 } },
      { url: expect.stringMatching(/\/api\/v1\/direct_conversations\/34\/read$/), body: { message_id: 80 } },
    ])
  })

  it('adds before_message_id only when channel and DM history requests include it', async () => {
    const fetchMock = successfulFetch()
    vi.stubGlobal('fetch', fetchMock)

    await api.getChannel(12)
    await api.getChannel(12, { before_message_id: 90 })
    await api.getChannel(12, { after_message_id: 91 })
    await api.getDirectConversation(34)
    await api.getDirectConversation(34, { before_message_id: 80 })
    await api.getDirectConversation(34, { after_message_id: 81 })

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringMatching(/\/api\/v1\/channels\/12$/),
      expect.stringMatching(/\/api\/v1\/channels\/12\?before_message_id=90$/),
      expect.stringMatching(/\/api\/v1\/channels\/12\?after_message_id=91$/),
      expect.stringMatching(/\/api\/v1\/direct_conversations\/34$/),
      expect.stringMatching(/\/api\/v1\/direct_conversations\/34\?before_message_id=80$/),
      expect.stringMatching(/\/api\/v1\/direct_conversations\/34\?after_message_id=81$/),
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

describe('curriculum structure API', () => {
  it('sends the exact resource version with every structure update', async () => {
    const fetchMock = successfulFetch()
    vi.stubGlobal('fetch', fetchMock)
    const version = '2026-09-12T01:02:03.123456Z'

    await api.updateLesson(21, { release_day: 9, base_updated_at: version })
    await api.archiveLesson(21, version)
    await api.restoreLesson(21, version)
    await api.updateModule(7, { schedule_days: 'mwf', base_updated_at: version })

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringMatching(/\/api\/v1\/lessons\/21$/),
      expect.stringMatching(/\/api\/v1\/lessons\/21\/archive$/),
      expect.stringMatching(/\/api\/v1\/lessons\/21\/restore$/),
      expect.stringMatching(/\/api\/v1\/modules\/7$/),
    ])
    expect(fetchMock.mock.calls.map(([, options]) => options)).toEqual([
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ release_day: 9, base_updated_at: version }) }),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ base_updated_at: version }) }),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ base_updated_at: version }) }),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ schedule_days: 'mwf', base_updated_at: version }) }),
    ])
  })
})


describe('course package file transport', () => {
  it('round trips UTF-8 teaching code through both endpoints', async () => {
    const fetchMock = successfulFetch()
    vi.stubGlobal('fetch', fetchMock)
    const teaching = { title: 'Håfa adai — 海', body: 'curl -X DELETE /items/1; SELECT * FROM studies; <script>example</script>' }
    await api.previewCoursePackage(teaching)
    await api.importCoursePackage(teaching)
    for (const [, options] of fetchMock.mock.calls) {
      const wire = JSON.parse(String(options.body))
      expect(Object.keys(wire)).toEqual(['package_base64'])
      const bytes = Uint8Array.from(atob(wire.package_base64), (character) => character.charCodeAt(0))
      expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(teaching)
    }
  })
})
