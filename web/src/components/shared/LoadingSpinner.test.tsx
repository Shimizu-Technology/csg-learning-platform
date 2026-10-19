// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadingSpinner, SLOW_LOADING_MS } from './LoadingSpinner'

describe('LoadingSpinner', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows only the skeleton at first, then a message and a reload after a long wait', () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => root.render(<LoadingSpinner message="Loading materials..." />))
    expect(container.querySelector('[data-testid="slow-loading"]')).toBeNull()
    expect(container.textContent).toContain('Loading materials...')

    act(() => { vi.advanceTimersByTime(SLOW_LOADING_MS) })
    const slow = container.querySelector('[data-testid="slow-loading"]')
    expect(slow?.textContent).toContain('Still loading')
    expect(slow?.querySelector('button')?.textContent).toContain('Reload')
    act(() => root.unmount())
  })
})
