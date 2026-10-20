// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEYBOARD_THRESHOLD_PX, measureViewport, useKeyboardAwareViewport } from './visualViewport'

describe('measureViewport', () => {
  it('reports no keyboard when the visual viewport fills the layout viewport', () => {
    expect(measureViewport(844, { height: 844, offsetTop: 0 })).toEqual({ height: 844, top: 0, keyboardInset: 0, keyboardOpen: false })
  })

  it('reads the iOS keyboard as the space below the panned visual viewport', () => {
    expect(measureViewport(844, { height: 508, offsetTop: 40 })).toEqual({ height: 508, top: 40, keyboardInset: 296, keyboardOpen: true })
  })

  it('ignores small changes such as a collapsing toolbar', () => {
    expect(measureViewport(844, { height: 844 - KEYBOARD_THRESHOLD_PX, offsetTop: 0 }).keyboardOpen).toBe(false)
  })
})

describe('useKeyboardAwareViewport', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport')

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    if (original) Object.defineProperty(window, 'visualViewport', original)
    else delete (window as { visualViewport?: unknown }).visualViewport
    vi.restoreAllMocks()
  })

  it('publishes the visible height while the keyboard is open and cleans up on close and unmount', () => {
    const viewport = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    function Probe() {
      useKeyboardAwareViewport(true)
      return null
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(createElement(Probe)))
    expect(document.documentElement.dataset.keyboard).toBeUndefined()

    viewport.height = window.innerHeight - 300
    act(() => viewport.dispatchEvent(new Event('resize')))
    expect(document.documentElement.dataset.keyboard).toBe('open')
    expect(document.documentElement.style.getPropertyValue('--visual-viewport-height')).toBe(`${window.innerHeight - 300}px`)
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('300px')

    viewport.height = window.innerHeight
    act(() => viewport.dispatchEvent(new Event('resize')))
    expect(document.documentElement.dataset.keyboard).toBeUndefined()
    expect(document.documentElement.style.getPropertyValue('--visual-viewport-height')).toBe('')

    viewport.height = window.innerHeight - 300
    act(() => viewport.dispatchEvent(new Event('resize')))
    act(() => root?.unmount())
    root = null
    expect(document.documentElement.dataset.keyboard).toBeUndefined()
  })
})
