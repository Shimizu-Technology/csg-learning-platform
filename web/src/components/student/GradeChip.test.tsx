import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GradeChip } from './GradeChip'

describe('GradeChip', () => {
  it('announces Pass as text beside its check icon, and letters and Redo by label', () => {
    const pass = renderToStaticMarkup(<GradeChip grade="P" />)
    expect(pass).toContain('<span class="sr-only">Pass</span>')
    expect(pass).not.toContain('aria-label')
    expect(renderToStaticMarkup(<GradeChip grade="R" />)).toContain('aria-label="Redo"')
    expect(renderToStaticMarkup(<GradeChip grade="A" />)).toContain('aria-label="Grade A"')
  })
})
