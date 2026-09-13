import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { buildCurriculumPayload, NewCurriculumModal } from './NewCurriculumModal'

describe('NewCurriculumModal', () => {
  it('builds an active reusable curriculum payload', () => {
    expect(buildCurriculumPayload('  CSG Alumni Learning Library  ', '  Optional continuing education for CSG graduates. ')).toEqual({
      name: 'CSG Alumni Learning Library',
      description: 'Optional continuing education for CSG graduates.',
      status: 'active',
    })
  })

  it('rejects a blank name and renders the expected form controls', () => {
    expect(buildCurriculumPayload('  ', '')).toBeNull()

    const html = renderToStaticMarkup(<NewCurriculumModal saving={false} onClose={() => undefined} onCreate={async () => undefined} />)
    expect(html).toContain('New curriculum')
    expect(html).toContain('id="curriculum-name"')
    expect(html).toContain('id="curriculum-description"')
    expect(html).toContain('Create curriculum')
  })
})
