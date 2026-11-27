// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceDraft } from '../../hooks/useVoiceDraft'
import { api, setAuthTokenGetter } from '../../lib/api'
import { VoiceDraftButton, VoiceDraftPanel } from './VoiceDraftControls'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

class FakeMediaRecorder {
  static isTypeSupported = vi.fn((type: string) => type === 'audio/webm;codecs=opus')
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType: string
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType || 'audio/webm;codecs=opus'
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    const chunk = new Blob(['\x1A\x45\xDF\xA3webm-audio'], { type: this.mimeType })
    this.ondataavailable?.({ data: chunk } as BlobEvent)
    this.onstop?.()
  }
}

function stubBrowserRecording() {
  const trackStop = vi.fn()
  const stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream
  const getUserMedia = vi.fn().mockResolvedValue(stream)
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  return { trackStop, getUserMedia }
}

describe('VoiceDraftButton and VoiceDraftPanel', () => {
  it('hides the button when recording is unsupported and renders accessible touch targets when supported', async () => {
    const onClick = vi.fn()
    await act(async () => {
      root.render(<VoiceDraftButton state="idle" supported={false} onClick={onClick} />)
    })
    expect(container.querySelector('button')).toBeNull()

    await act(async () => {
      root.render(<VoiceDraftButton state="idle" supported onClick={onClick} />)
    })
    const button = container.querySelector('button')!
    expect(button.getAttribute('aria-label')).toBe('Dictate a draft')
    expect(button.className).toContain('h-11')
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(onClick).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.render(<VoiceDraftButton state="recording" supported onClick={onClick} />)
    })
    expect(container.querySelector('button')!.disabled).toBe(true)
    expect(container.querySelector('button')!.getAttribute('aria-busy')).toBe('true')
  })

  it('renders recording countdown, error retry controls, and review actions', async () => {
    const handlers = {
      onStop: vi.fn(),
      onCancel: vi.fn(),
      onRetry: vi.fn(),
      onRecordAgain: vi.fn(),
      onRestore: vi.fn(),
      onDismiss: vi.fn(),
    }

    await act(async () => {
      root.render(
        <VoiceDraftPanel
          state="recording"
          durationMillis={280_000}
          maxDurationSeconds={300}
          error={null}
          notice={null}
          hasReview={false}
          {...handlers}
        />,
      )
    })
    expect(container.textContent).toContain('Listening…')
    expect(container.textContent).toContain('4:40 / 5:00')
    expect(container.textContent).toContain('20s left')

    await act(async () => {
      root.render(
        <VoiceDraftPanel
          state="error"
          durationMillis={0}
          error="Network timeout"
          notice={null}
          hasReview={false}
          hasRecording
          {...handlers}
        />,
      )
    })
    expect(container.textContent).toContain('Network timeout')
    expect(container.textContent).toContain('Your recording is saved for this retry.')
    const retryBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Retry transcription'))!
    await act(async () => retryBtn.click())
    expect(handlers.onRetry).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.render(
        <VoiceDraftPanel
          state="review"
          durationMillis={0}
          error={null}
          notice="Voice draft added. Review and edit it before sending."
          hasReview
          {...handlers}
        />,
      )
    })
    expect(container.textContent).toContain('Review your voice draft')
    const rawBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Use raw transcript'))!
    const dismissBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Dismiss review'))!
    await act(async () => rawBtn.click())
    await act(async () => dismissBtn.click())
    expect(handlers.onRestore).toHaveBeenCalledTimes(1)
    expect(handlers.onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('useVoiceDraft browser workflow', () => {
  function Harness({ onSend }: { onSend: () => void }) {
    const [draft, setDraft] = useState('Existing note.')
    const voice = useVoiceDraft({
      surface: 'grading_feedback',
      getDraft: () => draft,
      onDraftChange: (value) => setDraft(value),
    })

    return (
      <div>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
        <VoiceDraftButton state={voice.state} supported={voice.supported} onClick={() => void voice.start()} />
        <VoiceDraftPanel
          state={voice.state}
          durationMillis={voice.durationMillis}
          maxDurationSeconds={voice.maxDurationSeconds}
          error={voice.error}
          notice={voice.notice}
          hasReview={Boolean(voice.review)}
          hasRecording={voice.hasRecording}
          onStop={() => void voice.stop()}
          onCancel={voice.cancel}
          onRetry={voice.retry}
          onRecordAgain={voice.recordAgain}
          onRestore={voice.restore}
          onDismiss={voice.dismissReview}
        />
        <button type="button" onClick={() => { voice.markSent(draft); onSend() }}>Send</button>
      </div>
    )
  }

  it('records, stops tracks, inserts editable draft without auto-sending, retries on error, and restores raw text', async () => {
    const { trackStop } = stubBrowserRecording()
    let now = 10_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const transcribeSpy = vi.spyOn(api, 'transcribeVoice')
      .mockResolvedValueOnce({ data: null, error: 'Transcription timed out. Your recording is still available to retry.', errorKind: 'timeout' })
      .mockResolvedValueOnce({
        data: {
          raw_text: 'um check the loop condition',
          suggested_text: 'Check the loop condition.',
          duration_seconds: 5.0,
          warnings: [],
        },
        error: null,
        status: 200,
      })

    const onSend = vi.fn()
    await act(async () => {
      root.render(<Harness onSend={onSend} />)
    })

    const micButton = container.querySelector<HTMLButtonElement>('button[aria-label="Dictate a draft"]')!
    await act(async () => micButton.click())
    expect(container.querySelector('[data-voice-panel="recording"]')).not.toBeNull()

    now += 5_000
    const stopButton = container.querySelector<HTMLButtonElement>('button[aria-label="Stop and transcribe recording"]')!
    await act(async () => stopButton.click())

    // Tracks must always be stopped immediately after recording ends.
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(transcribeSpy).toHaveBeenCalledTimes(1)
    expect(transcribeSpy.mock.calls[0][1]).toBe('voice-draft.webm')
    expect(transcribeSpy.mock.calls[0][2]).toBe('grading_feedback')
    expect(transcribeSpy.mock.calls[0][3]).toBe(5)

    // First attempt failed: recording is kept for retry and draft stays untouched.
    expect(container.querySelector('[data-voice-panel="error"]')).not.toBeNull()
    expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Existing note.')
    expect(onSend).not.toHaveBeenCalled()

    // Retry re-uses the saved Blob without re-recording.
    const retryButton = container.querySelector<HTMLButtonElement>('button[aria-label="Retry transcription"]')!
    await act(async () => retryButton.click())

    expect(transcribeSpy).toHaveBeenCalledTimes(2)
    expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Existing note. Check the loop condition.')
    expect(container.querySelector('[data-voice-panel="review"]')).not.toBeNull()
    expect(onSend).not.toHaveBeenCalled()

    // Restore switches to raw transcript.
    const rawButton = container.querySelector<HTMLButtonElement>('button[aria-label="Use raw transcript"]')!
    await act(async () => rawButton.click())
    expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Existing note. um check the loop condition')
    expect(onSend).not.toHaveBeenCalled()

    // Dismiss hides the review panel while preserving the edited draft.
    const dismissButton = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss review"]')!
    await act(async () => dismissButton.click())
    expect(container.querySelector('[data-voice-panel]')).toBeNull()
    expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Existing note. um check the loop condition')
  })

  it('always stops media tracks on unmount during active recording', async () => {
    const { trackStop } = stubBrowserRecording()
    await act(async () => {
      root.render(<Harness onSend={vi.fn()} />)
    })

    const micButton = container.querySelector<HTMLButtonElement>('button[aria-label="Dictate a draft"]')!
    await act(async () => micButton.click())
    expect(container.querySelector('[data-voice-panel="recording"]')).not.toBeNull()

    act(() => root.unmount())
    expect(trackStop).toHaveBeenCalledTimes(1)
  })

  it('stops active recording and aborts in-flight transcription when markSent is called', async () => {
    const { trackStop } = stubBrowserRecording()
    let now = 20_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    let resolveTranscribe: ((value: Awaited<ReturnType<typeof api.transcribeVoice>>) => void) | null = null
    let capturedSignal: AbortSignal | undefined
    vi.spyOn(api, 'transcribeVoice').mockImplementation((_blob, _filename, _surface, _duration, signal) => {
      capturedSignal = signal
      return new Promise((resolve) => {
        resolveTranscribe = resolve
      })
    })

    await act(async () => {
      root.render(<Harness onSend={vi.fn()} />)
    })

    const micButton = container.querySelector<HTMLButtonElement>('button[aria-label="Dictate a draft"]')!
    const sendButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Send')!

    // Case 1: sending while actively recording stops recorder & releases mic tracks.
    await act(async () => micButton.click())
    expect(container.querySelector('[data-voice-panel="recording"]')).not.toBeNull()

    await act(async () => sendButton.click())
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-voice-panel]')).toBeNull()

    // Case 2: sending while transcription is in flight aborts request and ignores late response.
    await act(async () => micButton.click())
    now += 4_000
    const stopButton = container.querySelector<HTMLButtonElement>('button[aria-label="Stop and transcribe recording"]')!
    await act(async () => stopButton.click())
    expect(container.querySelector('[data-voice-panel="transcribing"]')).not.toBeNull()

    await act(async () => sendButton.click())
    expect(capturedSignal?.aborted).toBe(true)
    expect(container.querySelector('[data-voice-panel]')).toBeNull()

    await act(async () => {
      resolveTranscribe?.({
        data: { raw_text: 'late result', suggested_text: 'Late result.', duration_seconds: 4, warnings: [] },
        error: null,
        status: 200,
      })
    })
    expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Existing note.')
    expect(container.querySelector('[data-voice-panel]')).toBeNull()
  })

  it('ignores a stale getUserMedia rejection from a canceled attempt without stopping a newer recording', async () => {
    const firstRejectHolder: { reject?: (error: Error) => void } = {}
    const secondTrackStop = vi.fn()
    const secondStream = { getTracks: () => [{ stop: secondTrackStop }] } as unknown as MediaStream
    const getUserMedia = vi.fn()
      .mockImplementationOnce(() => new Promise<MediaStream>((_resolve, reject) => { firstRejectHolder.reject = reject }))
      .mockResolvedValueOnce(secondStream)

    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)

    await act(async () => {
      root.render(<Harness onSend={vi.fn()} />)
    })

    const micButton = container.querySelector<HTMLButtonElement>('button[aria-label="Dictate a draft"]')!
    await act(async () => micButton.click())
    const cancelButton = container.querySelector<HTMLButtonElement>('button[aria-label="Cancel voice draft"]')!
    await act(async () => cancelButton.click())

    // Start a second recording that succeeds before the first getUserMedia rejects.
    await act(async () => micButton.click())
    expect(container.querySelector('[data-voice-panel="recording"]')).not.toBeNull()

    await act(async () => {
      firstRejectHolder.reject?.(new DOMException('Permission denied', 'NotAllowedError'))
      await Promise.resolve()
    })

    // Second recording stays active and its tracks are NOT stopped.
    expect(container.querySelector('[data-voice-panel="recording"]')).not.toBeNull()
    expect(secondTrackStop).not.toHaveBeenCalled()
  })

  it('interrupts stalled token acquisition and preserves abort errors during non-2xx response parsing', async () => {
    const tokenController = new AbortController()
    setAuthTokenGetter(() => new Promise<string | null>(() => {}))
    const pendingAuth = api.transcribeVoice(new Blob(['a'], { type: 'audio/webm' }), 'voice.webm', 'message', 3, tokenController.signal)
    tokenController.abort()
    const authResult = await pendingAuth
    expect(authResult.data).toBeNull()
    expect(authResult.error).toBe('Request canceled')

    setAuthTokenGetter(async () => 'valid-token')
    const bodyController = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new DOMException('Aborted', 'AbortError')),
    }))
    bodyController.abort()
    // Test abort firing during response.json() on an in-flight non-2xx response
    const bodyController2 = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => {
        bodyController2.abort()
        return Promise.reject(new DOMException('Aborted', 'AbortError'))
      },
    }))
    const bodyResult = await api.transcribeVoice(new Blob(['a'], { type: 'audio/webm' }), 'voice.webm', 'message', 3, bodyController2.signal)
    expect(bodyResult.data).toBeNull()
    expect(bodyResult.error).toBe('Request canceled')
    setAuthTokenGetter(async () => null)
  })
})
