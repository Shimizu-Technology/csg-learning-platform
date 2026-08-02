import { describe, expect, it } from 'vitest'
import { appendFeedbackSnippet } from './feedbackSnippets'

describe('appendFeedbackSnippet', () => {
  it('inserts reusable wording into an editable feedback draft', () => {
    expect(appendFeedbackSnippet('Strong structure.', 'Next, name the intermediate value.')).toBe('Strong structure.\n\nNext, name the intermediate value.')
    expect(appendFeedbackSnippet('', 'Clear result.')).toBe('Clear result.')
  })
})
