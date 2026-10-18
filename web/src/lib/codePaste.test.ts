import { describe, expect, it } from 'vitest'
import { isMultiLinePaste, looksLikeCode, normalizePastedCode } from './codePaste'

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
  })

  it('normalizes line endings and non-breaking spaces without touching indentation', () => {
    expect(normalizePastedCode('if x:\r\n\u00a0\u00a0\u00a0\u00a0y()\r\n\r\n')).toBe('if x:\n    y()')
    expect(isMultiLinePaste('one\n\ntwo')).toBe(true)
    expect(isMultiLinePaste('one\n')).toBe(false)
  })
})
