import { describe, expect, it } from 'vitest'
import { parseInline } from '../../../lib/messageFormat'
import { markdownEnterAddsLine, markdownListEnterEdit, markdownListIndentEdit, markdownSourceEdit } from './markdownSource'

function apply(value: string, start: number, end: number) {
  const edit = markdownSourceEdit(value, start, end, 'code')
  const next = value.slice(0, edit.start) + edit.text + value.slice(edit.end)
  return { edit, next }
}

describe('markdownSourceEdit inline code (review round 2)', () => {
  it('wraps plain text in single backticks and selects the text', () => {
    const { edit, next } = apply('run npm test now', 4, 12)
    expect(next).toBe('run `npm test` now')
    expect(next.slice(edit.selectionStart, edit.selectionEnd)).toBe('npm test')
  })

  it('uses a longer delimiter, padded, when the selection holds backticks', () => {
    const value = 'see a `b` here'
    const { edit, next } = apply(value, 4, 9)
    expect(next).toBe('see `` a `b` `` here')
    expect(next.slice(edit.selectionStart, edit.selectionEnd)).toBe('a `b`')
    expect(parseInline(next)).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'code', text: 'a `b`' },
      { type: 'text', text: ' here' },
    ])
  })

  it('outruns the longest backtick run in the selection', () => {
    const { next } = apply('x a ``y`` z', 2, 9)
    expect(next).toBe('x ``` a ``y`` ``` z')
    expect(parseInline(next).filter((node) => node.type === 'code')).toEqual([{ type: 'code', text: 'a ``y``' }])
  })

  it('inserts a placeholder when nothing is selected', () => {
    const { edit, next } = apply('', 0, 0)
    expect(next).toBe('`code`')
    expect(next.slice(edit.selectionStart, edit.selectionEnd)).toBe('code')
  })
})

describe('Markdown source formatting toggles', () => {
  it.each(['bold', 'italic', 'strike', 'code', 'codeBlock', 'bulletList', 'orderedList', 'blockquote'] as const)('toggles %s off after insertion', (action) => {
    const edit = markdownSourceEdit('one\ntwo', 0, 7, action)
    const value = edit.text
    const off = markdownSourceEdit(value, edit.selectionStart, edit.selectionEnd, action)
    expect(value.slice(0, off.start) + off.text + value.slice(off.end)).toBe('one\ntwo')
  })
  it('switches list kinds and preserves nested indentation', () => {
    const edit = markdownSourceEdit('- parent\n  - child\n- next', 0, 24, 'orderedList')
    expect(edit.text).toBe('1. parent\n  1. child\n2. next')
  })
})

it.each(['bold', 'italic', 'strike', 'code'] as const)('unwraps %s for full, inner, partial and cursor selections', (action) => {
  const mark = { bold: '**', italic: '_', strike: '~~', code: '`' }[action]
  const value = `${mark}hello world${mark}`
  for (const [start, end] of [[0, value.length], [mark.length, value.length - mark.length], [mark.length + 2, mark.length + 4], [mark.length + 3, mark.length + 3]]) {
    const off = markdownSourceEdit(value, start, end, action)
    expect(value.slice(0, off.start) + off.text + value.slice(off.end)).toBe('hello world')
  }
})

it.each([
  ['use snake_case_name here', 11, 'italic'],
  ['a _b\n\nlater_ c', 6, 'italic'],
  ['see `a**b` and **c**', 8, 'bold'],
  ['x ** y ** z', 5, 'bold'],
] as const)('never strips characters that are not formatting: %j', (value, caret, action) => {
  const edit = markdownSourceEdit(value, caret, caret, action)
  const result = value.slice(0, edit.start) + edit.text + value.slice(edit.end)
  // Pressing the button inserts a placeholder; every original character is still there in order.
  let at = 0
  for (const character of value) at = result.indexOf(character, at) + 1
  expect(at).toBeGreaterThan(0)
  expect(result.length).toBeGreaterThan(value.length)
})

it('still toggles real emphasis next to identifiers and code', () => {
  const value = 'call `x_y` with _snake_case_ now'
  const caret = value.indexOf('snake') + 2
  const edit = markdownSourceEdit(value, caret, caret, 'italic')
  expect(value.slice(0, edit.start) + edit.text + value.slice(edit.end)).toBe('call `x_y` with snake_case now')
})

describe('Markdown list Enter and Tab helpers', () => {
  it('treats list items and code fences as multi-line Enter blocks', () => {
    expect(markdownEnterAddsLine('1. first step', 13)).toBe(true)
    expect(markdownEnterAddsLine('- item', 6)).toBe(true)
    expect(markdownEnterAddsLine('plain text', 10)).toBe(false)
    expect(markdownEnterAddsLine('```js\nconst x = 1', 17)).toBe(true)
  })

  it('continues numbered and bulleted lists and exits on an empty item', () => {
    const ordered = markdownListEnterEdit('1. Pull main', 12, 12)!
    expect('1. Pull main'.slice(0, ordered.start) + ordered.text + '1. Pull main'.slice(ordered.end)).toBe('1. Pull main\n2. ')

    const bullet = markdownListEnterEdit('  - Nested item', 15, 15)!
    expect('  - Nested item'.slice(0, bullet.start) + bullet.text + '  - Nested item'.slice(bullet.end)).toBe('  - Nested item\n  - ')

    const exit = markdownListEnterEdit('1. Pull main\n2. ', 16, 16)!
    expect('1. Pull main\n2. '.slice(0, exit.start) + exit.text + '1. Pull main\n2. '.slice(exit.end)).toBe('1. Pull main\n')
  })

  it('indents and outdents list items with Tab / Shift+Tab', () => {
    const indented = markdownListIndentEdit('- item', 6, 6, false)!
    expect('- item'.slice(0, indented.start) + indented.text + '- item'.slice(indented.end)).toBe('  - item')
    const outdented = markdownListIndentEdit('  - item', 8, 8, true)!
    expect('  - item'.slice(0, outdented.start) + outdented.text + '  - item'.slice(outdented.end)).toBe('- item')
  })
})
