import { curriculumDayFor, curriculumWeekFor, curriculumWeeks, lessonsForWeek, searchStaffCurricula } from '../curriculum';
import type { StaffCurriculum, StaffCurriculumModule } from '../types';

const module: StaffCurriculumModule = {
  id: 10,
  curriculum_id: 3,
  name: 'Live Class',
  module_type: 'live_class',
  description: null,
  position: 0,
  total_days: 14,
  day_offset: 0,
  schedule_days: 'weekdays',
  scheduled_day_names: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  week_count: 2,
  lessons_count: 3,
  archived_lessons_count: 1,
  lessons: [
    { id: 1, title: 'HTML foundations', lesson_type: 'exercise', position: 1, release_day: 0, required: true, archived_at: null, requires_submission: true, submission_type: 'text_submission', content_blocks_count: 2 },
    { id: 2, title: 'CSS Grid', lesson_type: 'exercise', position: 1, release_day: 7, required: true, archived_at: null, requires_submission: false, submission_type: 'manual_complete', content_blocks_count: 3 },
    { id: 3, title: 'Old exercise', lesson_type: 'exercise', position: 2, release_day: 8, required: false, archived_at: '2026-09-01T00:00:00Z', requires_submission: false, submission_type: 'manual_complete', content_blocks_count: 1 },
  ],
};

const curriculum: StaffCurriculum = {
  id: 3,
  name: 'CSG Bootcamp',
  description: null,
  total_weeks: 14,
  status: 'active',
  modules_count: 1,
  modules: [module],
};

describe('staff curriculum organization', () => {
  it('groups active lessons by their release week and day', () => {
    expect(curriculumWeeks(module)).toEqual([1, 2]);
    expect(lessonsForWeek(module, 2).map((lesson) => lesson.id)).toEqual([2]);
    expect(curriculumWeekFor(module.lessons[1])).toBe(2);
    expect(curriculumDayFor(module.lessons[1])).toBe('Monday');
  });

  it('searches curriculum, module, lesson, type, and submission labels', () => {
    expect(searchStaffCurricula([curriculum], 'grid').map((result) => result.lesson.id)).toEqual([2]);
    expect(searchStaffCurricula([curriculum], 'live class')).toHaveLength(3);
    expect(searchStaffCurricula([curriculum], 'repo')).toHaveLength(0);
  });
});
