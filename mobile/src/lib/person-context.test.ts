
import { personContext, matchingPeople } from './person-context';
const people = Array.from({ length: 12 }, (_, index) => ({ id: 100 + index, full_name: 'Alex Santos', role: 'student' }));
describe('private person labels', () => {
  it('distinguishes duplicate names without exposing database ids', () => {
    expect(personContext(people[0], people, 'Web Development')).toBe('student · Web Development · 1');
    expect(personContext(people[11], people, 'Web Development')).toBe('student · Web Development · 12');
    expect(personContext(people[0], [...people].reverse(), 'Web Development')).toBe('student · Web Development · 1');
  });
  it('narrows the entire list before the mention result limit', () => {
    expect(matchingPeople(people, 'Development · 12', 'Web Development').map((person) => person.id)).toEqual([111]);
    expect(matchingPeople(people, 'Alex', 'Web Development')).toHaveLength(8);
  });
  it('prefers available cohort context', () => {
    const cohorts = [{ ...people[0], cohort_name: 'Spring' }, { ...people[1], cohort_name: 'Summer' }];
    expect(personContext(cohorts[0], cohorts, 'CSG')).toBe('student · Spring');
    expect(personContext(cohorts[1], cohorts, 'CSG')).toBe('student · Summer');
  });
});
