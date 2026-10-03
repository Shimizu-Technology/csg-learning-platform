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
    expect(markup).toContain('Start 1:05 · stop 2:20')
    expect(markup).toContain('Core')
    expect(markup).toContain('Optional')
    expect(markup).toContain('2 min core viewing')
    expect(markup).toContain('Playback pauses at its reviewed end time')
  })

  it('shows the active and most recently finished section', () => {
    const active = { label: 'Active', start_seconds: 10, end_seconds: 70, required: true }
    const completed = { label: 'Done', start_seconds: 80, end_seconds: 140, required: true }
    const markup = renderToStaticMarkup(<VideoSegmentControls segments={[active, completed]} activeSegment={active} completedSegment={completed} onSelect={vi.fn()} />)

    expect(markup).toContain('Playing this section')
    expect(markup).toContain('Section finished')
    expect(markup).toContain('aria-pressed="true"')
  })
})
