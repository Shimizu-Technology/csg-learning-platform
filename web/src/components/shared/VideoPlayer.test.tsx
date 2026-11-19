// @vitest-environment jsdom

import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoPlayer, type VideoPlayerHandle } from './VideoPlayer'

describe('VideoPlayer section seeking', () => {
  const roots: ReturnType<typeof createRoot>[] = []

  afterEach(() => {
    roots.splice(0).forEach((root) => act(() => root.unmount()))
    vi.restoreAllMocks()
  })

  it('ending after a seek saves observed credit only', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    roots.push(root)
    const save = vi.fn()
    await act(async () => root.render(<VideoPlayer title="Synthetic" fetchStreamUrl={async () => '/synthetic.mp4'} onSaveProgress={save} />))
    const video = container.querySelector('video')!
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 })
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 100 })
    act(() => video.dispatchEvent(new Event('ended')))
    expect(save).toHaveBeenLastCalledWith({last_position_seconds:100,total_watched_seconds:0,duration_seconds:100},true)
  })

  it('switches streams at the current position and retains cumulative watched time', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    roots.push(root)
    const ref = createRef<VideoPlayerHandle>()
    const save = vi.fn()
    const first = vi.fn(async () => '/studio.mp4')
    const second = vi.fn(async () => '/desktop.mp4')
    await act(async () => root.render(<VideoPlayer ref={ref} title="Versions" initialTotalWatched={35} fetchStreamUrl={first} onSaveProgress={save} />))
    const video = container.querySelector('video')!
    Object.defineProperty(video, 'duration', { configurable: true, value: 120 })
    Object.defineProperty(video, 'paused', { configurable: true, value: true })
    act(() => video.dispatchEvent(new Event('loadedmetadata')))
    video.currentTime = 42
    vi.spyOn(video, 'pause').mockImplementation(() => undefined)
    act(() => ref.current?.prepareSourceChange())
    await act(async () => root.render(<VideoPlayer ref={ref} title="Versions" initialTotalWatched={0} fetchStreamUrl={second} onSaveProgress={save} />))
    video.currentTime = 0
    act(() => video.dispatchEvent(new Event('loadedmetadata')))
    expect(video.currentTime).toBe(42)
    expect(video.getAttribute('src')).toBe('/desktop.mp4')
    act(() => video.dispatchEvent(new Event('pause')))
    expect(save).toHaveBeenLastCalledWith({ last_position_seconds: 42, total_watched_seconds: 35, duration_seconds: 120 }, false)
  })

  it('applies a section jump requested before the stream metadata is ready', async () => {
    let resolveStream!: (value: string) => void
    const stream = new Promise<string>((resolve) => { resolveStream = resolve })
    const fetchStreamUrl = vi.fn(() => stream)
    const ref = createRef<VideoPlayerHandle>()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<VideoPlayer ref={ref} title="Class recording" fetchStreamUrl={fetchStreamUrl} onSaveProgress={vi.fn()} />)
    })
    act(() => ref.current?.seekTo(75, true))
    await act(async () => resolveStream('https://example.com/class.mp4'))

    const video = container.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { configurable: true, value: 180 })
    Object.defineProperty(video, 'readyState', { configurable: true, value: HTMLMediaElement.HAVE_METADATA })
    const play = vi.spyOn(video, 'play').mockResolvedValue()
    act(() => video.dispatchEvent(new Event('loadedmetadata')))

    expect(video.currentTime).toBe(75)
    expect(play).toHaveBeenCalledOnce()
    container.remove()
  })
})
