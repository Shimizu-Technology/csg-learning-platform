// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const { configMock, getInstanceMock } = vi.hoisted(() => ({
  configMock: vi.fn(),
  getInstanceMock: vi.fn(() => null as unknown),
}))

vi.mock('@monaco-editor/react', () => ({
  loader: {
    config: configMock,
    __getMonacoInstance: getInstanceMock,
  },
}))

import {
  __resetMonacoLoaderForTests,
  ensureMonacoLoaded,
  getMonacoLoadStatus,
  MONACO_VS_PATH,
} from './monacoLoader'

type TestWindow = Window & {
  monaco?: unknown
  require?: unknown
}

afterEach(() => {
  vi.useRealTimers()
  __resetMonacoLoaderForTests()
  configMock.mockReset()
  getInstanceMock.mockReset()
  getInstanceMock.mockReturnValue(null)
  delete (window as TestWindow).monaco
  delete (window as TestWindow).require
  document.body.innerHTML = ''
})

describe('monacoLoader', () => {
  it('injects loader.js once for concurrent callers and registers Monaco on success', async () => {
    const fakeMonaco = { editor: { create: vi.fn() } }
    const p1 = ensureMonacoLoaded()
    const p2 = ensureMonacoLoaded()
    expect(p1).toBe(p2)
    expect(getMonacoLoadStatus()).toBe('loading')

    const scripts = document.body.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0].src).toBe(`${MONACO_VS_PATH}/loader.js`)

    const amdRequire = Object.assign(
      vi.fn((_deps: string[], onSuccess: (mod: unknown) => void) => {
        onSuccess({ m: fakeMonaco })
      }),
      { config: vi.fn() },
    )
    ;(window as TestWindow).require = amdRequire
    scripts[0].onload?.(new Event('load'))

    await expect(p1).resolves.toBe(fakeMonaco)
    expect(getMonacoLoadStatus()).toBe('ready')
    expect(amdRequire.config).toHaveBeenCalledWith({ paths: { vs: MONACO_VS_PATH } })
    expect(configMock).toHaveBeenCalledWith({ monaco: fakeMonaco })
  })

  it('rejects cleanly when loader.js fails and fast-fails subsequent calls without re-injecting', async () => {
    const first = ensureMonacoLoaded()
    const script = document.body.querySelector('script')!
    script.onerror?.(new Event('error'))

    await expect(first).rejects.toThrow(/Monaco loader script failed/)
    expect(getMonacoLoadStatus()).toBe('failed')
    expect(document.body.querySelectorAll('script')).toHaveLength(0)

    await expect(ensureMonacoLoaded()).rejects.toThrow(/Monaco loader script failed/)
    expect(document.body.querySelectorAll('script')).toHaveLength(0)
  })

  it('rejects cleanly when AMD require reports an error loading editor.main', async () => {
    const promise = ensureMonacoLoaded()
    const script = document.body.querySelector('script')!
    const amdRequire = Object.assign(
      vi.fn((_deps: string[], _onSuccess: unknown, onError: (err: unknown) => void) => {
        onError(new Error('editor.main aborted'))
      }),
      { config: vi.fn() },
    )
    ;(window as TestWindow).require = amdRequire
    script.onload?.(new Event('load'))

    await expect(promise).rejects.toThrow('editor.main aborted')
    expect(getMonacoLoadStatus()).toBe('failed')
  })

  it('bounds and settles a stalled loader.js once so subsequent calls fast-fail immediately', async () => {
    vi.useFakeTimers()
    const first = ensureMonacoLoaded(500)
    const second = ensureMonacoLoaded(500)
    expect(first).toBe(second)
    expect(document.body.querySelectorAll('script')).toHaveLength(1)

    const caught = first.catch((error) => error)
    await vi.advanceTimersByTimeAsync(500)

    const err = await caught
    expect(err).toMatchObject({ message: 'Monaco editor load timed out' })
    expect(getMonacoLoadStatus()).toBe('failed')

    // Subsequent calls reject immediately without re-injecting loader.js or waiting again.
    const thirdError = await ensureMonacoLoaded(500).catch((error) => error)
    expect(thirdError).toBe(err)
    expect(document.body.querySelectorAll('script')).toHaveLength(1)
  })

  it('bounds a stalled AMD require, fast-fails later callers, and ignores late AMD success and global assignment', async () => {
    vi.useFakeTimers()
    const fakeMonaco = { editor: { create: vi.fn() } }
    let deliverLate!: (mod: unknown) => void
    const amdRequire = Object.assign(
      vi.fn((_deps: string[], onSuccess: (mod: unknown) => void) => {
        deliverLate = onSuccess
      }),
      { config: vi.fn() },
    )
    ;(window as TestWindow).require = amdRequire

    const first = ensureMonacoLoaded(500)
    const firstResult = first.catch((error) => error)
    expect(amdRequire).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(500)
    const timeout = await firstResult
    expect(timeout).toMatchObject({ message: 'Monaco editor load timed out' })
    expect(getMonacoLoadStatus()).toBe('failed')

    // Subsequent mount immediately rejects without invoking AMD require again.
    const secondResult = await ensureMonacoLoaded(500).catch((error) => error)
    expect(secondResult).toBe(timeout)
    expect(amdRequire).toHaveBeenCalledTimes(1)

    ;(window as TestWindow).monaco = fakeMonaco
    deliverLate({ m: fakeMonaco })
    expect(getMonacoLoadStatus()).toBe('failed')
    expect(configMock).not.toHaveBeenCalled()
    await expect(ensureMonacoLoaded()).rejects.toBe(timeout)
  })
})
