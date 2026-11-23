import { describe, expect, it } from 'vitest'
import { observedSectionSeconds, SectionWatch } from './sectionWatch'

const section = { label: 'First Core', start_seconds: 5, end_seconds: 8, required: true }

describe('SectionWatch', () => {
  it('rejects a seek over the middle after some continuous playback', () => {
    const watch = new SectionWatch(section)
    watch.observe(5, 6, 1)
    watch.observe(6, 7.8, 0)
    watch.observe(7.8, 8.1, 0.3)
    expect(watch.finished).toBe(false)
    watch.observe(6, 7, 1)
    watch.observe(7, 8, 1)
    expect(watch.finished).toBe(true)
  })

  it('allows faster playback and rejects a large jump between embedded reports', () => {
    expect(observedSectionSeconds(0.5, 0.25, 2)).toBe(0.5)
    expect(observedSectionSeconds(1, 0.25, 2)).toBe(0)
    expect(observedSectionSeconds(2, 2.1, 1)).toBe(0)
  })
})
