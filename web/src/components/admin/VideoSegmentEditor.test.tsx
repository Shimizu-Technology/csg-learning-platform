// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { VideoSegment } from '../../lib/videoSegments'
import { VideoSegmentEditor } from './VideoSegmentEditor'

describe('VideoSegmentEditor', () => {
  const roots: ReturnType<typeof createRoot>[] = []

  afterEach(() => {
    roots.splice(0).forEach((root) => act(() => root.unmount()))
  })

  it('keeps the surviving row timestamps when an earlier row is removed', () => {
    const initial: VideoSegment[] = [
      { label: 'Intro', start_seconds: 10, end_seconds: 19, required: false },
      { label: 'Core lesson', start_seconds: 20, end_seconds: 40, required: true },
    ]
    function Harness() {
      const [segments, setSegments] = useState(initial)
      return <VideoSegmentEditor value={segments} onChange={setSegments} />
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => root.render(<Harness />))

    const removeFirst = container.querySelector('[aria-label="Remove section 1"]') as HTMLButtonElement
    act(() => removeFirst.click())

    expect((container.querySelector('[aria-label="Section 1 start"]') as HTMLInputElement).value).toBe('0:20')
    expect((container.querySelector('[aria-label="Section 1 end"]') as HTMLInputElement).value).toBe('0:40')
    container.remove()
  })
})
