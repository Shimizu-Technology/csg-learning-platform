// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './ToastContext'

const handle: { toast?: ReturnType<typeof useToast> } = {}
function Grab() {
  const value = useToast()
  useEffect(() => {
    handle.toast = value
  }, [value])
  return null
}

describe('toasts', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows an identical message once and keeps it up for the full time again', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<ToastProvider><Grab /></ToastProvider>))
    act(() => { handle.toast!.success('Saved'); handle.toast!.success('Saved') })
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    act(() => vi.advanceTimersByTime(3000))
    act(() => handle.toast!.success('Saved'))
    act(() => vi.advanceTimersByTime(3000))
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    act(() => vi.advanceTimersByTime(2000))
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0)
    // Different messages and types still stack.
    act(() => { handle.toast!.success('Saved'); handle.toast!.error('Saved'); handle.toast!.success('Published') })
    expect(container.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(3)
    act(() => root.unmount())
    container.remove()
  })
})
