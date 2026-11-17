import { isScheduledUpdate, sendsAbout, sendsAboutLabel } from '../scheduled-updates';

it('treats only a draft with a send time as scheduled, sending at the next hourly run', () => {
  expect(isScheduledUpdate({ status: 'draft', scheduled_for: '2030-01-14T23:00:00.000Z' })).toBe(true);
  expect(isScheduledUpdate({ status: 'draft', scheduled_for: null })).toBe(false);
  expect(isScheduledUpdate({ status: 'published', scheduled_for: '2030-01-14T23:00:00.000Z' })).toBe(false);
  expect(sendsAbout('2030-01-14T23:20:00.000Z').toISOString()).toBe('2030-01-15T00:00:00.000Z');
  expect(sendsAboutLabel('2030-01-14T23:00:00.000Z')).toBe('Sends about Jan 15, 2030, 9:00 AM ChST');
});
