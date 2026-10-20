// @vitest-environment jsdom

import { useEffect } from 'react'

import { describe, expect, it, vi } from 'vitest'
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

describe('list position and return context hooks', () => {
  async function harness() {
    const { act, createElement } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter, Route, Routes, useNavigate } = await import('react-router-dom')
    const mod = await import('./navigationContext')
    return { act, createElement, createRoot, MemoryRouter, Route, Routes, useNavigate, ...mod }
  }
  const setScroll = (y: number) => { Object.defineProperty(window, 'scrollY', { configurable: true, value: y }) }
  const useEffectOnce = (fn: () => void) => { useEffect(fn, []) } // eslint-disable-line react-hooks/exhaustive-deps

  it('restores on an explicit back link, refreshes the position on a fresh visit, and guards saves until restored', async () => {
    const h = await harness()
    const raf = window.requestAnimationFrame
    window.requestAnimationFrame = (callback: FrameRequestCallback) => { callback(0); return 1 }
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo
    window.history.replaceState(null, '', '/admin/students')
    sessionStorage.clear()
    sessionStorage.setItem('csg:list-scroll:/admin/students', '2000')

    let ready = false
    function List() {
      h.useListScrollMemory(ready)
      return null
    }
    // Arrive by a PUSH (a link click), as in the app; the first entry of a router is a POP.
    function Go({ state }: { state: unknown }) {
      const navigate = h.useNavigate()
      useEffectOnce(() => navigate('/admin/students', { state }))
      return null
    }
    const render = (state: unknown) => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = h.createRoot(container)
      const tree = () => h.createElement(h.MemoryRouter, { initialEntries: ['/start'] }, h.createElement(h.Routes, null,
        h.createElement(h.Route, { path: '/start', element: h.createElement(Go, { state }) }),
        h.createElement(h.Route, { path: '/admin/students', element: h.createElement(List) })))
      h.act(() => root.render(tree()))
      return { rerender: () => h.act(() => root.render(tree())), unmount: () => { h.act(() => root.unmount()); container.remove() } }
    }

    // Fresh visit: no restore; once ready the stale 2000 is replaced by the current position.
    setScroll(0)
    let view = render(null)
    ready = true
    view.rerender()
    expect(scrollTo).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('csg:list-scroll:/admin/students')).toBe('0')
    view.unmount()

    // Back link: saves wait until the restore, then the list scrolls to the saved position.
    sessionStorage.setItem('csg:list-scroll:/admin/students', '640')
    ready = false
    view = render({ restoreList: true })
    setScroll(0)
    window.dispatchEvent(new Event('scroll'))
    expect(sessionStorage.getItem('csg:list-scroll:/admin/students')).toBe('640')
    ready = true
    view.rerender()
    expect(scrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'instant' })
    view.unmount()
    window.requestAnimationFrame = raf
  })

  it('prefers router state, then the remembered context for the scope, then the fallback', async () => {
    const h = await harness()
    sessionStorage.clear()
    const seen: string[] = []
    function Record() {
      const context = h.useReturnContext({ returnTo: '/admin/students', returnLabel: 'Students' }, 'student:2:5')
      seen.push(`${context.returnLabel}|${context.returnTo}`)
      return null
    }
    const mount = (state: unknown) => {
      const container = document.createElement('div')
      const root = h.createRoot(container)
      h.act(() => root.render(h.createElement(h.MemoryRouter, { initialEntries: [{ pathname: '/admin/cohorts/2/students/5/overview', state }] }, h.createElement(Record))))
      h.act(() => root.unmount())
    }
    mount(null)
    mount({ returnTo: '/admin/students?filter=quiet', returnLabel: 'Students · Quiet' })
    mount(null)
    sessionStorage.setItem('csg:return:student:2:5', '{"returnTo":"//evil.example.com","returnLabel":"x"}')
    mount(null)
    expect(seen).toEqual([
      'Students|/admin/students',
      'Students · Quiet|/admin/students?filter=quiet',
      'Students · Quiet|/admin/students?filter=quiet',
      'Students|/admin/students',
    ])
  })
})
