import { describe, expect, it } from 'vitest'
import { looksLikeCode, submissionReadsAsWriting } from './SubmissionText'

describe('submissionReadsAsWriting', () => {
  it('renders written answers formatted and code as source', () => {
    const prose = 'I used `if` / `else if` / `else` so only one price is returned.\n\n- Test exactly 12\n- Test exactly 65'
    expect(submissionReadsAsWriting(prose, null)).toBe(true)
    expect(submissionReadsAsWriting('Some notes\n\n```js\nticketPrice(12)\n```', null)).toBe(true)
    expect(submissionReadsAsWriting('# Reflection\nIt went well.', 'markdown')).toBe(true)
    const code = 'function ticketPrice(age) {\n  if (age < 12) {\n    return 5\n  }\n  return 10\n}'
    expect(submissionReadsAsWriting(code, null)).toBe(false)
    expect(submissionReadsAsWriting(prose, 'javascript')).toBe(false)
  })

  it('tells code lines from sentences', () => {
    expect(looksLikeCode('def total(items):\n    return sum(items)\nprint(total([1, 2]))')).toBe(true)
    expect(looksLikeCode('x = 5\ny = x + 2')).toBe(true)
    expect(looksLikeCode('Lists keep order. Sets do not.\nTuples cannot change.')).toBe(false)
    expect(looksLikeCode('')).toBe(false)
  })
})
