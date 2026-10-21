import { formatCourseDate, formatCourseDateTime, formatCourseTime, formatCourseTimeRange, formatCourseWeekdayTime } from '../course-time';

describe('course time (ChST)', () => {
  it('shows course times in Guam time with the ChST label, whatever the phone zone', () => {
    expect(formatCourseDateTime('2026-10-21T08:00:00Z')).toBe('Oct 21, 6:00 PM ChST');
    expect(formatCourseDateTime('2026-10-21T08:00:00Z', { withYear: true, weekday: true })).toBe('Wed, Oct 21, 2026, 6:00 PM ChST');
    expect(formatCourseWeekdayTime('2026-10-21T08:00:00Z')).toBe('Wed 6:00 PM ChST');
    expect(formatCourseTime('2026-10-20T23:30:00Z')).toBe('9:30 AM ChST');
  });

  it('gives the same Guam time whatever zone the phone is in', () => {
    const original = process.env.TZ;
    try {
      for (const zone of ['America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
        process.env.TZ = zone;
        expect(formatCourseDateTime('2026-10-21T08:00:00Z')).toBe('Oct 21, 6:00 PM ChST');
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('rejects impossible calendar dates', () => {
    expect(formatCourseDate('2026-02-31', { fallback: '—' })).toBe('—');
  });

  it('crosses the date line correctly: 3 PM UTC is the next morning in Guam', () => {
    expect(formatCourseDateTime('2026-10-21T15:00:00Z')).toBe('Oct 22, 1:00 AM ChST');
  });

  it('formats ranges and plain calendar dates without shifting them', () => {
    expect(formatCourseTimeRange('2026-10-21T08:00:00Z', '2026-10-21T09:30:00Z')).toBe('Wed, Oct 21, 6:00 PM – 7:30 PM ChST');
    expect(formatCourseDate('2026-10-19', { weekday: true })).toBe('Mon, Oct 19');
    expect(formatCourseDateTime('not a date', { fallback: 'TBD' })).toBe('TBD');
  });
});
