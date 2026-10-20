// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@clerk/clerk-react', () => ({ ClerkLoading: ({ children }: { children: unknown }) => children, ClerkFailed: () => null }))

import { AuthWidgetLoading } from './AuthWidgetStatus'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

describe('AuthWidgetLoading', () => {
  it('shows a placeholder, then a reload offer if Clerk has not loaded after 8s', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(<AuthWidgetLoading />))
    expect(host.textContent).toContain('Loading sign-in')
    expect(host.textContent).not.toContain('Reload')
    act(() => { vi.advanceTimersByTime(8000) })
    expect(host.textContent).toContain('Sign-in is taking longer than usual')
    expect(host.querySelector('button')?.textContent).toContain('Reload')
    act(() => root.unmount())
  })
})
