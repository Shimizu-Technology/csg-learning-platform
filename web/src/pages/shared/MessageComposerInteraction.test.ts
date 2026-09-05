// @vitest-environment jsdom

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyComposerList, applyComposerListShortcut, ComposerToolbarButton } from './Messages'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let editor: Editor | null = null
let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  editor?.destroy()
  root = null
  container?.remove()
  container = null
  editor = null
})

describe('message composer list formatting', () => {
  it('starts a bulleted list at a cursor in the middle of a paragraph', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>Alpha beta</p>' })

    expect(applyComposerList(editor, 'bulletList', { from: 7, to: 7 })).toBe(true)
    expect(editor.getHTML()).toBe('<p>Alpha </p><ul><li><p>beta</p></li></ul><p></p>')
  })

  it('starts a numbered list on a new line when the cursor is at the end', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>Alpha</p>' })

    expect(applyComposerList(editor, 'orderedList', { from: 6, to: 6 })).toBe(true)
    expect(editor.getHTML()).toBe('<p>Alpha</p><ol><li><p></p></li></ol><p></p>')
  })

  it('formats the selected blocks instead of the whole document', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>First</p><p>Second</p>' })

    expect(applyComposerList(editor, 'bulletList', { from: 8, to: 14 })).toBe(true)
    expect(editor.getHTML()).toBe('<p>First</p><ul><li><p>Second</p></li></ul><p></p>')
  })

  it('preserves the cursor through pointer activation of a toolbar list button', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>Alpha beta</p>' })
    const selection = { from: 7, to: 7 }
    editor.commands.setTextSelection(selection)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(createElement(
        ComposerToolbarButton,
        {
          label: 'Bulleted list',
          children: 'List',
          onPointerDown: (event) => event.preventDefault(),
          onClick: () => {
            if (!editor) return
            applyComposerList(editor, 'bulletList', {
              from: editor.state.selection.from,
              to: editor.state.selection.to,
            })
          },
        },
      ))
    })

    const button = container.querySelector('button')
    const pointerEvent = new Event('pointerdown', { bubbles: true, cancelable: true })
    act(() => {
      button?.dispatchEvent(pointerEvent)
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(pointerEvent.defaultPrevented).toBe(true)
    expect(editor.getHTML()).toBe('<p>Alpha </p><ul><li><p>beta</p></li></ul><p></p>')
    expect(editor.state.selection.from).toBe(editor.state.selection.to)
    expect(editor.state.selection.from).toBeGreaterThan(selection.from)
  })

  it.each([
    ['Meta', 'Digit7', '<p>Alpha</p><ol><li><p></p></li></ol><p></p>'],
    ['Meta', 'Digit8', '<p>Alpha</p><ul><li><p></p></li></ul><p></p>'],
    ['Control', 'Digit7', '<p>Alpha</p><ol><li><p></p></li></ol><p></p>'],
    ['Control', 'Digit8', '<p>Alpha</p><ul><li><p></p></li></ul><p></p>'],
  ] as const)('handles the %s+Shift+%s composer shortcut using the physical key code', (modifier, code, expectedHtml) => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>Alpha</p>' })
    const preventDefault = vi.fn()

    expect(applyComposerListShortcut(editor, {
      metaKey: modifier === 'Meta',
      ctrlKey: modifier === 'Control',
      shiftKey: true,
      code,
      preventDefault,
    }, { from: 6, to: 6 })).toBe(true)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(editor.getHTML()).toBe(expectedHtml)
    expect(editor.state.selection.from).toBe(editor.state.selection.to)
    expect(editor.state.selection.from).toBeGreaterThan(6)
  })
})
