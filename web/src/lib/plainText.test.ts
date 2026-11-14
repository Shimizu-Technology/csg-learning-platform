/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { markdownExcerpt } from './plainText'

// The same input → excerpt pairs the API's MarkdownExcerpt and the mobile app read.
const { cases } = JSON.parse(readFileSync(new URL('../../../fixtures/markdown-excerpts.json', import.meta.url), 'utf8')) as {
  cases: { name: string; markdown: string; excerpt: string }[]
}

describe('markdownExcerpt', () => {
  it.each(cases)('shared fixture: $name', ({ markdown, excerpt }) => {
    expect(markdownExcerpt(markdown)).toBe(excerpt)
  })

  it('strips emphasis, inline code, links, and lists', () => {
    expect(markdownExcerpt('Close! 1. Define the name **before** you print it.\n2. Explain *why* it failed. See [docs](https://x.test) and `NameError`.'))
      .toBe('Close! 1. Define the name before you print it. Explain why it failed. See docs and NameError.')
  })

  it('keeps only the first line of a code fence', () => {
    expect(markdownExcerpt('Try:\n\n```python\nstudent_name = "Kai"\nprint(student_name)\n```\nThen resubmit.'))
      .toBe('Try: student_name = "Kai" Then resubmit.')
  })

  it('shows HTML as typed text, like the written renderer, and truncates', () => {
    expect(markdownExcerpt('<p>Hello <img src=x onerror=alert(1)> there</p>')).toBe('<p>Hello <img src=x onerror=alert(1)> there</p>')
    expect(markdownExcerpt('a'.repeat(300), 20)).toHaveLength(20)
    expect(markdownExcerpt(null)).toBe('')
  })

  it('leaves pipes alone outside a table', () => {
    expect(markdownExcerpt('a || b')).toBe('a || b')
  })
})
