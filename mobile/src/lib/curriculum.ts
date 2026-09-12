import type { StaffCurriculum, StaffCurriculumModule, StaffLessonSummary } from './types';

export const curriculumDayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function curriculumWeekFor(lesson: Pick<StaffLessonSummary, 'release_day'>) {
  return Math.floor(Math.max(0, lesson.release_day) / 7) + 1;
}

export function curriculumDayFor(lesson: Pick<StaffLessonSummary, 'release_day'>) {
  return curriculumDayNames[Math.max(0, lesson.release_day) % 7];
}

export function curriculumWeeks(module: StaffCurriculumModule) {
  const weeks = new Set(module.lessons.filter((lesson) => !lesson.archived_at).map(curriculumWeekFor));
  if (!weeks.size && module.week_count > 0) weeks.add(1);
  return [...weeks].sort((a, b) => a - b);
}

export function lessonsForWeek(module: StaffCurriculumModule, week: number) {
  return module.lessons
    .filter((lesson) => !lesson.archived_at && curriculumWeekFor(lesson) === week)
    .sort((a, b) => a.release_day - b.release_day || a.position - b.position);
}

export interface StaffCurriculumSearchResult {
  curriculum: Pick<StaffCurriculum, 'id' | 'name'>;
  module: Pick<StaffCurriculumModule, 'id' | 'name'>;
  lesson: StaffLessonSummary;
}

export function searchStaffCurricula(curricula: StaffCurriculum[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const results: StaffCurriculumSearchResult[] = [];
  for (const curriculum of curricula) {
    for (const module of curriculum.modules) {
      for (const lesson of module.lessons) {
        const haystack = [curriculum.name, module.name, lesson.title, lesson.lesson_type, lesson.submission_type]
          .join(' ')
          .toLowerCase();
        if (haystack.includes(normalized)) {
          results.push({
            curriculum: { id: curriculum.id, name: curriculum.name },
            module: { id: module.id, name: module.name },
            lesson,
          });
        }
      }
    }
  }

  return results.sort((a, b) => a.curriculum.name.localeCompare(b.curriculum.name)
    || a.module.name.localeCompare(b.module.name)
    || a.lesson.release_day - b.lesson.release_day
    || a.lesson.position - b.lesson.position);
}
