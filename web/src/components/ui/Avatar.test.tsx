// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { Avatar } from './Avatar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Avatar image failures', () => {
  it('falls back to initials when a photo fails, and tries a new photo URL again', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(<Avatar name="Maria Santos" src="https://example.com/old.png" />))
    await act(async () => { container.querySelector('img')!.dispatchEvent(new Event('error')) })
    expect(container.textContent).toBe('MS')
    await act(async () => root.render(<Avatar name="Maria Santos" src="https://example.com/new.png" />))
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/new.png')
    act(() => root.unmount())
  })
})
