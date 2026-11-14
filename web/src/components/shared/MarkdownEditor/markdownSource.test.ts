import { describe, expect, it } from 'vitest'
import { parseInline } from '../../../lib/messageFormat'
import { markdownSourceEdit } from './markdownSource'

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
    const { next } = apply('x ``y`` z', 2, 7)
    expect(next).toBe('x ``` ``y`` ``` z')
    expect(parseInline(next).filter((node) => node.type === 'code')).toEqual([{ type: 'code', text: '``y``' }])
  })

  it('inserts a placeholder when nothing is selected', () => {
    const { edit, next } = apply('', 0, 0)
    expect(next).toBe('`code`')
    expect(next.slice(edit.selectionStart, edit.selectionEnd)).toBe('code')
  })
})
