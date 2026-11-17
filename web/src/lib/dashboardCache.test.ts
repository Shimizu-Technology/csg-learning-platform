// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { api, setApiCacheScope, setAuthTokenGetter } from './api'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); setApiCacheScope(null); setAuthTokenGetter(async () => null) })

it.each([true, false])('invalidates only this learner’s dashboard caches after confirmed dismissal (%s)', async dismissed => {
  localStorage.clear(); vi.useFakeTimers()
  setApiCacheScope('learner-a'); setAuthTokenGetter(async () => 'token')
  const fetch = vi.fn().mockImplementation(async (_url: string, options?: RequestInit) => ({
    ok: true, status: 200, text: async () => JSON.stringify(options?.method === 'PATCH' ? { dismissed } : { dashboard: { enrolled: true, start_here: true } }),
  }))
  vi.stubGlobal('fetch', fetch)
  await api.getDashboard(13); await api.getDashboard(14)
  const keys = Object.keys(localStorage)
  expect(keys).toHaveLength(2)
  const unrelated = keys[0].replace(/\/dashboard.*$/, '/notifications')
  localStorage.setItem(unrelated, 'preserved')
  setApiCacheScope('learner-b'); await api.getDashboard(13); setApiCacheScope('learner-a')
  const other = Object.keys(localStorage).find(key => key.includes('learner-b'))!
  await api.dismissStartHere(13)
  expect(Object.keys(localStorage).filter(key => key.includes('learner-a:') && key.includes('/dashboard'))).toHaveLength(dismissed ? 0 : 2)
  expect(localStorage.getItem(unrelated)).toBe('preserved')
  expect(localStorage.getItem(other)).not.toBeNull()
  fetch.mockRejectedValue(new Error('Offline'))
  const offline = api.getDashboard(13)
  await vi.runAllTimersAsync()
  const result = await offline
  expect(result.fromCache === true).toBe(!dismissed)
  if (dismissed) expect(result.data).toBeNull()
})
