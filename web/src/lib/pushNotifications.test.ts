import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { browserPushEnabled, disablePushNotifications, PUSH_UNAVAILABLE_MESSAGE, pushConfigurationHint, webPushPreferenceEnabled } from './pushNotifications'

vi.mock('./api', () => ({
  api: {
    deletePushSubscription: vi.fn(),
  },
}))

describe('disablePushNotifications', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('disables browser push across the account from a non-push client', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('window', {})
    vi.mocked(api.deletePushSubscription).mockResolvedValue({ data: null, error: null })

    await disablePushNotifications()

    expect(api.deletePushSubscription).toHaveBeenCalledOnce()
    expect(api.deletePushSubscription).toHaveBeenCalledWith(undefined, true)
  })

  it('reports a global-disable API failure instead of claiming notifications are off', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('window', {})
    vi.mocked(api.deletePushSubscription).mockResolvedValue({ data: null, error: 'Could not disable notifications.' })

    await expect(disablePushNotifications()).rejects.toThrow('Could not disable notifications.')
  })
})

describe('webPushPreferenceEnabled', () => {
  it('uses the dedicated browser preference when available', () => {
    expect(webPushPreferenceEnabled({ web_push_notifications_enabled: false, notifications_enabled: true })).toBe(false)
  })

  it('falls back to the legacy preference during a staggered deployment', () => {
    expect(webPushPreferenceEnabled({ notifications_enabled: false })).toBe(false)
    expect(webPushPreferenceEnabled({ notifications_enabled: true })).toBe(true)
  })

  it('fails closed when a degraded config response contains no preference', () => {
    expect(webPushPreferenceEnabled({})).toBe(false)
  })
})

describe('browserPushEnabled', () => {
  const subscription = {} as PushSubscription

  it('requires a successful configuration response even when this browser has a subscription', () => {
    expect(browserPushEnabled(null, subscription)).toBe(false)
    expect(browserPushEnabled(undefined, subscription)).toBe(false)
    expect(browserPushEnabled({}, subscription)).toBe(false)
  })

  it('requires both the account preference and a browser subscription', () => {
    expect(browserPushEnabled({ web_push_notifications_enabled: true }, subscription)).toBe(true)
    expect(browserPushEnabled({ web_push_notifications_enabled: false }, subscription)).toBe(false)
    expect(browserPushEnabled({ web_push_notifications_enabled: true }, null)).toBe(false)
  })
})

describe('pushConfigurationHint', () => {
  it('shows students and instructors a plain message, never env-var setup', () => {
    const hint = pushConfigurationHint({ configured: false, missing: ['WEB_PUSH_VAPID_PRIVATE_KEY'], publicKey: null })
    expect(hint).toBe(PUSH_UNAVAILABLE_MESSAGE)
    expect(hint).not.toMatch(/Netlify|VAPID|VITE_|env/)
  })

  it('keeps the setup detail for admins, after the plain message', () => {
    const hint = pushConfigurationHint({ configured: false, missing: ['WEB_PUSH_VAPID_PRIVATE_KEY'], publicKey: null, admin: true })
    expect(hint.startsWith(PUSH_UNAVAILABLE_MESSAGE)).toBe(true)
    expect(hint).toContain('API push is missing WEB_PUSH_VAPID_PRIVATE_KEY.')
    expect(hint).toContain('VITE_WEB_PUSH_PUBLIC_KEY')
  })

  it('is empty once push is configured', () => {
    expect(pushConfigurationHint({ configured: true, publicKey: 'key' })).toBe('')
  })
})
