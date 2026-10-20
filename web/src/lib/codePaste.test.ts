import { describe, expect, it } from 'vitest'
import { fencedCodeInsertion, isInsideMarkdownFence, isMultiLinePaste, looksLikeCode, normalizePastedCode } from './codePaste'

const python = 'amount = 125\nbudget = 100\n\nif amount < budget:\n    print("Under budget")\nelse:\n    print("Over budget")'

describe('code paste detection', () => {
  it('keeps indented Python as code', () => {
    expect(looksLikeCode(python)).toBe(true)
    expect(looksLikeCode('def total(items):\n\treturn sum(items)')).toBe(true)
  })

  it('recognizes unindented code by its lines', () => {
    expect(looksLikeCode('first = "12"\nsecond = "3"\nprint(int(first) + int(second))')).toBe(true)
  })

  it('leaves prose, single lines, bullets, and fenced markdown alone', () => {
    expect(looksLikeCode('Hi Ana,\n\nI finished the checkpoint early. Could we meet Tuesday instead?\nThanks!')).toBe(false)
    expect(looksLikeCode('print("hello")')).toBe(false)
    expect(looksLikeCode('Things to fix:\n  - the name\n  - the colon')).toBe(false)
    expect(looksLikeCode('```python\nprint(1)\n```')).toBe(false)
    expect(looksLikeCode('Things to fix:\nsee the notes (above)')).toBe(false)
    expect(looksLikeCode('foo()\nbar()')).toBe(true)
  })

  it('normalizes line endings and non-breaking spaces without touching indentation', () => {
    expect(normalizePastedCode('if x:\r\n\u00a0\u00a0\u00a0\u00a0y()\r\n\r\n')).toBe('if x:\n    y()')
    expect(isMultiLinePaste('one\n\ntwo')).toBe(true)
    expect(isMultiLinePaste('one\n')).toBe(false)
  })
})

describe('markdown fences for the message edit box', () => {
  it('knows when the cursor is inside a fence', () => {
    const text = 'hi\n```python\nx = 1\n```\nafter'
    expect(isInsideMarkdownFence(text, text.indexOf('x = 1'))).toBe(true)
    expect(isInsideMarkdownFence(text, text.indexOf('after'))).toBe(false)
    expect(isInsideMarkdownFence(text, 1)).toBe(false)
    expect(isInsideMarkdownFence('```\nopen', 6)).toBe(true)
  })

  it('puts pasted code on its own lines inside a fence', () => {
    expect(fencedCodeInsertion('', 0, 0, 'def f():\n    return 1')).toBe('```\ndef f():\n    return 1\n```\n')
    expect(fencedCodeInsertion('Look: ', 6, 6, 'a\n  b')).toBe('\n```\na\n  b\n```\n')
    expect(fencedCodeInsertion('x\n\nmore', 2, 2, 'a\n  b')).toBe('```\na\n  b\n```')
  })

  it('uses a longer fence when the code itself contains backticks', () => {
    expect(fencedCodeInsertion('', 0, 0, 'print("```")\n  x')).toBe('````\nprint("```")\n  x\n````\n')
  })
})
