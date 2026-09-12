import type { StaffCurriculum, StaffCurriculumModule, StaffCurriculumSummary, StaffLessonSummary } from './types';

export const curriculumDayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export const curriculumSchedulePatterns = [
  { value: 'weekdays', label: 'Mon–Fri', days: [0, 1, 2, 3, 4] },
  { value: 'weekdays_sat', label: 'Mon–Sat', days: [0, 1, 2, 3, 4, 5] },
  { value: 'mwf', label: 'Mon / Wed / Fri', days: [0, 2, 4] },
  { value: 'tth', label: 'Tue / Thu', days: [1, 3] },
  { value: 'daily', label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
] as const;

export const curriculumModuleTypes = [
  { value: 'prework', label: 'Prework' },
  { value: 'live_class', label: 'Live Class' },
  { value: 'capstone', label: 'Capstone' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'recording', label: 'Recording' },
] as const;

export function scheduledDayIndices(scheduleDays: string): readonly number[] {
  return curriculumSchedulePatterns.find((pattern) => pattern.value === scheduleDays)?.days || curriculumSchedulePatterns[0].days;
}

export function curriculumReleaseDay(week: number, weekdayIndex: number) {
  return (Math.max(1, Math.floor(week)) - 1) * 7 + weekdayIndex;
}

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

export async function loadStaffCurriculumDetails(
  summaries: StaffCurriculumSummary[],
  loadCurriculum: (id: number) => Promise<StaffCurriculum>,
  concurrency = 3,
) {
  const curricula = new Array<StaffCurriculum | undefined>(summaries.length);
  const failures: unknown[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < summaries.length) {
      const index = cursor;
      cursor += 1;
      try {
        curricula[index] = await loadCurriculum(summaries[index].id);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        failures.push(error);
      }
    }
  };

  const workerCount = Math.min(summaries.length, Math.max(1, Math.floor(concurrency)));
  await Promise.all(Array.from({ length: workerCount }, worker));

  const loaded = curricula.filter((curriculum): curriculum is StaffCurriculum => Boolean(curriculum));
  if (!loaded.length && failures.length) {
    const firstFailure = failures[0];
    throw firstFailure instanceof Error ? firstFailure : new Error('Could not load curriculum details');
  }

  return { curricula: loaded, failedCount: failures.length };
}
