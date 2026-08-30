import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadToS3 } from './uploadToS3'

type Listener = () => void

class FakeXMLHttpRequest {
  static outcomes: Array<'error' | number> = []
  static sends = 0

  status = 0
  responseText = ''
  upload = { addEventListener: vi.fn() }
  private listeners = new Map<string, Listener>()

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, listener)
  }

  open() {}

  send() {
    FakeXMLHttpRequest.sends += 1
    const outcome = FakeXMLHttpRequest.outcomes.shift() ?? 201
    queueMicrotask(() => {
      if (outcome === 'error') {
        this.listeners.get('error')?.()
      } else {
        this.status = outcome
        this.listeners.get('load')?.()
      }
    })
  }

  abort() {
    this.listeners.get('abort')?.()
  }
}

describe('uploadToS3', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    FakeXMLHttpRequest.outcomes = []
    FakeXMLHttpRequest.sends = 0
  })

  it('retries transient direct-upload failures', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
    FakeXMLHttpRequest.outcomes = ['error', 503, 201]

    const upload = uploadToS3('https://storage.example/upload', {}, new File(['video'], 'class.mp4'))
    await vi.runAllTimersAsync()
    await upload

    expect(FakeXMLHttpRequest.sends).toBe(3)
  })

  it('does not retry a permanent client error', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
    vi.stubGlobal('DOMParser', class {
      parseFromString() {
        return { querySelector: () => null }
      }
    })
    FakeXMLHttpRequest.outcomes = [403]

    await expect(uploadToS3('https://storage.example/upload', {}, new File(['video'], 'class.mp4')))
      .rejects.toThrow('status 403')
    expect(FakeXMLHttpRequest.sends).toBe(1)
  })

  it('does not send a request when cancellation happened before upload started', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
    const controller = new AbortController()
    controller.abort()

    await expect(uploadToS3(
      'https://storage.example/upload',
      {},
      new File(['video'], 'class.mp4'),
      undefined,
      controller.signal,
    )).rejects.toThrow('Upload cancelled')
    expect(FakeXMLHttpRequest.sends).toBe(0)
  })
})
