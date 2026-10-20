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
