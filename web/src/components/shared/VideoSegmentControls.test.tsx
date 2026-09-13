import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { VideoSegmentControls } from './VideoSegmentControls'

describe('VideoSegmentControls', () => {
  it('renders exact ranges and distinguishes core from optional sections', () => {
    const markup = renderToStaticMarkup(<VideoSegmentControls segments={[
      { label: 'Plan the schema', start_seconds: 65, end_seconds: 140, required: true },
      { label: 'Class Q&A', start_seconds: 180, end_seconds: 245, required: false },
    ]} onSelect={vi.fn()} />)

    expect(markup).toContain('Plan the schema')
    expect(markup).toContain('1:05–2:20')
    expect(markup).toContain('Core')
    expect(markup).toContain('Optional')
    expect(markup).toContain('The full class recording remains available.')
  })
})
