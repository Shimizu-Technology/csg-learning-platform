import { analyticsAgeBucket, analyticsLanguage, durationBucket, latencyBucket, safeProductEvent } from '../analytics';

describe('privacy-safe product analytics', () => {
  it('adds the platform and accepts documented categories', () => {
    expect(safeProductEvent('submission_created', {
      cohort_id: 3, content_block_id: 42, submission_type: 'text_submission', attempt: 2,
    })).toEqual({
      event: 'submission_created',
      properties: { platform: 'ios', cohort_id: 3, content_block_id: 42, submission_type: 'text_submission', attempt: 2 },
    });
    expect(safeProductEvent('voice_draft_transcribed', {
      surface: 'message', latency_bucket: 'under_2s', outcome: 'over_limit',
    })?.properties.outcome).toBe('over_limit');
  });

  it('drops unknown keys and rejects content-like values', () => {
    const event = safeProductEvent('code_block_copied', {
      surface: 'message', language: 'ruby', body: 'secret student message',
    } as never);
    expect(event?.properties).not.toHaveProperty('body');
    expect(safeProductEvent('code_block_copied', { surface: 'message', language: 'ruby code with spaces' })).toBeNull();
    expect(safeProductEvent('code_block_copied', { surface: 'message' } as never)).toBeNull();
  });

  it('uses bounded buckets and normalized categories', () => {
    expect(durationBucket(14)).toBe('under_15s');
    expect(durationBucket(90)).toBe('61_to_120s');
    expect(durationBucket(121)).toBe('over_120s');
    expect(latencyBucket(2_500)).toBe('2_to_5s');
    expect(analyticsLanguage('C++')).toBe('c');
    expect(analyticsAgeBucket('2026-08-01T00:00:00Z', Date.parse('2026-08-10T00:00:00Z'))).toBe('over_one_week');
    expect(analyticsAgeBucket('not-a-date')).toBe('same_day');
  });
});
