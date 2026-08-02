import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { LessonObjective } from '../../types/api'
import { LearningObjectivesPanel } from './LearningObjectivesPanel'

const objective: LessonObjective = {
  alignment_id: 1,
  id: 2,
  code: 'TERM.1',
  title: 'Navigate folders',
  description: 'Use the terminal with intention.',
  success_criteria: 'I can move into a requested folder and confirm where I am.',
  active: true,
  content_block_id: 3,
  content_block_title: 'Terminal practice',
}

describe('LearningObjectivesPanel', () => {
  it('shows student-facing success criteria and the aligned task before work', () => {
    const html = renderToStaticMarkup(<LearningObjectivesPanel objectives={[objective]} />)

    expect(html).toContain('What success looks like')
    expect(html).toContain('TERM.1')
    expect(html).toContain('For Terminal practice')
    expect(html).toContain('I can move into a requested folder')
  })

  it('does not expose inactive curriculum objectives to students', () => {
    const html = renderToStaticMarkup(<LearningObjectivesPanel objectives={[{ ...objective, active: false }]} />)

    expect(html).toBe('')
  })
})
