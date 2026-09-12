import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))
vi.mock('./MarkdownRenderer', () => ({ MarkdownRenderer: () => null }))
vi.mock('./CodeEditor', () => ({ CodeEditor: () => null, detectLanguage: () => 'ruby' }))
vi.mock('./CodeRunner', () => ({ CodeRunner: () => null }))
vi.mock('./VideoPlayer', () => ({ VideoPlayer: () => null }))
vi.mock('./GradeDisplay', () => ({ GradeDisplay: () => null }))

import { ContentBlockRenderer } from './ContentBlockRenderer'

function renderExercise(submissionType: string, isStaff: boolean) {
  return renderToStaticMarkup(
    <ContentBlockRenderer
      isStaff={isStaff}
      block={{
        id: 1,
        block_type: 'exercise',
        position: 0,
        title: 'Practice',
        body: null,
        video_url: null,
        filename: null,
        submission_type: submissionType,
        metadata: {},
      }}
    />,
  )
}

describe('staff lesson preview', () => {
  it('does not render manual completion controls for staff', () => {
    const staffMarkup = renderExercise('manual_complete', true)

    expect(staffMarkup).not.toContain('Mark Complete')
    expect(renderExercise('manual_complete', false)).toContain('Mark Complete')
  })

  it('does not render submission controls for staff', () => {
    const staffMarkup = renderExercise('text_submission', true)

    expect(staffMarkup).not.toContain('Write your solution')
    expect(staffMarkup).not.toContain('>Submit<')
    expect(renderExercise('text_submission', false)).toContain('Write your solution')
  })
})
