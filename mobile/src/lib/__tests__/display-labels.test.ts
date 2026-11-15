import shared from '../../../../fixtures/follow-up-labels.json';
import { ENROLLMENT_STATUS_LABELS, FOLLOW_UP_OUTCOME_LABELS, FOLLOW_UP_REASON_LABELS, FOLLOW_UP_STATUS_LABELS, gradeLabel, humanize, ROLE_LABELS } from '../display-labels';

/* Mobile and web show the same words for follow-up plan values (fixtures/follow-up-labels.json). */
describe('follow-up labels match web', () => {
  it('uses the shared reason, status and outcome words', () => {
    expect(FOLLOW_UP_REASON_LABELS).toEqual(shared.triggers);
    expect(FOLLOW_UP_STATUS_LABELS).toEqual(shared.statuses);
    expect(FOLLOW_UP_OUTCOME_LABELS).toEqual(shared.outcomes);
  });
});

describe('stored values as words', () => {
  it('labels roles, enrollment statuses and grades', () => {
    expect(humanize('instructor', ROLE_LABELS)).toBe('Instructor');
    expect(humanize('dropped', ENROLLMENT_STATUS_LABELS)).toBe('Withdrawn');
    expect(humanize('waiting_on_student')).toBe('Waiting on student');
    expect(gradeLabel('R')).toBe('Redo');
    expect(gradeLabel('A')).toBe('A');
  });
});
