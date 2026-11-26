import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { buildCurriculumPayload, NewCurriculumModal } from './NewCurriculumModal'

describe('NewCurriculumModal', () => {
  it('builds an active reusable curriculum payload', () => {
    expect(buildCurriculumPayload('  CSG Alumni Learning Library  ', '  Optional continuing education for CSG graduates. ')).toEqual({
      name: 'CSG Alumni Learning Library',
      description: 'Optional continuing education for CSG graduates.',
      status: 'draft',
      grading_scale: 'pass_redo',
    })
    expect(buildCurriculumPayload('Projects', '', 'letter_abc_redo')?.grading_scale).toBe('letter_abc_redo')
  })

  it('rejects a blank name and renders the expected form controls', () => {
    expect(buildCurriculumPayload('  ', '')).toBeNull()

    const html = renderToStaticMarkup(<NewCurriculumModal saving={false} onClose={() => undefined} onCreate={async () => undefined} />)
    expect(html).toContain('New curriculum')
    expect(html).toContain('id="curriculum-name"')
    expect(html).toContain('id="curriculum-description"')
    expect(html).toContain('Create curriculum')
    expect(html).toContain('Grading scale')
    // New curricula start on Pass / Redo; A / B / C / Redo is the second option.
    expect(html.indexOf('Pass / Redo')).toBeLessThan(html.indexOf('A / B / C / Redo'))
    expect(html).toMatch(/checked="" value="pass_redo"|value="pass_redo" checked=""/)
  })
})
