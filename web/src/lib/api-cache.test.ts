// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, setApiCacheScope, setAuthTokenGetter } from './api'

const lessonCacheKey = 'csg-api-cache:staff:9:/api/v1/lessons/42'

function unavailableFetch() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({ error: 'Unavailable' }),
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
  setApiCacheScope(null)
  setAuthTokenGetter(async () => null)
})

describe('lesson response cache compatibility', () => {
  it('ignores legacy cached lessons that cannot support guarded editing', async () => {
    vi.useFakeTimers()
    setApiCacheScope('staff:9')
    localStorage.setItem(lessonCacheKey, JSON.stringify({
      data: { lesson: { id: 42, title: 'Legacy lesson' } },
      savedAt: Date.now(),
    }))
    vi.stubGlobal('fetch', unavailableFetch())

    const resultPromise = api.getLesson(42)
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result).toMatchObject({ data: null, error: 'Unavailable', status: 503 })
    expect(result.fromCache).toBeUndefined()
  })

  it('retains current cached lessons as an offline fallback', async () => {
    vi.useFakeTimers()
    setApiCacheScope('staff:9')
    const cachedLesson = {
      lesson: {
        id: 42,
        title: 'Current lesson',
        updated_at: '2026-09-12T10:15:00.123456Z',
      },
    }
    localStorage.setItem(lessonCacheKey, JSON.stringify({ data: cachedLesson, savedAt: Date.now() }))
    vi.stubGlobal('fetch', unavailableFetch())

    const resultPromise = api.getLesson(42)
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.data).toEqual(cachedLesson)
    expect(result.fromCache).toBe(true)
  })
})

describe('GitHub connection status never uses the offline cache', () => {
  it.each([
    ['getGithubAppInstallations', '/api/v1/cohorts/1/github_app_installations'],
    ['getGithubRepositoryBindings', '/api/v1/enrollments/1/github_repository_bindings'],
  ] as const)('%s bypasses old cached status and never caches a live response', async (method, endpoint) => {
    vi.useFakeTimers()
    setApiCacheScope('staff:9')
    setAuthTokenGetter(async () => 'synthetic')
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ installations: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    await api[method](1)
    const key = `csg-api-cache:staff:9:${endpoint}`
    expect(localStorage.getItem(key)).toBeNull()
    localStorage.setItem(key, JSON.stringify({ data: { stale: true }, savedAt: Date.now() }))
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) })
    const failed = api[method](1)
    await vi.runAllTimersAsync()
    expect(await failed).toMatchObject({ data: null, error: 'Unavailable' })
    expect((await failed).fromCache).toBeUndefined()
    expect(fetchMock.mock.calls.every(([, options]) => options.cache === 'no-store')).toBe(true)
  })
})
