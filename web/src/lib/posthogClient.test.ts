// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('lazy PostHog client', () => {
  it('never loads analytics when no key is configured', async () => {
    vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', '')
    const module = await import('./posthogClient')
    const importer = vi.fn()
    module.__testing.reset(importer)
    expect(module.isPostHogEnabled).toBe(false)
    expect(module.withPostHog(() => {})).toBe(false)
    expect(await module.loadPostHog()).toBeNull()
    expect(importer).not.toHaveBeenCalled()
  })

  it('queues calls until the browser is idle, then loads once and replays them', async () => {
    vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', 'phc_test')
    const idle: Array<() => void> = []
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => { idle.push(cb); return 1 })
    const module = await import('./posthogClient')
    const fake = { init: vi.fn(), capture: vi.fn(), opt_out_capturing: vi.fn() }
    const importer = vi.fn(async () => ({ default: fake as never }))
    module.__testing.reset(importer)

    expect(module.withPostHog((ph) => ph.capture('$pageview'))).toBe(true)
    module.withPostHog((ph) => ph.capture('second'))
    expect(importer).not.toHaveBeenCalled()
    expect(module.__testing.queued()).toBe(2)

    idle.forEach((cb) => cb())
    await module.loadPostHog()
    expect(importer).toHaveBeenCalledTimes(1)
    expect(fake.init).toHaveBeenCalledWith('phc_test', expect.objectContaining({ autocapture: false, disable_session_recording: true }))
    expect(fake.capture.mock.calls.map((call) => call[0])).toEqual(['$pageview', 'second'])
    expect(module.isPostHogLoaded()).toBe(true)

    module.withPostHog((ph) => ph.capture('third'))
    expect(fake.capture).toHaveBeenCalledTimes(3)
    vi.unstubAllGlobals()
  })

  it('bounds the queue while analytics is still loading', async () => {
    vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', 'phc_test')
    vi.stubGlobal('requestIdleCallback', () => 1)
    const module = await import('./posthogClient')
    module.__testing.reset(vi.fn())
    for (let i = 0; i < module.MAX_QUEUED_ANALYTICS_CALLS + 10; i += 1) module.withPostHog(() => {})
    expect(module.__testing.queued()).toBe(module.MAX_QUEUED_ANALYTICS_CALLS)
    vi.unstubAllGlobals()
  })

  it('drops queued calls and allows a retry when the bundle is blocked', async () => {
    vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', 'phc_test')
    vi.stubGlobal('requestIdleCallback', () => 1)
    const module = await import('./posthogClient')
    module.__testing.reset(vi.fn(async () => { throw new Error('blocked') }))
    module.withPostHog(() => {})
    expect(await module.loadPostHog()).toBeNull()
    expect(module.__testing.queued()).toBe(0)
    vi.unstubAllGlobals()
  })
})
