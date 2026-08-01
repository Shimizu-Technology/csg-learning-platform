import { describe, expect, it } from 'vitest'

import { analyticsAgeBucket, analyticsLanguage, safeProductEvent } from './analytics'

describe('privacy-safe product analytics', () => {
  it('adds platform and accepts the documented categorical contract', () => {
    expect(safeProductEvent('submission_created', {
      cohort_id: 3,
      content_block_id: 42,
      submission_type: 'text_submission',
      attempt: 2,
    })).toEqual({
      event: 'submission_created',
      properties: {
        platform: 'web', cohort_id: 3, content_block_id: 42, submission_type: 'text_submission', attempt: 2,
      },
    })
  })

  it('drops unknown keys and rejects content-like values', () => {
    const event = safeProductEvent('code_block_copied', {
      surface: 'message', language: 'ruby', body: 'secret student message',
    } as never)
    expect(event?.properties).not.toHaveProperty('body')
    expect(safeProductEvent('code_block_copied', { surface: 'message', language: 'ruby code with spaces' })).toBeNull()
    expect(safeProductEvent('code_block_copied', { surface: 'message' } as never)).toBeNull()
  })

  it('normalizes language and deterministic age buckets without retaining content', () => {
    expect(analyticsLanguage('C++')).toBe('c')
    expect(analyticsLanguage('')).toBe('other')
    const now = Date.parse('2026-08-10T00:00:00Z')
    expect(analyticsAgeBucket('2026-08-09T12:00:00Z', now)).toBe('same_day')
    expect(analyticsAgeBucket('2026-08-01T00:00:00Z', now)).toBe('over_one_week')
    expect(analyticsAgeBucket('not-a-date', now)).toBe('same_day')
  })
})
