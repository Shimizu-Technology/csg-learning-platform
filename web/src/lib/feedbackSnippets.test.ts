import { describe, expect, it } from 'vitest'
import { appendFeedbackSnippet } from './feedbackSnippets'

describe('appendFeedbackSnippet', () => {
  it('inserts reusable wording into an editable feedback draft', () => {
    expect(appendFeedbackSnippet('Strong structure.', 'Next, name the intermediate value.')).toBe('Strong structure.\n\nNext, name the intermediate value.')
    expect(appendFeedbackSnippet('', 'Clear result.')).toBe('Clear result.')
  })

  it('keeps indented code at the start of the feedback and of the snippet (review round 3)', () => {
    // Existing feedback that starts with indented code, then a snippet.
    expect(appendFeedbackSnippet('\n    puts 1\n\n', 'Try a loop next.')).toBe('    puts 1\n\nTry a loop next.')
    // A snippet that starts with indented code, appended to feedback.
    expect(appendFeedbackSnippet('Good start.', '\n    puts 1\n    puts 2  \n')).toBe('Good start.\n\n    puts 1\n    puts 2  ')
    // Each way round, both stay indented.
    expect(appendFeedbackSnippet('    puts 1', '    def run\n      puts 2\n    end')).toBe('    puts 1\n\n    def run\n      puts 2\n    end')
    expect(appendFeedbackSnippet('   \n', '    puts 1')).toBe('    puts 1')
  })
})
