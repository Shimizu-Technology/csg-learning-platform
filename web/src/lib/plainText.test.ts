import { describe, expect, it } from 'vitest'
import { markdownExcerpt } from './plainText'

describe('markdownExcerpt', () => {
  it('strips emphasis, inline code, links, and lists', () => {
    expect(markdownExcerpt('Close! 1. Define the name **before** you print it.\n2. Explain *why* it failed. See [docs](https://x.test) and `NameError`.'))
      .toBe('Close! 1. Define the name before you print it. Explain why it failed. See docs and NameError.')
  })

  it('keeps only the first line of a code fence', () => {
    expect(markdownExcerpt('Try:\n\n```python\nstudent_name = "Kai"\nprint(student_name)\n```\nThen resubmit.'))
      .toBe('Try: student_name = "Kai" Then resubmit.')
  })

  it('does not mangle snake_case or arithmetic', () => {
    expect(markdownExcerpt('Use fee_rate and 2 * 3 * 4')).toBe('Use fee_rate and 2 * 3 * 4')
  })

  it('keeps comparison operators from code feedback', () => {
    expect(markdownExcerpt('Check amount < 100 and total > 50')).toBe('Check amount < 100 and total > 50')
  })

  it('removes HTML tags and truncates', () => {
    expect(markdownExcerpt('<p>Hello <img src=x onerror=alert(1)> there</p>')).toBe('Hello there')
    expect(markdownExcerpt('a'.repeat(300), 20)).toHaveLength(20)
    expect(markdownExcerpt(null)).toBe('')
  })
})
