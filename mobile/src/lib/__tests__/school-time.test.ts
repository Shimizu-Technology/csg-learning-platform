import { configureSchoolTime, schoolWallTimeToIso, schoolWeekEndsAt } from '../school-time';
import { formatCourseDateTime } from '../course-time';

afterEach(() => configureSchoolTime());

it('uses the configured zone for mobile formatting and DST calendar weeks', () => {
  configureSchoolTime({ time_zone: 'America/New_York', time_zone_label: 'EST' });
  expect(formatCourseDateTime('2026-10-21T08:00:00Z')).toBe('Oct 21, 4:00 AM EDT');
  expect(schoolWeekEndsAt('2026-03-02', 1)).toBe(Date.parse('2026-03-09T04:00:00Z'));
  expect(schoolWallTimeToIso('2026-03-08T02:30')).toBeNull();
});

import { parseCachedSession, serializeCachedSession } from '../session-access';
import { demoUser } from '../demo-data';

it('retains school configuration in the offline session cache', () => {
  const school = { time_zone: 'America/New_York', time_zone_label: 'EST' };
  const cached = serializeCachedSession(demoUser, [], 'synthetic-subject', school);
  expect(parseCachedSession(cached, 'synthetic-subject')?.school).toEqual(school);
});
