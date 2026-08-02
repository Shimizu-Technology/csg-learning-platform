import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RubricPanel } from './RubricPanel'

describe('RubricPanel', () => {
  it('shows criteria before work and criterion feedback after review', () => {
    const html = renderToStaticMarkup(<RubricPanel rubric={{ id: 1, title: 'Project quality', description: null, criteria: [{ id: 2, title: 'Correctness', description: 'The result works.', rating: 'meets', feedback: 'All required cases pass.' }] }} />)
    expect(html).toContain('Your criterion feedback')
    expect(html).toContain('Correctness')
    expect(html).toContain('Meets')
    expect(html).toContain('All required cases pass.')
  })
})
