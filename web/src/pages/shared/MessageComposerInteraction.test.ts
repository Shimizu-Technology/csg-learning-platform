// @vitest-environment jsdom

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'
import { applyComposerList } from './Messages'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
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
})
