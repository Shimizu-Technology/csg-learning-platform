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
