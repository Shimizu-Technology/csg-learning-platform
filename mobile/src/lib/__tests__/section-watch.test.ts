import { observedSectionSeconds, SectionCoverage, SectionWatch, SeekSettlement } from '../section-watch'

const section = { label: 'First Core', start_seconds: 5, end_seconds: 8, required: true }

describe('SectionWatch', () => {
  it('rejects a seek over the middle and fills the gap on a later playback', () => {
    const watch = new SectionWatch(section)
    watch.observe(5, 6, 1)
    watch.observe(6, 7.8, 0)
    watch.observe(7.8, 8.1, 0.3)
    expect(watch.finished).toBe(false)
    watch.observe(6, 7, 1)
    watch.observe(7, 8, 1)
    expect(watch.finished).toBe(true)
  })

  it('credits all naturally covered sections, including the final media sample', () => {
    const coverage = new SectionCoverage([section, { ...section, start_seconds: 8, end_seconds: 10 }])
    expect(coverage.observe(4, 5.5, 1.5)).toEqual([])
    expect(coverage.observe(5.5, 8.5, 3)).toEqual(['5:8'])
    expect(coverage.observe(8.5, 9.8, 1.3)).toEqual([])
    expect(coverage.observe(9.8, 10, 0.2)).toEqual(['8:10'])
  })

  it('recovers from stalls and small landing offsets without credit for the landing', () => {
    const watch = new SectionWatch(section)
    watch.observe(2, 5.35, 0)
    expect(watch.finished).toBe(false)
    watch.observe(5.35, 6, 0.65)
    watch.observe(6.01, 8, observedSectionSeconds(1.99, 3, 1))
    expect(watch.finished).toBe(true)
    expect(observedSectionSeconds(0.5, 0.25, 2)).toBe(0.5)
    expect(observedSectionSeconds(1, 0.25, 2)).toBe(0)
    expect(observedSectionSeconds(5, 10, 1)).toBe(0)
  })

  it('distinguishes early, near, and expired seek samples', () => {
    const seek = new SeekSettlement(5)
    expect(seek.sample(18, 100)).toBe('waiting')
    expect(seek.sample(5.4, 300, true)).toBe('waiting')
    expect(seek.sample(5.4, 650)).toBe('landed')
    const capped = new SeekSettlement(50)
    expect(capped.sample(10, 100)).toBe('waiting')
    expect(capped.sample(13, 2100)).toBe('expired')
  })
})
