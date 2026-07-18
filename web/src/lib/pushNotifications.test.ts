import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { disablePushNotifications } from './pushNotifications'

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

  it('globally disables email and every browser subscription from a non-push client', async () => {
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
