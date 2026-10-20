// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { listLinkState, queueShortcutDirection, readReturnContext, shouldRestoreList } from './navigationContext'

describe('return context', () => {
  it('carries the exact list URL and a label', () => {
    expect(listLinkState({ pathname: '/admin/students', search: '?filter=at-risk&q=Ana' }, 'Students · At risk')).toEqual({ returnTo: '/admin/students?filter=at-risk&q=Ana', returnLabel: 'Students · At risk' })
  })

  it('accepts only internal paths with a label', () => {
    expect(readReturnContext({ returnTo: '/admin/grading?filter=redo', returnLabel: 'Grading' })).toEqual({ returnTo: '/admin/grading?filter=redo', returnLabel: 'Grading' })
    expect(readReturnContext({ returnTo: '//evil.example.com', returnLabel: 'Students' })).toBeNull()
    expect(readReturnContext({ returnTo: 'https://evil.example.com', returnLabel: 'Students' })).toBeNull()
    expect(readReturnContext({ returnTo: '/admin/students', returnLabel: ' ' })).toBeNull()
    expect(readReturnContext(null)).toBeNull()
    expect(readReturnContext('nope')).toBeNull()
  })

  it('restores the list on browser Back or an explicit back link', () => {
    expect(shouldRestoreList('POP', null)).toBe(true)
    expect(shouldRestoreList('PUSH', { restoreList: true })).toBe(true)
    expect(shouldRestoreList('PUSH', null)).toBe(false)
  })
})

describe('queue shortcuts', () => {
  const key = (value: string, extra: Partial<KeyboardEvent> = {}, target: EventTarget | null = document.body) => ({ key: value, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, target, ...extra })

  it('maps J and K to next and previous', () => {
    expect(queueShortcutDirection(key('j'))).toBe('next')
    expect(queueShortcutDirection(key('K'))).toBe('previous')
    expect(queueShortcutDirection(key('x'))).toBeNull()
  })

  it('never fires while typing, in a dialog, or with modifiers', () => {
    const textarea = document.createElement('textarea')
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inDialog = document.createElement('button')
    dialog.appendChild(inDialog)
    expect(queueShortcutDirection(key('j', {}, textarea))).toBeNull()
    expect(queueShortcutDirection(key('j', {}, editor))).toBeNull()
    expect(queueShortcutDirection(key('j', {}, inDialog))).toBeNull()
    expect(queueShortcutDirection(key('j', { metaKey: true }))).toBeNull()
    expect(queueShortcutDirection(key('j', { defaultPrevented: true }))).toBeNull()
  })
})

describe('useListScrollMemory', () => {
  it('saves the list position while it is the current page, and ignores scrolls after the URL moves on', async () => {
    const { act, createElement } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { BrowserRouter } = await import('react-router-dom')
    const { useListScrollMemory } = await import('./navigationContext')
    const raf = window.requestAnimationFrame
    window.requestAnimationFrame = (callback: FrameRequestCallback) => { callback(0); return 1 }
    window.history.replaceState(null, '', '/admin/students?filter=quiet')
    sessionStorage.clear()
    const setScroll = (y: number) => { Object.defineProperty(window, 'scrollY', { configurable: true, value: y }); window.dispatchEvent(new Event('scroll')) }
    function List() {
      useListScrollMemory(true)
      return null
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(createElement(BrowserRouter, null, createElement(List))))

    setScroll(700)
    expect(sessionStorage.getItem('csg:list-scroll:/admin/students')).toBe('700')

    // A suspended navigation keeps the list mounted while the next page's spinner clamps the scroll.
    window.history.pushState(null, '', '/admin/cohorts/2/students/5/overview')
    setScroll(64)
    expect(sessionStorage.getItem('csg:list-scroll:/admin/students')).toBe('700')

    act(() => root.unmount())
    container.remove()
    window.requestAnimationFrame = raf
  })
})
